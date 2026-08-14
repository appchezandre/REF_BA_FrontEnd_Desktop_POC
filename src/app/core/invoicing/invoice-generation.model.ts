/**
 * Statut d'un job de génération côté renderer. `pending` est un état purement
 * local : le POST a été accepté mais aucun événement hub n'a encore été reçu
 * (l'événement `Started` peut être manqué — le job démarre dès la réponse
 * HTTP, avant que l'abonnement au groupe SignalR soit effectif).
 */
export type InvoiceGenerationStatus =
  | 'pending'
  | 'started'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Job de génération des factures suivi par la fenêtre courante. */
export interface InvoiceGenerationJob {
  readonly jobId: string;
  readonly year: number;
  /** 1..12. */
  readonly month: number;
  readonly status: InvoiceGenerationStatus;
  readonly processed: number;
  readonly total: number;
  /** Dernier message serveur reçu (événement hub), null sinon. */
  readonly message: string | null;
  /** Horodatage du dernier événement hub, null tant qu'aucun n'est reçu. */
  readonly lastUpdateUtc: string | null;
  /** Lancement répondu 409 : suivi repris d'un run déjà en cours. */
  readonly resumed: boolean;
  /** Annulation demandée (202 reçu), en attente de l'événement Cancelled. */
  readonly cancelRequested: boolean;
}

/** Le job attend ou produit encore des événements de progression. */
export function isActiveStatus(status: InvoiceGenerationStatus): boolean {
  return status === 'pending' || status === 'started' || status === 'running';
}
