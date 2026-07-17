import { HttpErrorResponse } from '@angular/common/http';

/**
 * Champs utiles d'une erreur RFC 7807 (ProblemDetails ASP.NET Core), le
 * format renvoyé par Ref.Api pour toutes les erreurs (401 login inclus).
 */
export interface ProblemDetails {
  readonly status?: number;
  readonly title?: string;
  readonly detail?: string;
}

/** Garde de type : corps d'erreur HTTP (donnée externe non fiable). */
export function parseProblemDetails(raw: unknown): ProblemDetails | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const status = typeof value['status'] === 'number' ? value['status'] : undefined;
  const title = typeof value['title'] === 'string' ? value['title'] : undefined;
  const detail = typeof value['detail'] === 'string' ? value['detail'] : undefined;
  if (status === undefined && title === undefined && detail === undefined) {
    return null;
  }
  return { status, title, detail };
}

/**
 * Message présentable à l'utilisateur à partir d'une erreur HttpClient :
 * `title` du ProblemDetails si présent, sinon le message de repli fourni.
 */
export function extractApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }
  if (error.status === 0) {
    return "Impossible de joindre le serveur. Vérifiez que l'API est démarrée.";
  }
  const problem = parseProblemDetails(error.error);
  return problem?.title ?? problem?.detail ?? fallback;
}
