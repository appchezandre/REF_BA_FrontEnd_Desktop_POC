import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { extractApiErrorMessage } from '../api/problem-details';
import { ShellUiService } from '../shell/shell-ui.service';
import { InvoicingApi } from './invoicing-api';
import {
  InvoiceGenerationHubClient,
  InvoiceGenerationHubStatus
} from './invoice-generation-hub.client';
import { InvoiceGenerationJob, isActiveStatus } from './invoice-generation.model';
import {
  InvoiceGenerationProgressEvent,
  parseGenerateInvoicesResponse,
  parseInvoiceGenerationProgress
} from './invoicing.mapper';

/**
 * Sans événement hub pendant ce délai, le suivi est marqué « silencieux » :
 * le backend n'expose pas de lecture d'état (pas de `GET /api/Invoices/{id}`),
 * il n'y a donc aucun repli HTTP possible — on ne peut qu'attendre.
 */
export const STALE_AFTER_MS = 10_000;

export type InvoiceGenerationCommandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * Suivi du job de génération des factures dans le renderer.
 *
 * Un seul job est suivi à la fois (le modèle `job: InvoiceGenerationJob | null`
 * resterait extensible vers une liste). Le suivi est **local à la fenêtre
 * courante** : pas de synchronisation inter-fenêtres dans cette itération —
 * chaque fenêtre qui lancerait un traitement suivrait le sien.
 *
 * Chronologie d'un lancement (course assumée) : le hub est connecté AVANT le
 * POST, mais l'abonnement au groupe `invoice-job-{id}` ne peut partir qu'une
 * fois le jobId connu, alors que le job démarre dès la réponse HTTP.
 * L'événement `Started` peut donc être manqué : l'état initial `pending` et le
 * premier `Running` reçu couvrent ce cas.
 *
 * Après `Failed`, Hangfire réessaie côté serveur : le même jobId peut réémettre
 * `Started`/`Running` — on reste donc abonné. Après `Completed`/`Cancelled`,
 * plus rien n'arrivera : désabonnement et arrêt du hub, le résultat reste
 * affiché jusqu'à `dismiss()`.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceGenerationService {
  private readonly api = inject(InvoicingApi);
  private readonly hub = inject(InvoiceGenerationHubClient);
  private readonly shellUi = inject(ShellUiService);

  private readonly jobSignal = signal<InvoiceGenerationJob | null>(null);
  private readonly hubConnectedSignal = signal(false);
  private readonly staleSignal = signal(false);
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  readonly job = this.jobSignal.asReadonly();
  readonly hubConnected = this.hubConnectedSignal.asReadonly();
  /** Aucun événement reçu depuis `STALE_AFTER_MS` alors que le job est actif. */
  readonly stale = this.staleSignal.asReadonly();

  /** Pourcentage d'avancement, null si indéterminé (aucun total connu). */
  readonly progressPercent = computed(() => {
    const job = this.jobSignal();
    return job && job.total > 0
      ? Math.min(100, Math.round((job.processed / job.total) * 100))
      : null;
  });

  /** L'annulation peut être demandée (job actif, pas déjà demandée). */
  readonly canCancel = computed(() => {
    const job = this.jobSignal();
    return job !== null && !job.cancelRequested && isActiveStatus(job.status);
  });

  /** Un job attend ou produit encore des événements (alimente la pastille). */
  readonly isActive = computed(() => {
    const job = this.jobSignal();
    return job !== null && isActiveStatus(job.status);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.clearStaleTimer();
      void this.hub.stop();
    });
  }

  /**
   * Lance la génération des factures d'une période et en démarre le suivi.
   * Un 409 (génération déjà en cours pour la période) n'est pas une erreur :
   * le suivi reprend sur le job existant (`resumed`).
   */
  async launch(year: number, month: number): Promise<InvoiceGenerationCommandResult> {
    // Connexion AVANT le POST : le job démarre dès la réponse HTTP, chaque
    // instant gagné réduit la fenêtre d'événements manqués. Un échec n'est
    // pas bloquant : le traitement doit pouvoir partir même sans temps réel.
    const connected = await this.hub.start({
      onProgress: (payload) => this.onProgress(payload),
      onStatusChange: (status) => this.onHubStatusChange(status)
    });
    this.hubConnectedSignal.set(connected);

    let jobId: string;
    let resumed = false;
    try {
      jobId = (await this.api.generate({ year, month })).jobId;
    } catch (error) {
      const existing = this.parseConflict(error);
      if (existing === null) {
        return {
          ok: false,
          error: extractApiErrorMessage(
            error,
            'Impossible de lancer la génération des factures.'
          )
        };
      }
      jobId = existing;
      resumed = true;
    }

    const previous = this.jobSignal();
    if (previous !== null && previous.jobId !== jobId) {
      void this.hub.unsubscribeFromJob(previous.jobId);
    }

    this.jobSignal.set({
      jobId,
      year,
      month,
      status: 'pending',
      processed: 0,
      total: 0,
      message: null,
      lastUpdateUtc: null,
      resumed,
      cancelRequested: false
    });
    this.staleSignal.set(false);
    this.armStaleTimer();
    this.shellUi.setJobActivity(true);
    void this.hub.subscribeToJob(jobId);
    return { ok: true };
  }

  /**
   * Demande l'annulation coopérative du job suivi. Le 202 ne fait que marquer
   * la demande : l'état final `cancelled` arrivera par le hub.
   */
  async cancel(): Promise<InvoiceGenerationCommandResult> {
    const job = this.jobSignal();
    if (job === null || !this.canCancel()) {
      return { ok: false, error: 'Aucun traitement annulable.' };
    }
    try {
      await this.api.cancel(job.jobId);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        return { ok: false, error: 'Traitement introuvable côté serveur.' };
      }
      if (error instanceof HttpErrorResponse && error.status === 409) {
        // Terminé entre-temps : l'événement final du hub fera foi.
        return { ok: false, error: 'Le traitement est déjà terminé.' };
      }
      return {
        ok: false,
        error: extractApiErrorMessage(error, "Impossible d'annuler le traitement.")
      };
    }
    this.jobSignal.update((current) =>
      current === null ? current : { ...current, cancelRequested: true }
    );
    return { ok: true };
  }

  /** Efface le suivi affiché (action utilisateur sur un job terminé ou non). */
  dismiss(): void {
    this.clearStaleTimer();
    this.jobSignal.set(null);
    this.staleSignal.set(false);
    this.shellUi.setJobActivity(false);
    void this.hub.stop();
    this.hubConnectedSignal.set(false);
  }

  /** Événement du hub : payload non fiable, rattaché au job suivi seulement. */
  private onProgress(payload: unknown): void {
    const event = parseInvoiceGenerationProgress(payload);
    const job = this.jobSignal();
    if (!event || job === null || event.jobId !== job.jobId) {
      return;
    }
    this.jobSignal.set(this.merge(job, event));
    this.staleSignal.set(false);

    if (event.status === 'completed' || event.status === 'cancelled') {
      // Plus rien n'arrivera pour ce job : libérer le groupe et la connexion.
      this.clearStaleTimer();
      void this.hub.unsubscribeFromJob(event.jobId);
      void this.hub.stop();
      this.hubConnectedSignal.set(false);
    } else {
      // `failed` inclus : Hangfire réessaie, l'abonnement reste nécessaire.
      this.armStaleTimer();
    }
    this.shellUi.setJobActivity(this.isActive());
  }

  private merge(
    job: InvoiceGenerationJob,
    event: InvoiceGenerationProgressEvent
  ): InvoiceGenerationJob {
    // Reprise après échec (retry Hangfire) : la demande d'annulation
    // appartenait à la tentative précédente. Pendant un run (annulation
    // coopérative, `running` continue d'arriver), la demande reste affichée.
    const cancelRequested =
      job.status === 'failed' && isActiveStatus(event.status)
        ? false
        : job.cancelRequested;
    return {
      ...job,
      status: event.status,
      processed: event.processed,
      total: event.total,
      message: event.message ?? job.message,
      lastUpdateUtc: event.timestampUtc.length > 0 ? event.timestampUtc : job.lastUpdateUtc,
      cancelRequested
    };
  }

  private onHubStatusChange(status: InvoiceGenerationHubStatus): void {
    this.hubConnectedSignal.set(status === 'connected');
  }

  /** Corps 409 du lancement : jobId du run déjà en cours, sinon null. */
  private parseConflict(error: unknown): string | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
      return null;
    }
    return parseGenerateInvoicesResponse(error.error)?.jobId ?? null;
  }

  private armStaleTimer(): void {
    this.clearStaleTimer();
    if (this.destroyed) {
      return;
    }
    this.staleTimer = setTimeout(() => {
      this.staleTimer = null;
      if (this.isActive()) {
        this.staleSignal.set(true);
      }
    }, STALE_AFTER_MS);
  }

  private clearStaleTimer(): void {
    if (this.staleTimer === null) {
      return;
    }
    clearTimeout(this.staleTimer);
    this.staleTimer = null;
  }
}
