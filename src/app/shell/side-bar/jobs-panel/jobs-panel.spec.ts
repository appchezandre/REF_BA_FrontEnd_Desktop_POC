import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InvoiceGenerationJob,
  InvoiceGenerationStatus
} from '../../../core/invoicing/invoice-generation.model';
import { InvoiceGenerationService } from '../../../core/invoicing/invoice-generation.service';
import { JobsPanel } from './jobs-panel';

function makeJob(overrides: Partial<InvoiceGenerationJob> = {}): InvoiceGenerationJob {
  return {
    jobId: 'job-1',
    year: 2026,
    month: 7,
    status: 'running',
    processed: 10,
    total: 50,
    message: 'En cours.',
    lastUpdateUtc: '2026-08-14T09:00:00Z',
    resumed: false,
    cancelRequested: false,
    ...overrides
  };
}

/** Doublure du service : signaux pilotés directement par les tests. */
class ServiceStub {
  readonly job = signal<InvoiceGenerationJob | null>(null);
  readonly hubConnected = signal(true);
  readonly stale = signal(false);
  readonly cancel = vi.fn(() => Promise.resolve({ ok: true as const }));
  readonly dismiss = vi.fn();

  readonly progressPercent = () => {
    const job = this.job();
    return job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : null;
  };
  readonly canCancel = () => {
    const job = this.job();
    return (
      job !== null &&
      !job.cancelRequested &&
      ['pending', 'started', 'running'].includes(job.status)
    );
  };
  readonly isActive = () => {
    const job = this.job();
    return job !== null && ['pending', 'started', 'running'].includes(job.status);
  };
}

describe('JobsPanel', () => {
  let fixture: ComponentFixture<JobsPanel>;
  let service: ServiceStub;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function buttonByLabel(label: string): HTMLButtonElement | null {
    return (
      Array.from(element().querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === label
      ) ?? null
    );
  }

  beforeEach(() => {
    service = new ServiceStub();
    TestBed.configureTestingModule({
      providers: [{ provide: InvoiceGenerationService, useValue: service }]
    });
    fixture = TestBed.createComponent(JobsPanel);
    fixture.detectChanges();
  });

  it('affiche l’état vide avec le chemin de lancement', () => {
    expect(element().textContent).toContain('Aucun traitement en cours.');
    expect(element().textContent).toContain('Génération Factures');
  });

  it('affiche la progression d’un job en cours', () => {
    service.job.set(makeJob());
    fixture.detectChanges();

    expect(element().textContent).toContain('Génération des factures — juillet 2026');
    expect(element().textContent).toContain('En cours');
    expect(element().textContent).toContain('10 / 50 (20 %)');
    const progress = element().querySelector<HTMLProgressElement>('progress');
    expect(progress?.value).toBe(20);
    expect(buttonByLabel('Annuler')).toBeTruthy();
    expect(buttonByLabel('Masquer')).toBeNull();
  });

  it('affiche une progression indéterminée sans total connu', () => {
    service.job.set(makeJob({ status: 'pending', processed: 0, total: 0 }));
    fixture.detectChanges();

    const progress = element().querySelector<HTMLProgressElement>('progress');
    expect(progress).toBeTruthy();
    expect(progress?.hasAttribute('value')).toBe(false);
  });

  it('propose Masquer (et plus Annuler) sur un job terminé', () => {
    service.job.set(makeJob({ status: 'completed', processed: 50 }));
    fixture.detectChanges();

    expect(buttonByLabel('Annuler')).toBeNull();
    const dismissButton = buttonByLabel('Masquer');
    expect(dismissButton).toBeTruthy();

    dismissButton!.click();
    expect(service.dismiss).toHaveBeenCalled();
  });

  it('demande l’annulation au service', async () => {
    service.job.set(makeJob());
    fixture.detectChanges();

    buttonByLabel('Annuler')!.click();
    await fixture.whenStable();

    expect(service.cancel).toHaveBeenCalled();
  });

  it('affiche l’erreur d’annulation', async () => {
    service.cancel.mockResolvedValueOnce({
      ok: false,
      error: 'Le traitement est déjà terminé.'
    } as never);
    service.job.set(makeJob());
    fixture.detectChanges();

    buttonByLabel('Annuler')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element().textContent).toContain('Le traitement est déjà terminé.');
  });

  it('signale l’attente quand le hub est muet', () => {
    service.job.set(makeJob());
    service.stale.set(true);
    fixture.detectChanges();

    expect(element().textContent).toContain('En attente de nouvelles du serveur…');
  });

  it('mentionne la demande d’annulation en cours et la reprise (409)', () => {
    service.job.set(makeJob({ cancelRequested: true, resumed: true }));
    fixture.detectChanges();

    expect(element().textContent).toContain('annulation demandée');
    expect(element().textContent).toContain('suivi repris');
  });

  const failedLabel: [InvoiceGenerationStatus, string] = [
    'failed',
    'Échec — nouvelle tentative automatique'
  ];
  it('affiche l’échec avec la mention du retry automatique', () => {
    service.job.set(makeJob({ status: failedLabel[0] }));
    fixture.detectChanges();

    expect(element().textContent).toContain(failedLabel[1]);
    // Après un échec, Hangfire réessaie : Masquer reste proposé pour écarter.
    expect(buttonByLabel('Masquer')).toBeTruthy();
  });
});
