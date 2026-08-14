import { GenerateInvoicesResponseDto } from './invoicing.dto';
import { InvoiceGenerationStatus } from './invoice-generation.model';

/** Statuts hub par valeur numérique (enum System.Text.Json en nombres). */
const HUB_STATUSES: readonly Exclude<InvoiceGenerationStatus, 'pending'>[] = [
  'started',
  'running',
  'completed',
  'failed',
  'cancelled'
];

/** Normalise un compteur : entier positif ou nul, 0 si inexploitable. */
function readCount(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : 0;
}

/**
 * Garde de type de la réponse de `POST /api/Invoices/generate` : corps du 202
 * comme du 409 (`HttpErrorResponse.error`). Stricte sur `jobId` (sans lui, il
 * n'y a rien à suivre), tolérante sur `message` (affichage seulement).
 */
export function parseGenerateInvoicesResponse(
  raw: unknown
): GenerateInvoicesResponseDto | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const jobId = value['jobId'];
  if (typeof jobId !== 'string' || jobId.trim().length === 0) {
    return null;
  }
  const message = value['message'];
  return { jobId, message: typeof message === 'string' ? message : '' };
}

/** Événement `InvoiceGenerationProgressChanged` validé et traduit en domaine. */
export interface InvoiceGenerationProgressEvent {
  readonly jobId: string;
  readonly status: Exclude<InvoiceGenerationStatus, 'pending'>;
  readonly processed: number;
  readonly total: number;
  readonly message: string | null;
  readonly timestampUtc: string;
}

/**
 * Garde de type des événements du hub `/hubs/invoice-generation` : payload
 * NON FIABLE. Stricte sur `jobId` et `status` (porteurs de sens : sans eux,
 * impossible de rattacher ou d'interpréter l'événement), tolérante sur les
 * compteurs et le message (présentation dégradée, jamais bloquante).
 */
export function parseInvoiceGenerationProgress(
  raw: unknown
): InvoiceGenerationProgressEvent | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const jobId = value['jobId'];
  if (typeof jobId !== 'string' || jobId.trim().length === 0) {
    return null;
  }
  const rawStatus = value['status'];
  if (
    typeof rawStatus !== 'number' ||
    !Number.isInteger(rawStatus) ||
    rawStatus < 0 ||
    rawStatus >= HUB_STATUSES.length
  ) {
    return null;
  }
  const message = value['message'];
  const timestamp = value['timestampUtc'];

  return {
    jobId,
    status: HUB_STATUSES[rawStatus],
    processed: readCount(value['processed']),
    total: readCount(value['total']),
    message: typeof message === 'string' && message.length > 0 ? message : null,
    timestampUtc: typeof timestamp === 'string' ? timestamp : ''
  };
}
