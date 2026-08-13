import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { WindowSyncService } from '../electron/window-sync.service';
import { extractApiErrorMessage } from '../api/problem-details';
import { AuthApi } from './auth-api';
import { AuthSession, SyncedAuthState } from './auth-session';
import { mapAuthResponseToSession, parseSyncedAuthState } from './auth.mapper';

/** Sujet du bus inter-fenêtres portant l'état d'authentification. */
const AUTH_SYNC_TOPIC = 'auth/state';

/**
 * Marge avant expiration de l'access token au-delà de laquelle une session
 * reprise après dépilement est renouvelée d'office (évite un 401 immédiat).
 */
const RESUME_EXPIRY_MARGIN_MS = 30_000;

export type LoginResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * Autorité de session du renderer : login, changement d'utilisateur, refresh,
 * logout, identité. Les sessions forment une PILE dont le sommet est la
 * session active : « changer d'utilisateur » empile une nouvelle session
 * (l'ancienne reste connectée mais inactive), « se déconnecter » dépile et
 * rend la main à l'utilisateur précédent. Pile vide = déconnecté.
 *
 * Les tokens vivent UNIQUEMENT en mémoire (pas de localStorage, cf. règles
 * de sécurité) ; une persistance via `safeStorage` d'Electron pourra être
 * ajoutée plus tard côté main process. La pile est propagée à toutes les
 * fenêtres par le bus IPC : une connexion (ou déconnexion) dans une fenêtre
 * s'applique immédiatement aux autres, et une fenêtre détachée après coup
 * récupère l'état retenu par Electron Main. Ne jamais journaliser les tokens.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(AuthApi);
  private readonly sync = inject(WindowSyncService);

  private readonly stackSignal = signal<readonly AuthSession[]>([]);
  /** Refresh en cours partagé (single-flight) : un seul appel API à la fois. */
  private refreshInFlight: Promise<boolean> | null = null;

  /** Session active (sommet de la pile), null si déconnecté. */
  readonly session = computed(() => this.stackSignal().at(-1) ?? null);
  readonly isAuthenticated = computed(() => this.stackSignal().length > 0);
  readonly user = computed(() => this.session()?.user ?? null);
  /** Nombre total de sessions empilées (active comprise). */
  readonly sessionCount = computed(() => this.stackSignal().length);
  /** Utilisateur qui redeviendra actif à la prochaine déconnexion. */
  readonly previousUser = computed(() => this.stackSignal().at(-2)?.user ?? null);

  constructor() {
    // Rattrapage : pile établie par une autre fenêtre avant l'ouverture
    // de celle-ci (cas typique : fenêtre détachée après connexion).
    void this.sync
      .getState(AUTH_SYNC_TOPIC)
      .then((data) => this.applySyncedState(data));

    const unsubscribe = this.sync.onTopic(AUTH_SYNC_TOPIC, (data) =>
      this.applySyncedState(data)
    );
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  /** Connexion initiale : la pile est remplacée par cette seule session. */
  async login(email: string, password: string): Promise<LoginResult> {
    const result = await this.authenticate(email, password);
    if (!result.ok) {
      return result;
    }
    this.stackSignal.set([result.session]);
    this.publishState();
    return { ok: true };
  }

  /**
   * Changement d'utilisateur : empile une nouvelle session, l'utilisateur
   * précédent reste connecté mais inactif. Si le même utilisateur figure
   * déjà dans la pile, son ancienne session est retirée (et son refresh
   * token révoqué en meilleur effort) : jamais deux sessions d'un même
   * utilisateur, un « retour » vers lui serait ambigu.
   */
  async switchUser(email: string, password: string): Promise<LoginResult> {
    const result = await this.authenticate(email, password);
    if (!result.ok) {
      return result;
    }
    const displaced = this.stackSignal().filter((s) =>
      this.sameUser(s, result.session)
    );
    this.stackSignal.update((stack) => [
      ...stack.filter((s) => !this.sameUser(s, result.session)),
      result.session
    ]);
    this.publishState();
    for (const session of displaced) {
      void this.revokeQuietly(session);
    }
    return { ok: true };
  }

  /**
   * Déconnexion de l'utilisateur actif : dépile le sommet (purge locale
   * immédiate, propagée à toutes les fenêtres), révoque son refresh token en
   * meilleur effort, puis rend la main à la session précédente — renouvelée
   * si son access token a expiré pendant son inactivité.
   */
  async logout(): Promise<void> {
    const popped = this.session();
    if (!popped) {
      return;
    }
    this.stackSignal.update((stack) => stack.slice(0, -1));
    this.publishState();
    void this.revokeQuietly(popped);
    await this.resumeTopSession();
  }

  /**
   * Déconnexion complète : vide la pile (toutes les fenêtres repassent à la
   * page de connexion) et révoque chaque refresh token en meilleur effort.
   * Utilisée par le gel de maintenance.
   */
  async logoutAll(): Promise<void> {
    const sessions = this.stackSignal();
    if (sessions.length === 0) {
      return;
    }
    this.stackSignal.set([]);
    this.publishState();
    await Promise.all(sessions.map((session) => this.revokeQuietly(session)));
  }

  /**
   * Renouvelle la session active (rotation du refresh token). Single-flight :
   * les appels concurrents (plusieurs 401 simultanés) partagent la même
   * requête. Retourne false si le renouvellement échoue ; la session n'est
   * retirée de la pile que si le serveur rejette le token (session expirée),
   * pas sur erreur réseau.
   */
  refreshSession(): Promise<boolean> {
    this.refreshInFlight ??= this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async authenticate(
    email: string,
    password: string
  ): Promise<{ ok: true; session: AuthSession } | { ok: false; error: string }> {
    try {
      const dto = await this.api.login({ email, password });
      return { ok: true, session: mapAuthResponseToSession(dto) };
    } catch (error) {
      return { ok: false, error: extractApiErrorMessage(error, 'Échec de la connexion.') };
    }
  }

  /** Deux sessions appartiennent-elles au même utilisateur ? Repli sur
   *  l'e-mail si l'id est vide (claims JWT indécodables). */
  private sameUser(a: AuthSession, b: AuthSession): boolean {
    if (a.user.id !== '' && b.user.id !== '') {
      return a.user.id === b.user.id;
    }
    return a.user.email !== '' && a.user.email === b.user.email;
  }

  /**
   * Après un dépilement : renouvelle la session reprise si son access token
   * est expiré. Sur rejet serveur, `doRefresh` retire la session de la pile,
   * on continue alors avec la suivante — jusqu'à une session valide ou une
   * pile vide. Sur erreur réseau, la session est conservée telle quelle :
   * l'intercepteur retentera un refresh au premier 401.
   */
  private async resumeTopSession(): Promise<void> {
    for (;;) {
      const top = this.session();
      if (!top || !this.isExpired(top)) {
        return;
      }
      const refreshed = await this.refreshSession();
      if (refreshed) {
        return;
      }
      if (this.session() === top) {
        // Échec sans retrait de la pile (erreur réseau) : on garde la session.
        return;
      }
    }
  }

  private isExpired(session: AuthSession): boolean {
    const expiresAt = Date.parse(session.accessTokenExpiresAtUtc);
    return Number.isFinite(expiresAt)
      ? expiresAt - Date.now() <= RESUME_EXPIRY_MARGIN_MS
      : false;
  }

  private async doRefresh(): Promise<boolean> {
    // La session est capturée au départ : pendant l'await, la pile peut
    // changer (switchUser, logout, sync d'une autre fenêtre). Le résultat
    // s'applique à CETTE session (retrouvée par son refresh token), jamais
    // au sommet courant.
    const session = this.session();
    if (!session) {
      return false;
    }
    try {
      const dto = await this.api.refresh({ refreshToken: session.refreshToken });
      const renewed = mapAuthResponseToSession(dto);
      this.stackSignal.update((stack) =>
        stack.map((s) => (s.refreshToken === session.refreshToken ? renewed : s))
      );
      this.publishState();
      return true;
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        (error.status === 400 || error.status === 401)
      ) {
        // Refresh token rejeté : cette session est expirée pour toutes les
        // fenêtres, elle est retirée de la pile (les autres survivent).
        this.stackSignal.update((stack) =>
          stack.filter((s) => s.refreshToken !== session.refreshToken)
        );
        this.publishState();
      }
      return false;
    }
  }

  /** Révocation serveur en meilleur effort : la pile locale est déjà à jour
   *  et le refresh token expirera de lui-même côté serveur en cas d'échec. */
  private async revokeQuietly(session: AuthSession): Promise<void> {
    try {
      await this.api.revoke({ refreshToken: session.refreshToken });
    } catch {
      // Ignoré volontairement (best-effort).
    }
  }

  /** Publie la pile courante vers les autres fenêtres (et l'état retenu). */
  private publishState(): void {
    const state: SyncedAuthState = { sessions: this.stackSignal() };
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
    this.stackSignal.set(state.sessions);
  }
}
