import { describe, it, expect } from 'vitest';
import { mapOrderDtoToOrder, parseSyncedOrders } from './order.mapper';
import { Order } from '../models/order';

describe('mapOrderDtoToOrder', () => {
  it('convertit les champs DTO backend vers le modèle de domaine', () => {
    const order = mapOrderDtoToOrder({
      order_number: 'CMD-1',
      customer_name: 'ACME',
      order_date: '2026-07-01',
      status: 'shipped',
      total_excl_tax: 99.5,
      notes: 'note'
    });
    expect(order).toEqual({
      orderNumber: 'CMD-1',
      customer: 'ACME',
      date: '2026-07-01',
      status: 'shipped',
      total: 99.5,
      notes: 'note'
    });
  });

  it('retombe sur "draft" pour un statut inconnu et "" sans notes', () => {
    const order = mapOrderDtoToOrder({
      order_number: 'CMD-2',
      customer_name: 'X',
      order_date: '2026-07-01',
      status: 'statut-exotique',
      total_excl_tax: 0
    });
    expect(order.status).toBe('draft');
    expect(order.notes).toBe('');
  });
});

describe('parseSyncedOrders', () => {
  const valid: Order = {
    orderNumber: 'CMD-1',
    customer: 'ACME',
    date: '2026-07-01',
    status: 'confirmed',
    total: 10,
    notes: ''
  };

  it('accepte un état valide à l’identique', () => {
    expect(parseSyncedOrders([valid])).toEqual([valid]);
  });

  it('rejette l’état entier si un seul élément est invalide (donnée IPC hostile)', () => {
    const cases: unknown[] = [
      'texte',
      { not: 'array' },
      [{ ...valid, orderNumber: '' }],
      [{ ...valid, status: 'statut-inconnu' }],
      [{ ...valid, total: Number.NaN }],
      [valid, null]
    ];
    for (const raw of cases) {
      expect(parseSyncedOrders(raw)).toBeNull();
    }
  });

  it('accepte un tableau vide et normalise les notes absentes', () => {
    expect(parseSyncedOrders([])).toEqual([]);
    const withoutNotes = { ...valid } as Record<string, unknown>;
    delete withoutNotes['notes'];
    expect(parseSyncedOrders([withoutNotes])?.[0].notes).toBe('');
  });
});
