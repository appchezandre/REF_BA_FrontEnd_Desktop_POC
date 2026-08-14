import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellUiService } from '../shell/shell-ui.service';
import { InvoicingApi } from './invoicing-api';
import {
  InvoiceGenerationHubClient,
  InvoiceGenerationHubHandlers
} from './invoice-generation-hub.client';
import {
  InvoiceGenerationService,
  STALE_AFTER_MS
} from './invoice-generation.service';

const JOB_ID = 'job-1';

function progressPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    jobId: JOB_ID,
    status: 1,
    processed: 10,
    total: 50,
    message: 'En cours.',
    timestampUtc: '2026-08-14T09:00:00Z',
    ...overrides
  };
}

describe('InvoiceGenerationService', () => {
  let api: { generate: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
  let hub: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    subscribeToJob: ReturnType<typeof vi.fn>;
    unsubscribeFromJob: ReturnType<typeof vi.fn>;
  };
  /** Gestionnaires transmis au hub, pour simuler ses événements. */
  let hubHandlers: InvoiceGenerationHubHandlers | null;
  /** Journal d'ordre des appels : la connexion hub doit précéder le POST. */
  let calls: string[];
  let shellUi: ShellUiService;

  beforeEach(() => {
    vi.useFakeTimers();
    hubHandlers = null;
    calls = [];

    api = {
      generate: vi.fn(() => {
        calls.push('generate');
        return Promise.resolve({ jobId: JOB_ID, message: 'Démarrée.' });
      }),
      cancel: vi.fn(() => Promise.resolve())
    };
    hub = {
      start: vi.fn((handlers?: InvoiceGenerationHubHandlers) => {
        calls.push('hub.start');
        if (handlers) {
          hubHandlers = handlers;
        }
        return Promise.resolve(true);
      }),
      stop: vi.fn(() => Promise.resolve()),
      subscribeToJob: vi.fn((jobId: string) => {
        calls.push(`subscribe:${jobId}`);
        return Promise.resolve(true);
      }),
      unsubscribeFromJob: vi.fn(() => Promise.resolve())
    };

    TestBed.configureTestingModule({
      providers: [
        InvoiceGenerationService,
        { provide: InvoicingApi, useValue: api },
        { provide: InvoiceGenerationHubClient, useValue: hub }
      ]
    });
    shellUi = TestBed.inject(ShellUiService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createService(): InvoiceGenerationService {
    return TestBed.inject(InvoiceGenerationService);
  }

  it('connecte le hub AVANT le POST puis s’abonne au job retourné', async () => {
    const service = createService();

    const result = await service.launch(2026, 7);

    expect(result).toEqual({ ok: true });
    expect(calls.indexOf('hub.start')).toBeLessThan(calls.indexOf('generate'));
    expect(calls).toContain(`subscribe:${JOB_ID}`);
    expect(service.job()).toMatchObject({
      jobId: JOB_ID,
      year: 2026,
      month: 7,
      status: 'pending',
      resumed: false,
      cancelRequested: false
    });
    expect(service.isActive()).toBe(true);
    expect(shellUi.jobActivity()).toBe(true);
  });

  it('reprend le suivi du job existant sur un 409 (resumed)', async () => {
    api.generate.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 409,
        error: { jobId: 'job-existing', message: 'Déjà en cours.' }
      })
    );
    const service = createService();

    const result = await service.launch(2026, 7);

    expect(result).toEqual({ ok: true });
    expect(service.job()).toMatchObject({ jobId: 'job-existing', resumed: true });
    expect(calls).toContain('subscribe:job-existing');
  });

  it('rend le message ProblemDetails sur un échec du POST (400)', async () => {
    api.generate.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 400,
        error: { status: 400, title: 'Le mois doit être compris entre 1 et 12.' }
      })
    );
    const service = createService();

    const result = await service.launch(2026, 13);

    expect(result).toEqual({
      ok: false,
      error: 'Le mois doit être compris entre 1 et 12.'
    });
    expect(service.job()).toBeNull();
    expect(shellUi.jobActivity()).toBe(false);
  });

  it('applique les événements de progression du job suivi', async () => {
    const service = createService();
    await service.launch(2026, 7);

    hubHandlers?.onProgress(progressPayload());

    expect(service.job()).toMatchObject({
      status: 'running',
      processed: 10,
      total: 50,
      message: 'En cours.',
      lastUpdateUtc: '2026-08-14T09:00:00Z'
    });
    expect(service.progressPercent()).toBe(20);
  });

  it("ignore les événements d'un autre job et les payloads invalides", async () => {
    const service = createService();
    await service.launch(2026, 7);

    hubHandlers?.onProgress(progressPayload({ jobId: 'autre' }));
    hubHandlers?.onProgress({ status: 1 });
    hubHandlers?.onProgress(null);

    expect(service.job()?.status).toBe('pending');
  });

  it('libère le groupe et la connexion sur Completed', async () => {
    const service = createService();
    await service.launch(2026, 7);

    hubHandlers?.onProgress(progressPayload({ status: 2, processed: 50 }));

    expect(service.job()?.status).toBe('completed');
    expect(hub.unsubscribeFromJob).toHaveBeenCalledWith(JOB_ID);
    expect(hub.stop).toHaveBeenCalled();
    expect(service.isActive()).toBe(false);
    expect(shellUi.jobActivity()).toBe(false);
  });

  it('reste abonné après Failed (retry Hangfire) et accepte la reprise', async () => {
    const service = createService();
    await service.launch(2026, 7);

    hubHandlers?.onProgress(progressPayload({ status: 3 }));
    expect(service.job()?.status).toBe('failed');
    expect(hub.stop).not.toHaveBeenCalled();
    expect(hub.unsubscribeFromJob).not.toHaveBeenCalled();

    hubHandlers?.onProgress(progressPayload({ status: 0, processed: 0 }));
    expect(service.job()?.status).toBe('started');
    expect(service.isActive()).toBe(true);
  });

  it("marque l'annulation demandée sur un 202 ; l'état final vient du hub", async () => {
    const service = createService();
    await service.launch(2026, 7);

    const result = await service.cancel();

    expect(result).toEqual({ ok: true });
    expect(api.cancel).toHaveBeenCalledWith(JOB_ID);
    expect(service.job()?.cancelRequested).toBe(true);
    expect(service.canCancel()).toBe(false);

    // L'annulation coopérative continue d'émettre Running : la demande reste.
    hubHandlers?.onProgress(progressPayload());
    expect(service.job()?.cancelRequested).toBe(true);

    hubHandlers?.onProgress(progressPayload({ status: 4 }));
    expect(service.job()?.status).toBe('cancelled');
    expect(hub.stop).toHaveBeenCalled();
  });

  it("traduit les échecs d'annulation 404 et 409", async () => {
    const service = createService();
    await service.launch(2026, 7);

    api.cancel.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    expect(await service.cancel()).toEqual({
      ok: false,
      error: 'Traitement introuvable côté serveur.'
    });

    api.cancel.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
    expect(await service.cancel()).toEqual({
      ok: false,
      error: 'Le traitement est déjà terminé.'
    });
    expect(service.job()?.cancelRequested).toBe(false);
  });

  it('signale un suivi silencieux sans événement, levé au premier reçu', async () => {
    const service = createService();
    await service.launch(2026, 7);
    expect(service.stale()).toBe(false);

    vi.advanceTimersByTime(STALE_AFTER_MS);
    expect(service.stale()).toBe(true);

    hubHandlers?.onProgress(progressPayload());
    expect(service.stale()).toBe(false);
  });

  it('ne marque pas silencieux un job déjà terminé', async () => {
    const service = createService();
    await service.launch(2026, 7);

    hubHandlers?.onProgress(progressPayload({ status: 2, processed: 50 }));
    vi.advanceTimersByTime(STALE_AFTER_MS);

    expect(service.stale()).toBe(false);
  });

  it('efface le suivi et coupe le hub sur dismiss', async () => {
    const service = createService();
    await service.launch(2026, 7);

    service.dismiss();

    expect(service.job()).toBeNull();
    expect(hub.stop).toHaveBeenCalled();
    expect(shellUi.jobActivity()).toBe(false);
  });

  it('suit la connectivité annoncée par le hub', async () => {
    const service = createService();
    await service.launch(2026, 7);
    expect(service.hubConnected()).toBe(true);

    hubHandlers?.onStatusChange('disconnected');
    expect(service.hubConnected()).toBe(false);

    hubHandlers?.onStatusChange('connected');
    expect(service.hubConnected()).toBe(true);
  });
});
