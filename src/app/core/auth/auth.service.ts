import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { WindowSyncService } from '../electron/window-sync.service';
import { extractApiErrorMessage } from '../api/problem-details';
import { AuthApi } from './auth-api';
import { AuthSession, SyncedAuthState } from './auth-session';
import { mapAuthResponseToSession, parseSyncedAuthState } from './auth.mapper';

/** Sujet du bus inter-fenêtres portant l'état d'authentification. */
const AUTH_SYNC_TOPIC = 'auth/state';

export type LoginResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * Autorité de session du renderer : login, refresh, logout, identité.
 *
 * Les tokens vivent UNIQUEMENT en mémoire (pas de localStorage, cf. règles
 * de sécurité) ; une persistance via `safeStorage` d'Electron pourra être
 * ajoutée plus tard côté main process. La session est propagée à toutes les
 * fenêtres par le bus IPC : une connexion (ou déconnexion) dans une fenêtre
 * s'applique immédiatement aux autres, et une fenêtre détachée après coup
 * récupère l'état retenu par Electron Main. Ne jamais journaliser les tokens.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(AuthApi);
  private readonly sync = inject(WindowSyncService);

  private readonly sessionSignal = signal<AuthSession | null>(null);
  /** Refresh en cours partagé (single-flight) : un seul appel API à la fois. */
  private refreshInFlight: Promise<boolean> | null = null;

  readonly session = this.sessionSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.sessionSignal() !== null);
  readonly user = computed(() => this.sessionSignal()?.user ?? null);

  constructor() {
    // Rattrapage : session établie par une autre fenêtre avant l'ouverture
    // de celle-ci (cas typique : fenêtre détachée après connexion).
    void this.sync
      .getState(AUTH_SYNC_TOPIC)
      .then((data) => this.applySyncedState(data));

    const unsubscribe = this.sync.onTopic(AUTH_SYNC_TOPIC, (data) =>
      this.applySyncedState(data)
    );
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  async login(email: string, password: string): Promise<LoginResult> {
    try {
      const dto = await this.api.login({ email, password });
      this.sessionSignal.set(mapAuthResponseToSession(dto));
      this.publishState();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: extractApiErrorMessage(error, 'Échec de la connexion.') };
    }
  }

  /**
   * Déconnexion : purge locale immédiate (propagée à toutes les fenêtres),
   * puis révocation du refresh token côté serveur en meilleur effort.
   */
  async logout(): Promise<void> {
    const session = this.sessionSignal();
    this.sessionSignal.set(null);
    this.publishState();
    if (session) {
      try {
        await this.api.revoke({ refreshToken: session.refreshToken });
      } catch {
        // Révocation best-effort : la session locale est déjà purgée et le
        // refresh token expirera de lui-même côté serveur.
      }
    }
  }

  /**
   * Renouvelle la session (rotation du refresh token). Single-flight : les
   * appels concurrents (plusieurs 401 simultanés) partagent la même requête.
   * Retourne false si le renouvellement échoue ; la session n'est purgée que
   * si le serveur rejette le token (session expirée), pas sur erreur réseau.
   */
  refreshSession(): Promise<boolean> {
    this.refreshInFlight ??= this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<boolean> {
    const session = this.sessionSignal();
    if (!session) {
      return false;
    }
    try {
      const dto = await this.api.refresh({ refreshToken: session.refreshToken });
      this.sessionSignal.set(mapAuthResponseToSession(dto));
      this.publishState();
      return true;
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        (error.status === 400 || error.status === 401)
      ) {
        // Refresh token rejeté : session expirée pour toutes les fenêtres.
        this.sessionSignal.set(null);
        this.publishState();
      }
      return false;
    }
  }

  /** Publie l'état courant vers les autres fenêtres (et l'état retenu). */
  private publishState(): void {
    const session = this.sessionSignal();
    const state: SyncedAuthState = session
      ? { authenticated: true, session }
      : { authenticated: false };
    this.sync.publish(AUTH_SYNC_TOPIC, state);
  }

  /** Applique un état reçu du bus après validation (donnée non fiable). */
  private applySyncedState(data: unknown): void {
    if (data === null) {
      return;
    }
    const state = parseSyncedAuthState(data);
    if (!state) {
      return;
    }
    this.sessionSignal.set(state.authenticated ? state.session : null);
  }
}
