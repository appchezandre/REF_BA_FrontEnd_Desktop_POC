import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { InvoiceGenerationService } from '../../../core/invoicing/invoice-generation.service';
import { InvoiceGenerationStatus } from '../../../core/invoicing/invoice-generation.model';

const STATUS_LABELS: Record<InvoiceGenerationStatus, string> = {
  pending: 'En attente de démarrage',
  started: 'Démarré',
  running: 'En cours',
  completed: 'Terminé',
  failed: 'Échec — nouvelle tentative automatique',
  cancelled: 'Annulé'
};

/** Statuts après lesquels plus aucun événement n'arrivera (bouton Masquer). */
const TERMINAL: readonly InvoiceGenerationStatus[] = ['completed', 'failed', 'cancelled'];

/**
 * Vue « Traitements en cours » de la side bar : progression du job de
 * génération des factures suivi par `InvoiceGenerationService` (fenêtre
 * courante uniquement).
 */
@Component({
  selector: 'app-jobs-panel',
  templateUrl: './jobs-panel.html',
  styleUrl: './jobs-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JobsPanel {
  private readonly service = inject(InvoiceGenerationService);

  protected readonly job = this.service.job;
  protected readonly percent = this.service.progressPercent;
  protected readonly canCancel = this.service.canCancel;

  protected readonly cancelling = signal(false);
  protected readonly cancelError = signal<string | null>(null);

  /** « juillet 2026 » — libellé humain de la période traitée. */
  protected readonly periodLabel = computed(() => {
    const job = this.job();
    if (!job) {
      return '';
    }
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(
      new Date(job.year, job.month - 1, 1)
    );
  });

  protected readonly statusLabel = computed(() => {
    const job = this.job();
    if (!job) {
      return '';
    }
    return job.cancelRequested && !TERMINAL.includes(job.status)
      ? `${STATUS_LABELS[job.status]} — annulation demandée`
      : STATUS_LABELS[job.status];
  });

  /** Heure locale du dernier événement reçu, vide sinon. */
  protected readonly lastUpdateLabel = computed(() => {
    const raw = this.job()?.lastUpdateUtc;
    if (!raw) {
      return '';
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime())
      ? ''
      : new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' }).format(date);
  });

  /** Job actif mais hub muet : sans lecture d'état HTTP, on ne peut qu'attendre. */
  protected readonly waiting = computed(
    () => this.service.isActive() && (!this.service.hubConnected() || this.service.stale())
  );

  protected readonly terminal = computed(() => {
    const job = this.job();
    return job !== null && TERMINAL.includes(job.status);
  });

  protected async cancel(): Promise<void> {
    if (this.cancelling()) {
      return;
    }
    this.cancelling.set(true);
    this.cancelError.set(null);
    const result = await this.service.cancel();
    this.cancelling.set(false);
    if (!result.ok) {
      this.cancelError.set(result.error);
    }
  }

  protected dismiss(): void {
    this.cancelError.set(null);
    this.service.dismiss();
  }
}
