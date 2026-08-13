import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { extractApiErrorMessage } from '../api/problem-details';
import { AuthService } from '../auth/auth.service';
import { WindowSyncService } from '../electron/window-sync.service';
import { MaintenanceApi } from './maintenance-api';
import { MaintenanceHubClient, MaintenanceHubStatus } from './maintenance-hub.client';
import {
  GRACE_PERIOD_MS,
  MaintenanceNotice,
  MaintenanceState,
  OPERATIONAL
} from './maintenance-state';
import {
  isSameMaintenanceState,
  parseMaintenanceNotification,
  parseSyncedMaintenanceState
} from './maintenance.mapper';

/** Sujet du bus inter-fenêtres portant l'état de maintenance. */
export const MAINTENANCE_SYNC_TOPIC = 'maintenance/state';

/** Période du sondage de repli, actif uniquement quand le hub est coupé. */
const FALLBACK_POLL_INTERVAL_MS = 30_000;

/** Cadence du décompte affiché pendant le sursis. */
const COUNTDOWN_TICK_MS = 1_000;

export type MaintenanceCommandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * Autorité de l'état de maintenance dans le renderer.
 *
 * Trois sources l'alimentent, toutes traitées comme non fiables :
 * 1. `GET /api/Maintenance` à l'amorçage (autoritaire au démarrage) ;
 * 2. le hub SignalR `/hubs/maintenance` (temps réel) ;
 * 3. le bus inter-fenêtres (une fenêtre dont le hub a échoué reste alignée).
 *
 * L'annonce d'une maintenance ouvre un **sursis** de deux minutes
 * (`GRACE_PERIOD_MS`) : l'interface reste pleinement utilisable pour que
 * l'utilisateur enregistre son travail, un bandeau affiche le décompte. À
 * l'échéance seulement, l'application gèle et la session est fermée. Toutes
 * les fenêtres partagent la même échéance (`graceDeadlineMs`), afin de geler au
 * même instant.
 *
 * Deux exceptions au sursis, où il n'y a rien à enregistrer : la maintenance est
 * **déjà active** au démarrage de l'application, et la fenêtre qui **déclenche**
 * la maintenance depuis les Paramètres. Dans ce second cas, le sursis est tout
 * de même diffusé aux autres fenêtres.
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceService {
  private readonly api = inject(MaintenanceApi);
  private readonly hub = inject(MaintenanceHubClient);
  private readonly sync = inject(WindowSyncService);
  private readonly auth = inject(AuthService);

  private readonly stateSignal = signal<MaintenanceState>(OPERATIONAL);
  private readonly remainingMsSignal = signal(0);
  private readonly initiatedLocallySignal = signal(false);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  /** Faux tant que la première lecture de l'API n'a pas été appliquée. */
  private bootstrapped = false;
  private destroyed = false;

  readonly state = this.stateSignal.asReadonly();
  readonly phase = computed(() => this.stateSignal().phase);
  /** Une maintenance est annoncée (sursis en cours ou gel effectif). */
  readonly underMaintenance = computed(() => this.phase() !== 'operational');
  /** Sursis en cours : l'interface reste utilisable pour enregistrer. */
  readonly inGrace = computed(() => this.phase() === 'grace');
  /** Gel effectif : plus aucune opération n'est possible. */
  readonly frozen = computed(() => this.phase() === 'frozen');
  readonly message = computed(() => this.stateSignal().message);
  readonly delayMinutes = computed(() => this.stateSignal().delayMinutes);
  /** Secondes restantes avant le gel (0 hors sursis). */
  readonly remainingSeconds = computed(() =>
    Math.ceil(this.remainingMsSignal() / 1000)
  );
  /**
   * Cette fenêtre a déclenché la maintenance. Elle est traitée à part : session
   * conservée, action de levée proposée sur le voile, pas de proposition de
   * quitter l'application — sinon l'opérateur se retrouverait verrouillé dehors,
   * sans moyen de remettre l'application en service.
   *
   * Repère d'ergonomie, pas une frontière de sécurité : celle-ci est côté API,
   * qui exige la permission `Maintenance.Manage` sur `start`/`stop`.
   */
  readonly initiatedLocally = this.initiatedLocallySignal.asReadonly();

  constructor() {
    // Rattrapage : maintenance déjà signalée par une autre fenêtre avant
    // l'ouverture de celle-ci (phase et échéance du sursis incluses).
    void this.sync
      .getState(MAINTENANCE_SYNC_TOPIC)
      .then((data) => this.applyFromBus(data));

    const unsubscribe = this.sync.onTopic(MAINTENANCE_SYNC_TOPIC, (data) =>
      this.applyFromBus(data)
    );

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      unsubscribe();
      this.stopPolling();
      this.stopCountdown();
      void this.hub.stop();
    });

    // Différé d'une microtâche : le premier appel HTTP traverse
    // `maintenanceInterceptor`, qui injecte ce service. L'émettre pendant la
    // construction provoquerait une dépendance circulaire côté DI.
    void Promise.resolve().then(() => this.bootstrap());
  }

  /** Passe l'application en maintenance (action d'exploitation). */
  async startMaintenance(
    delayMinutes: number | null,
    message: string | null
  ): Promise<MaintenanceCommandResult> {
    // Positionné avant l'appel : la notification de retour fige cette fenêtre,
    // qui doit conserver le moyen de lever la maintenance.
    this.initiatedLocallySignal.set(true);
    const trimmed = message?.trim() ?? '';
    try {
      const dto = await this.api.start({
        ...(delayMinutes !== null ? { delayMinutes } : {}),
        ...(trimmed.length > 0 ? { message: trimmed } : {})
      });
      // L'opérateur choisit l'instant : il n'a rien à enregistrer et gèle sans
      // attendre. Les autres fenêtres reçoivent malgré tout le sursis.
      this.applyFromServer(dto, { immediate: true });
      return { ok: true };
    } catch (error) {
      this.initiatedLocallySignal.set(false);
      return {
        ok: false,
        error: extractApiErrorMessage(
          error,
          "Impossible de passer l'application en maintenance."
        )
      };
    }
  }

  /** Lève la maintenance. */
  async stopMaintenance(): Promise<MaintenanceCommandResult> {
    try {
      const dto = await this.api.stop();
      this.applyFromServer(dto);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: extractApiErrorMessage(error, 'Impossible de lever la maintenance.')
      };
    }
  }

  private async bootstrap(): Promise<void> {
    // Appliquée avec `bootstrapped` encore faux : une maintenance déjà active
    // gèle immédiatement, sans sursis. Sans publication : au démarrage cette
    // fenêtre *apprend* l'état, elle ne l'annonce pas — publier ici écraserait
    // le sursis d'une fenêtre voisine si la réponse HTTP devançait le
    // rattrapage du bus.
    await this.refreshFromApi({ publish: false });
    this.bootstrapped = true;
    if (this.destroyed) {
      return;
    }
    const connected = await this.hub.start({
      onNotification: (payload) => this.applyFromServer(payload),
      onStatusChange: (status) => this.onHubStatusChange(status)
    });
    if (!connected) {
      this.startPolling();
    }
  }

  /** Lit l'état auprès de l'API ; silencieux si elle est injoignable. */
  private async refreshFromApi(options: { publish?: boolean } = {}): Promise<void> {
    try {
      const dto = await this.api.getState();
      this.applyFromServer(dto, options);
    } catch {
      // API injoignable : l'état connu est conservé et le sondage réessaiera.
      // Ne pas supposer la maintenance sur une simple erreur réseau.
    }
  }

  private onHubStatusChange(status: MaintenanceHubStatus): void {
    if (status === 'connected') {
      this.stopPolling();
      // L'état a pu changer pendant la coupure : le hub ne rejoue une
      // notification que si la maintenance est active.
      void this.refreshFromApi();
      return;
    }
    this.startPolling();
  }

  private startPolling(): void {
    if (this.pollTimer !== null || this.destroyed) {
      return;
    }
    this.pollTimer = setInterval(() => void this.pollTick(), FALLBACK_POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer === null) {
      return;
    }
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async pollTick(): Promise<void> {
    await this.refreshFromApi();
    if (this.destroyed) {
      return;
    }
    // Tentative de retour au temps réel : `start` est idempotent et échoue
    // immédiatement si l'API est toujours indisponible.
    if (this.hub.isConnected || (await this.hub.start())) {
      this.stopPolling();
    }
  }

  /** Notification de l'API ou du hub : appliquée puis diffusée aux fenêtres. */
  private applyFromServer(
    payload: unknown,
    options: { publish?: boolean; immediate?: boolean } = {}
  ): void {
    const notice = parseMaintenanceNotification(payload);
    if (notice) {
      this.applyNotice(notice, {
        publish: options.publish ?? true,
        immediate: options.immediate ?? false
      });
    }
  }

  /** État reçu du bus : appliqué SANS rediffusion (anti ping-pong). */
  private applyFromBus(payload: unknown): void {
    if (payload === null) {
      return;
    }
    const state = parseSyncedMaintenanceState(payload);
    if (!state) {
      return;
    }
    // La fenêtre initiatrice ne passe jamais par le sursis — pas même celui
    // qu'une voisine rediffuse avant que sa propre requête `start` n'aboutisse.
    const next: MaintenanceState =
      state.phase === 'grace' && this.initiatedLocallySignal()
        ? { ...state, phase: 'frozen', graceDeadlineMs: null }
        : state;
    this.setState(next, false);
  }

  /**
   * Traduit une annonce du serveur en phase. Le sursis n'est ouvert qu'à la
   * transition ; une mise à jour du message ou du délai en cours de maintenance
   * ne le redémarre pas et ne rejoue pas le gel.
   */
  private applyNotice(
    notice: MaintenanceNotice,
    options: { publish: boolean; immediate: boolean }
  ): void {
    const current = this.stateSignal();

    if (!notice.underMaintenance) {
      this.setState(OPERATIONAL, options.publish);
      return;
    }

    if (current.phase !== 'operational') {
      this.setState(
        {
          ...current,
          delayMinutes: notice.delayMinutes,
          message: notice.message,
          changedAtUtc: notice.changedAtUtc
        },
        options.publish
      );
      return;
    }

    // --- Transition vers la maintenance ---
    const announced = {
      delayMinutes: notice.delayMinutes,
      message: notice.message,
      changedAtUtc: notice.changedAtUtc
    };
    const graceState: MaintenanceState = {
      ...announced,
      phase: 'grace',
      graceDeadlineMs: Date.now() + GRACE_PERIOD_MS
    };

    // Ce qui est diffusé est TOUJOURS le sursis : les autres fenêtres ont du
    // travail à protéger, même quand celle-ci gèle sans attendre. C'est le seul
    // endroit où l'état publié diffère de l'état local.
    if (options.publish) {
      this.sync.publish(MAINTENANCE_SYNC_TOPIC, graceState);
    }

    // Gel sans sursis quand il n'y a rien à enregistrer : l'opérateur qui
    // déclenche la maintenance (`immediate` — ou `initiatedLocally`, posé avant
    // l'appel `start` : le serveur diffuse la notification au hub AVANT de
    // répondre au POST, et ce chemin-là n'est pas marqué `immediate`), et une
    // maintenance déjà active au démarrage.
    const withGrace =
      !options.immediate && !this.initiatedLocallySignal() && this.bootstrapped;
    this.setState(
      withGrace ? graceState : { ...announced, phase: 'frozen', graceDeadlineMs: null },
      false
    );
  }

  private setState(next: MaintenanceState, publish: boolean): void {
    const previous = this.stateSignal();
    if (isSameMaintenanceState(previous, next)) {
      return;
    }
    this.stateSignal.set(next);

    if (publish) {
      this.sync.publish(MAINTENANCE_SYNC_TOPIC, next);
    }

    this.syncCountdown();

    if (next.phase === 'operational') {
      this.initiatedLocallySignal.set(false);
      return;
    }
    if (next.phase === 'frozen' && previous.phase !== 'frozen') {
      // Le voile est déjà rendu (signal positionné) : TOUTES les sessions de
      // la pile sont fermées ensuite (pas seulement l'active — un simple
      // dépilement rendrait la main à l'utilisateur précédent), ce qui se
      // propage à toutes les fenêtres par `auth/state`.
      //
      // Exception : la fenêtre qui a déclenché la maintenance CONSERVE sa
      // pile. `POST /api/Maintenance/stop` exige la permission
      // `Maintenance.Manage` ; la déconnecter la priverait du seul moyen de
      // lever la maintenance.
      if (!this.initiatedLocallySignal() && this.auth.isAuthenticated()) {
        void this.auth.logoutAll();
      }
    }
  }

  /** Aligne le minuteur de décompte sur la phase courante. */
  private syncCountdown(): void {
    const { phase, graceDeadlineMs } = this.stateSignal();
    if (phase !== 'grace' || graceDeadlineMs === null) {
      this.stopCountdown();
      this.remainingMsSignal.set(0);
      return;
    }

    const remaining = Math.max(0, graceDeadlineMs - Date.now());
    this.remainingMsSignal.set(remaining);
    if (remaining === 0) {
      // Échéance déjà passée : cas d'une fenêtre qui rattrape un sursis expiré.
      this.freezeNow();
      return;
    }
    if (this.countdownTimer === null && !this.destroyed) {
      this.countdownTimer = setInterval(() => this.tickCountdown(), COUNTDOWN_TICK_MS);
    }
  }

  private stopCountdown(): void {
    if (this.countdownTimer === null) {
      return;
    }
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  private tickCountdown(): void {
    const { graceDeadlineMs } = this.stateSignal();
    if (graceDeadlineMs === null) {
      this.stopCountdown();
      return;
    }
    const remaining = Math.max(0, graceDeadlineMs - Date.now());
    this.remainingMsSignal.set(remaining);
    if (remaining === 0) {
      this.freezeNow();
    }
  }

  /**
   * Fin du sursis. Chaque fenêtre atteint la même échéance et gèle d'elle-même ;
   * la publication maintient l'état retenu par Electron Main exact (les
   * rediffusions redondantes sont absorbées par `isSameMaintenanceState`).
   */
  private freezeNow(): void {
    const current = this.stateSignal();
    if (current.phase !== 'grace') {
      return;
    }
    this.setState({ ...current, phase: 'frozen', graceDeadlineMs: null }, true);
  }
}
