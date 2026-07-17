/**
 * DTO tels que renvoyés par la future API REST (conventions backend), et
 * jeu de données de démonstration « JSON en dur » en attendant l'API.
 */

export interface OrderDto {
  readonly order_number: string;
  readonly customer_name: string;
  /** Date ISO (yyyy-MM-dd). */
  readonly order_date: string;
  readonly status: string;
  readonly total_excl_tax: number;
  readonly notes?: string;
}

export const ORDERS_DATA: readonly OrderDto[] = [
  {
    order_number: 'CMD-2026-0101',
    customer_name: 'Dupont Matériaux',
    order_date: '2026-05-12',
    status: 'confirmed',
    total_excl_tax: 8420.0
  },
  {
    order_number: 'CMD-2026-0102',
    customer_name: 'ACME SA',
    order_date: '2026-05-15',
    status: 'invoiced',
    total_excl_tax: 12450.5,
    notes: 'Livraison en deux fois.'
  },
  {
    order_number: 'CMD-2026-0103',
    customer_name: 'Contoso France',
    order_date: '2026-05-20',
    status: 'shipped',
    total_excl_tax: 3980.0
  },
  {
    order_number: 'CMD-2026-0104',
    customer_name: 'Bâti-Sud',
    order_date: '2026-06-02',
    status: 'draft',
    total_excl_tax: 1275.25,
    notes: 'En attente de validation du devis.'
  },
  {
    order_number: 'CMD-2026-0105',
    customer_name: 'Groupe Nordec',
    order_date: '2026-06-05',
    status: 'confirmed',
    total_excl_tax: 22140.0
  },
  {
    order_number: 'CMD-2026-0106',
    customer_name: 'ACME SA',
    order_date: '2026-06-11',
    status: 'cancelled',
    total_excl_tax: 560.0,
    notes: 'Annulée à la demande du client.'
  },
  {
    order_number: 'CMD-2026-0107',
    customer_name: 'Ets Morel & Fils',
    order_date: '2026-06-18',
    status: 'shipped',
    total_excl_tax: 7811.9
  },
  {
    order_number: 'CMD-2026-0108',
    customer_name: 'Contoso France',
    order_date: '2026-07-01',
    status: 'draft',
    total_excl_tax: 15300.0
  }
];
