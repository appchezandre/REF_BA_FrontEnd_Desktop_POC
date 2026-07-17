/**
 * Description des colonnes de la table Commandes : identité, libellé et
 * options de présentation. L'ordre et la visibilité effectifs sont pilotés
 * par l'instance d'écran (OrdersScreenStore), pas ici.
 */

/** Identifiant stable d'une colonne de données déplaçable / masquable. */
export type OrderColumnId = 'orderNumber' | 'date' | 'customer' | 'status' | 'total';

export interface OrderColumnDef {
  readonly id: OrderColumnId;
  readonly label: string;
  /** Alignement à droite + chiffres tabulaires (colonnes numériques). */
  readonly numeric?: boolean;
  /** Police à chasse fixe (identifiants). */
  readonly mono?: boolean;
  /** Largeur par défaut en pixels (point de départ ; l'utilisateur peut
   *  redimensionner, l'override vivant dans l'instance d'écran). */
  readonly width: number;
}

/** Définition de chaque colonne (les colonnes structurelles état/actions
 *  restent en dehors de ce registre : ni déplaçables ni masquables). */
export const ORDER_COLUMN_DEFS: Record<OrderColumnId, OrderColumnDef> = {
  orderNumber: { id: 'orderNumber', label: 'N° commande', mono: true, width: 150 },
  date: { id: 'date', label: 'Date', width: 110 },
  customer: { id: 'customer', label: 'Client', width: 220 },
  status: { id: 'status', label: 'Statut', width: 130 },
  total: { id: 'total', label: 'Total HT', numeric: true, width: 130 }
};

/** Ordre d'affichage par défaut des colonnes. */
export const DEFAULT_ORDER_COLUMNS: readonly OrderColumnId[] = [
  'orderNumber',
  'date',
  'customer',
  'status',
  'total'
];

export function isOrderColumnId(value: unknown): value is OrderColumnId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ORDER_COLUMN_DEFS, value);
}
