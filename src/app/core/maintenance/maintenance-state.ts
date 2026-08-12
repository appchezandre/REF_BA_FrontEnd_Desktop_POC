/**
 * Phase de maintenance vue par le renderer.
 *
 * - `operational` : rien à signaler ;
 * - `grace` : maintenance annoncée, **sursis** en cours. L'interface reste
 *   pleinement utilisable pour que l'utilisateur enregistre son travail, un
 *   bandeau affiche le décompte ;
 * - `frozen` : sursis écoulé. Interface figée par le voile, session fermée.
 */
export type MaintenancePhase = 'operational' | 'grace' | 'frozen';

/** Durée du sursis accordé avant le gel effectif. */
export const GRACE_PERIOD_MS = 120_000;

/** Ce que le serveur annonce, avant interprétation par le renderer. */
export interface MaintenanceNotice {
  readonly underMaintenance: boolean;
  /** Durée estimée annoncée par le serveur, en minutes (0 si inconnue). */
  readonly delayMinutes: number;
  /** Message destiné à l'utilisateur, fourni par le serveur (français). */
  readonly message: string;
  /** Horodatage UTC du changement d'état côté serveur (chaîne ISO, '' si absent). */
  readonly changedAtUtc: string;
}

/**
 * État de maintenance complet du renderer.
 *
 * Les dates restent des chaînes ISO (même convention que `AuthSession`) et
 * `graceDeadlineMs` un nombre : l'objet est ainsi directement sérialisable et
 * transite tel quel par le bus inter-fenêtres. L'échéance du sursis est
 * **partagée** plutôt que recalculée par chaque fenêtre, sans quoi les fenêtres
 * gèleraient à des instants différents.
 */
export interface MaintenanceState {
  /** Seule source de vérité : `operational` ⇔ aucune maintenance annoncée. */
  readonly phase: MaintenancePhase;
  readonly delayMinutes: number;
  readonly message: string;
  readonly changedAtUtc: string;
  /** Échéance du sursis (epoch ms) ; null hors phase `grace`. */
  readonly graceDeadlineMs: number | null;
}

/** Message de repli si le serveur n'en fournit pas d'exploitable. */
export const DEFAULT_MAINTENANCE_MESSAGE =
  'Application en maintenance. Merci de patienter.';

/** État nominal : aucune maintenance en cours. */
export const OPERATIONAL: MaintenanceState = {
  phase: 'operational',
  delayMinutes: 0,
  message: '',
  changedAtUtc: '',
  graceDeadlineMs: null
};
