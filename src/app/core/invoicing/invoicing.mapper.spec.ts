import { describe, expect, it } from 'vitest';
import {
  parseGenerateInvoicesResponse,
  parseInvoiceGenerationProgress
} from './invoicing.mapper';

describe('parseGenerateInvoicesResponse', () => {
  it('convertit une réponse valide (202 comme corps de 409)', () => {
    const dto = parseGenerateInvoicesResponse({
      jobId: '7f9c0d7e-1b7a-4e5f-9f7d-2a4a2f6b8c1e',
      message: 'Génération des factures démarrée.'
    });

    expect(dto).toEqual({
      jobId: '7f9c0d7e-1b7a-4e5f-9f7d-2a4a2f6b8c1e',
      message: 'Génération des factures démarrée.'
    });
  });

  it('rejette les payloads sans jobId exploitable', () => {
    expect(parseGenerateInvoicesResponse(null)).toBeNull();
    expect(parseGenerateInvoicesResponse(undefined)).toBeNull();
    expect(parseGenerateInvoicesResponse('abc')).toBeNull();
    expect(parseGenerateInvoicesResponse({})).toBeNull();
    expect(parseGenerateInvoicesResponse({ jobId: 42 })).toBeNull();
    expect(parseGenerateInvoicesResponse({ jobId: '   ' })).toBeNull();
  });

  it('tolère un message absent ou malformé (affichage seulement)', () => {
    expect(parseGenerateInvoicesResponse({ jobId: 'abc' })?.message).toBe('');
    expect(parseGenerateInvoicesResponse({ jobId: 'abc', message: 12 })?.message).toBe('');
  });
});

describe('parseInvoiceGenerationProgress', () => {
  const valid = {
    jobId: 'abc',
    status: 1,
    processed: 10,
    total: 50,
    message: 'En cours.',
    timestampUtc: '2026-08-14T09:00:00+00:00'
  };

  it('convertit un événement valide en statut nommé', () => {
    expect(parseInvoiceGenerationProgress(valid)).toEqual({
      jobId: 'abc',
      status: 'running',
      processed: 10,
      total: 50,
      message: 'En cours.',
      timestampUtc: '2026-08-14T09:00:00+00:00'
    });
  });

  it('traduit chaque valeur numérique du statut', () => {
    const expected = ['started', 'running', 'completed', 'failed', 'cancelled'];
    expected.forEach((status, value) => {
      expect(parseInvoiceGenerationProgress({ ...valid, status: value })?.status).toBe(
        status
      );
    });
  });

  it('rejette les payloads sans jobId exploitable', () => {
    expect(parseInvoiceGenerationProgress(null)).toBeNull();
    expect(parseInvoiceGenerationProgress({ ...valid, jobId: undefined })).toBeNull();
    expect(parseInvoiceGenerationProgress({ ...valid, jobId: 42 })).toBeNull();
    expect(parseInvoiceGenerationProgress({ ...valid, jobId: '' })).toBeNull();
  });

  it('rejette un statut hors bornes ou non numérique', () => {
    expect(parseInvoiceGenerationProgress({ ...valid, status: 5 })).toBeNull();
    expect(parseInvoiceGenerationProgress({ ...valid, status: -1 })).toBeNull();
    expect(parseInvoiceGenerationProgress({ ...valid, status: 1.5 })).toBeNull();
    expect(parseInvoiceGenerationProgress({ ...valid, status: '2' })).toBeNull();
    expect(parseInvoiceGenerationProgress({ ...valid, status: undefined })).toBeNull();
  });

  it('normalise des compteurs invalides en 0', () => {
    const cases = [-5, Number.NaN, Number.POSITIVE_INFINITY, '10', null, undefined];
    for (const count of cases) {
      const event = parseInvoiceGenerationProgress({
        ...valid,
        processed: count,
        total: count
      });
      expect(event?.processed).toBe(0);
      expect(event?.total).toBe(0);
    }
  });

  it('tolère message et horodatage absents ou malformés', () => {
    const event = parseInvoiceGenerationProgress({
      jobId: 'abc',
      status: 2,
      message: 42,
      timestampUtc: null
    });
    expect(event?.message).toBeNull();
    expect(event?.timestampUtc).toBe('');
    expect(parseInvoiceGenerationProgress({ ...valid, message: '' })?.message).toBeNull();
  });
});
