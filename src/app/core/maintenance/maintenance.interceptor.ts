import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ProblemDetails } from '../api/problem-details';
import { DEFAULT_MAINTENANCE_MESSAGE } from './maintenance-state';
import { MAINTENANCE_ENDPOINT_PREFIX } from './maintenance-api';
import { MaintenanceService } from './maintenance.service';

/**
 * Endpoints qui doivent rester joignables même une fois l'application figée :
 * - `/api/maintenance*` : plan de contrôle. Sans lui l'application ne pourrait
 *   jamais apprendre la fin de la maintenance, ni la lever. `GET` est anonyme
 *   côté API ; `start`/`stop` exigent la permission `Maintenance.Manage`, donc
 *   un Bearer — que `authInterceptor` pose ensuite normalement.
 * - `/api/auth/revoke` : la déconnexion forcée doit pouvoir révoquer le refresh
 *   token.
 */
const ALWAYS_ALLOWED_PATHS: readonly string[] = [
  MAINTENANCE_ENDPOINT_PREFIX,
  '/api/auth/revoke'
];

/** Ouvrir une session est refusé dès l'annonce, sursis compris. */
const LOGIN_PATH = '/api/auth/login';

/** Renouvellement de jeton : voir la règle dans `maintenanceInterceptor`. */
const REFRESH_PATH = '/api/auth/refresh';

function maintenanceError(url: string, message: string): HttpErrorResponse {
  const problem: ProblemDetails = { status: 503, title: message };
  return new HttpErrorResponse({
    url,
    status: 503,
    statusText: 'Service Unavailable',
    error: problem
  });
}

function resolveMessage(maintenance: MaintenanceService): string {
  return maintenance.message() || DEFAULT_MAINTENANCE_MESSAGE;
}

/**
 * Refuse localement les requêtes vers l'API métier pendant une maintenance : la
 * requête ne part pas sur le réseau et l'appelant reçoit un 503 porteur du
 * message du serveur, exploité tel quel par `extractApiErrorMessage`. Aucun
 * écran métier n'a donc besoin de connaître la maintenance.
 *
 * Le blocage n'intervient qu'une fois l'application **figée** : pendant le
 * sursis, tout reste permis pour que l'utilisateur enregistre son travail — à
 * l'exception de la connexion, aucune nouvelle session ne devant être ouverte.
 *
 * Le renouvellement de jeton reste ouvert à la fenêtre qui a déclenché la
 * maintenance, même figée : elle garde sa session pour pouvoir lever la
 * maintenance, et une expiration d'access token la bloquerait dehors.
 *
 * À enregistrer AVANT `authInterceptor` (cf. `app.config.ts`) pour
 * court-circuiter avant toute pose de Bearer ou tentative de renouvellement.
 */
export const maintenanceInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBaseUrl)) {
    return next(req);
  }

  const path = req.url.slice(environment.apiBaseUrl.length).toLowerCase();
  // Testé AVANT l'injection du service : le `GET /api/Maintenance` émis par
  // `MaintenanceService` lui-même ne doit pas réinjecter le service en cours de
  // construction (dépendance circulaire).
  if (ALWAYS_ALLOWED_PATHS.some((allowed) => path.startsWith(allowed))) {
    return next(req);
  }

  const maintenance = inject(MaintenanceService);
  if (path.startsWith(REFRESH_PATH)) {
    return maintenance.initiatedLocally() || !maintenance.frozen()
      ? next(req)
      : throwError(() => maintenanceError(req.url, resolveMessage(maintenance)));
  }

  const blocked =
    maintenance.frozen() || (maintenance.inGrace() && path.startsWith(LOGIN_PATH));
  if (!blocked) {
    return next(req);
  }

  return throwError(() => maintenanceError(req.url, resolveMessage(maintenance)));
};
