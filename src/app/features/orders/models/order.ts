/** Modèle de domaine front de la feature Commandes. */

export type OrderStatus = 'draft' | 'confirmed' | 'shipped' | 'invoiced' | 'cancelled';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'draft',
  'confirmed',
  'shipped',
  'invoiced',
  'cancelled'
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Brouillon',
  confirmed: 'Confirmée',
  shipped: 'Expédiée',
  invoiced: 'Facturée',
  cancelled: 'Annulée'
};

export interface Order {
  /** Clé naturelle de l'entité. */
  readonly orderNumber: string;
  readonly customer: string;
  /** Date ISO (yyyy-MM-dd). */
  readonly date: string;
  readonly status: OrderStatus;
  /** Total HT en euros. */
  readonly total: number;
  readonly notes: string;
}

/** Champs modifiables d'une commande (brouillon d'édition d'une fiche). */
export interface OrderDraft {
  readonly customer: string;
  readonly date: string;
  readonly status: OrderStatus;
  readonly notes: string;
}

export function draftFromOrder(order: Order): OrderDraft {
  return {
    customer: order.customer,
    date: order.date,
    status: order.status,
    notes: order.notes
  };
}

export function isDraftEqual(order: Order, draft: OrderDraft): boolean {
  return (
    order.customer === draft.customer &&
    order.date === draft.date &&
    order.status === draft.status &&
    order.notes === draft.notes
  );
}
