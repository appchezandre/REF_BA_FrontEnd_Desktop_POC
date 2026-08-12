import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  MaintenanceState,
  OPERATIONAL
} from './maintenance-state';
import {
  isSameMaintenanceState,
  parseMaintenanceNotification,
  parseSyncedMaintenanceState
} from './maintenance.mapper';

describe('parseMaintenanceNotification', () => {
  it('convertit une notification valide', () => {
    const state = parseMaintenanceNotification({
      isUnderMaintenance: true,
      delayMinutes: 15,
      message: 'Mise à jour de la base.',
      timestampUtc: '2026-08-12T09:00:00+00:00'
    });

    expect(state).toEqual({
      underMaintenance: true,
      delayMinutes: 15,
      message: 'Mise à jour de la base.',
      changedAtUtc: '2026-08-12T09:00:00+00:00'
    });
  });

  it('rejette les payloads qui ne portent pas le drapeau de maintenance', () => {
    expect(parseMaintenanceNotification(null)).toBeNull();
    expect(parseMaintenanceNotification(undefined)).toBeNull();
    expect(parseMaintenanceNotification('true')).toBeNull();
    expect(parseMaintenanceNotification(42)).toBeNull();
    expect(parseMaintenanceNotification({})).toBeNull();
    // Drapeau non booléen : le sens du payload est indéterminé.
    expect(parseMaintenanceNotification({ isUnderMaintenance: 'true' })).toBeNull();
    expect(parseMaintenanceNotification({ isUnderMaintenance: 1 })).toBeNull();
  });

  it('accepte un payload minimal : seul le drapeau porte du sens', () => {
    const state = parseMaintenanceNotification({ isUnderMaintenance: true });

    expect(state?.underMaintenance).toBe(true);
    // Un message manquant ne doit jamais empêcher le gel de l'interface.
    expect(state?.message).toBe(DEFAULT_MAINTENANCE_MESSAGE);
    expect(state?.delayMinutes).toBe(0);
    expect(state?.changedAtUtc).toBe('');
  });

  it('normalise un délai invalide en 0 (durée inconnue)', () => {
    const cases = [-5, 0, Number.NaN, Number.POSITIVE_INFINITY, '10', null];
    for (const delayMinutes of cases) {
      const state = parseMaintenanceNotification({
        isUnderMaintenance: true,
        delayMinutes
      });
      expect(state?.delayMinutes).toBe(0);
    }
  });

  it('tronque un délai fractionnaire', () => {
    const state = parseMaintenanceNotification({
      isUnderMaintenance: true,
      delayMinutes: 7.9
    });
    expect(state?.delayMinutes).toBe(7);
  });

  it('ne substitue pas de message par défaut hors maintenance', () => {
    const state = parseMaintenanceNotification({
      isUnderMaintenance: false,
      message: '   '
    });
    expect(state?.underMaintenance).toBe(false);
    expect(state?.message).toBe('');
  });
});

describe('parseSyncedMaintenanceState', () => {
  const grace: MaintenanceState = {
    phase: 'grace',
    delayMinutes: 5,
    message: 'Patience.',
    changedAtUtc: '2026-08-12T09:00:00Z',
    graceDeadlineMs: 1_786_000_000_000
  };

  it('conserve la phase et l’échéance du sursis', () => {
    // L'échéance est partagée : une fenêtre qui rattrape l'état ne redémarre
    // pas un sursis de zéro.
    expect(parseSyncedMaintenanceState(JSON.parse(JSON.stringify(grace)))).toEqual(grace);
  });

  it('rejette une phase absente ou inconnue', () => {
    expect(parseSyncedMaintenanceState(null)).toBeNull();
    expect(parseSyncedMaintenanceState({})).toBeNull();
    expect(parseSyncedMaintenanceState({ phase: 'maintenance' })).toBeNull();
    expect(parseSyncedMaintenanceState({ phase: 42 })).toBeNull();
  });

  it('ramène un sursis sans échéance au gel', () => {
    // En cas de doute pendant une maintenance, on gèle plutôt que d'ignorer.
    const state = parseSyncedMaintenanceState({ ...grace, graceDeadlineMs: null });

    expect(state?.phase).toBe('frozen');
    expect(state?.graceDeadlineMs).toBeNull();
  });

  it('n’attribue pas d’échéance hors sursis', () => {
    const state = parseSyncedMaintenanceState({ ...grace, phase: 'frozen' });

    expect(state?.phase).toBe('frozen');
    expect(state?.graceDeadlineMs).toBeNull();
  });

  it('accepte l’état nominal', () => {
    expect(parseSyncedMaintenanceState(OPERATIONAL)).toEqual(OPERATIONAL);
  });
});

describe('isSameMaintenanceState', () => {
  const active: MaintenanceState = {
    phase: 'grace',
    delayMinutes: 5,
    message: 'Patience.',
    changedAtUtc: '2026-08-12T09:00:00Z',
    graceDeadlineMs: 1_786_000_000_000
  };

  it('ignore l’horodatage, qui ne porte pas d’information utile', () => {
    expect(isSameMaintenanceState(active, { ...active, changedAtUtc: 'autre' })).toBe(true);
  });

  it('distingue phase, échéance, délai et message', () => {
    expect(isSameMaintenanceState(active, OPERATIONAL)).toBe(false);
    expect(isSameMaintenanceState(active, { ...active, phase: 'frozen' })).toBe(false);
    expect(isSameMaintenanceState(active, { ...active, graceDeadlineMs: 1 })).toBe(false);
    expect(isSameMaintenanceState(active, { ...active, delayMinutes: 6 })).toBe(false);
    expect(isSameMaintenanceState(active, { ...active, message: 'Autre' })).toBe(false);
  });
});
