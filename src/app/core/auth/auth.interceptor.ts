import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/** Endpoints anonymes : jamais de Bearer ni de refresh sur 401 (anti-boucle). */
const AUTH_ENDPOINT_PREFIX = `${environment.apiBaseUrl}/api/auth/`;

function withBearer(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

/**
 * Ajoute `Authorization: Bearer` aux appels vers l'API métier. Sur un 401
 * (access token expiré), tente UN renouvellement — partagé entre requêtes
 * concurrentes via `AuthService.refreshSession` — puis rejoue la requête.
 * Si le refresh échoue, l'erreur d'origine est propagée et la session purgée
 * par le service (retour à l'écran de connexion).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (
    !req.url.startsWith(environment.apiBaseUrl) ||
    req.url.startsWith(AUTH_ENDPOINT_PREFIX)
  ) {
    return next(req);
  }

  const auth = inject(AuthService);
  const token = auth.session()?.accessToken;
  if (!token) {
    return next(req);
  }

  return next(withBearer(req, token)).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      return from(auth.refreshSession()).pipe(
        switchMap((refreshed) => {
          const renewedToken = auth.session()?.accessToken;
          if (!refreshed || !renewedToken) {
            return throwError(() => error);
          }
          return next(withBearer(req, renewedToken));
        })
      );
    })
  );
};
