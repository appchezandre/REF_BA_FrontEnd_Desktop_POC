import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { InvoicingApi } from './invoicing-api';

const BASE = environment.apiBaseUrl;

describe('InvoicingApi', () => {
  let api: InvoicingApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    api = TestBed.inject(InvoicingApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('poste la période sur /api/Invoices/generate et rend la réponse', async () => {
    const promise = api.generate({ year: 2026, month: 7 });

    const req = http.expectOne(`${BASE}/api/Invoices/generate`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ year: 2026, month: 7 });
    req.flush({ jobId: 'job-1', message: 'Génération des factures démarrée.' });

    expect(await promise).toEqual({
      jobId: 'job-1',
      message: 'Génération des factures démarrée.'
    });
  });

  it("poste l'annulation sur /api/Invoices/{jobId}/cancel", async () => {
    const promise = api.cancel('job-1');

    const req = http.expectOne(`${BASE}/api/Invoices/job-1/cancel`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(null);

    await promise;
  });
});
