import {
  DEFAULT_MAINTENANCE_MESSAGE,
  MaintenanceNotice,
  MaintenancePhase,
  MaintenanceState
} from './maintenance-state';

const PHASES: readonly MaintenancePhase[] = ['operational', 'grace', 'frozen'];

/** Normalise un délai en minutes : entier positif, 0 si inexploitable. */
function readDelayMinutes(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : 0;
}

function readMessage(raw: unknown, active: boolean): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length > 0) {
    return trimmed;
  }
  return active ? DEFAULT_MAINTENANCE_MESSAGE : '';
}

/**
 * Garde de type des notifications du serveur : réponse de `/api/Maintenance` et
 * messages du hub SignalR.
 *
 * Stricte sur le champ porteur de sens (`isUnderMaintenance` doit être un
 * booléen, sinon le payload est rejeté), tolérante sur les champs d'affichage :
 * un message ou un délai malformé ne doit jamais empêcher le gel de
 * l'interface, seule la présentation est alors dégradée.
 */
export function parseMaintenanceNotification(raw: unknown): MaintenanceNotice | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const underMaintenance = value['isUnderMaintenance'];
  if (typeof underMaintenance !== 'boolean') {
    return null;
  }
  const rawTimestamp = value['timestampUtc'];

  return {
    underMaintenance,
    delayMinutes: readDelayMinutes(value['delayMinutes']),
    message: readMessage(value['message'], underMaintenance),
    changedAtUtc: typeof rawTimestamp === 'string' ? rawTimestamp : ''
  };
}

/**
 * Garde de type de l'état reçu du bus inter-fenêtres. Contrairement aux
 * notifications du serveur, ce payload porte la phase et l'échéance du sursis :
 * une fenêtre qui rattrape l'état ne redémarre pas un sursis de zéro.
 *
 * Un état `grace` sans échéance est incohérent : il est ramené à `frozen`
 * plutôt que rejeté — en cas de doute pendant une maintenance, on gèle.
 */
export function parseSyncedMaintenanceState(raw: unknown): MaintenanceState | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const rawPhase = value['phase'];
  if (
    typeof rawPhase !== 'string' ||
    !(PHASES as readonly string[]).includes(rawPhase)
  ) {
    return null;
  }
  const phase = rawPhase as MaintenancePhase;
  const rawDeadline = value['graceDeadlineMs'];
  const graceDeadlineMs =
    typeof rawDeadline === 'number' && Number.isFinite(rawDeadline)
      ? rawDeadline
      : null;
  const rawTimestamp = value['changedAtUtc'];

  const resolvedPhase: MaintenancePhase =
    phase === 'grace' && graceDeadlineMs === null ? 'frozen' : phase;

  return {
    phase: resolvedPhase,
    delayMinutes: readDelayMinutes(value['delayMinutes']),
    message: readMessage(value['message'], resolvedPhase !== 'operational'),
    changedAtUtc: typeof rawTimestamp === 'string' ? rawTimestamp : '',
    graceDeadlineMs: resolvedPhase === 'grace' ? graceDeadlineMs : null
  };
}

/** Deux états portent-ils la même information utile ? */
export function isSameMaintenanceState(
  a: MaintenanceState,
  b: MaintenanceState
): boolean {
  return (
    a.phase === b.phase &&
    a.graceDeadlineMs === b.graceDeadlineMs &&
    a.delayMinutes === b.delayMinutes &&
    a.message === b.message
  );
}
