import { Order, ORDER_STATUSES, OrderStatus } from '../models/order';
import { OrderDto } from '../data-access/order.dto';

function parseStatus(raw: string): OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(raw)
    ? (raw as OrderStatus)
    : 'draft';
}

/** Conversion explicite DTO backend -> modèle de domaine front. */
export function mapOrderDtoToOrder(dto: OrderDto): Order {
  return {
    orderNumber: dto.order_number,
    customer: dto.customer_name,
    date: dto.order_date,
    status: parseStatus(dto.status),
    total: dto.total_excl_tax,
    notes: dto.notes ?? ''
  };
}

/** Garde de type : commande reçue du bus inter-fenêtres (non fiable). */
export function parseSyncedOrder(raw: unknown): Order | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value['orderNumber'] !== 'string' || value['orderNumber'].length === 0) {
    return null;
  }
  if (typeof value['customer'] !== 'string') {
    return null;
  }
  if (typeof value['date'] !== 'string') {
    return null;
  }
  if (
    typeof value['status'] !== 'string' ||
    !(ORDER_STATUSES as readonly string[]).includes(value['status'])
  ) {
    return null;
  }
  if (typeof value['total'] !== 'number' || !Number.isFinite(value['total'])) {
    return null;
  }
  return {
    orderNumber: value['orderNumber'],
    customer: value['customer'],
    date: value['date'],
    status: value['status'] as OrderStatus,
    total: value['total'],
    notes: typeof value['notes'] === 'string' ? value['notes'] : ''
  };
}

/** Valide un état complet reçu du bus ; null si un seul élément est invalide. */
export function parseSyncedOrders(raw: unknown): readonly Order[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const orders: Order[] = [];
  for (const item of raw) {
    const order = parseSyncedOrder(item);
    if (!order) {
      return null;
    }
    orders.push(order);
  }
  return orders;
}
