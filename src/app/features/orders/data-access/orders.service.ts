import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { WindowSyncService } from '../../../core/electron/window-sync.service';
import { Order, OrderDraft } from '../models/order';
import { mapOrderDtoToOrder, parseSyncedOrders } from '../mappers/order.mapper';
import { ORDERS_DATA } from './order.dto';

/** Sujet du bus inter-fenêtres portant l'état complet des commandes. */
const ORDERS_SYNC_TOPIC = 'orders/state';

/**
 * Accès aux données Commandes. Lit pour l'instant un JSON en dur
 * (`ORDERS_DATA`) ; sera remplacé par les appels à l'API REST métier en
 * conservant la même surface (DTO -> mapper -> modèle de domaine).
 *
 * Synchronisation inter-fenêtres : chaque modification publie l'état complet
 * sur le bus ; les autres fenêtres (et celles ouvertes après coup, via l'état
 * retenu par Electron Main) l'appliquent après validation. Stratégie
 * dernier-écrit-gagnant, suffisante en attendant l'autorité du backend.
 */
@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly sync = inject(WindowSyncService);

  private readonly ordersSignal = signal<readonly Order[]>(
    ORDERS_DATA.map(mapOrderDtoToOrder)
  );

  readonly orders = this.ordersSignal.asReadonly();

  constructor() {
    // Rattrapage : état publié par une autre fenêtre avant l'ouverture de
    // celle-ci (cas typique : fenêtre détachée après des modifications).
    void this.sync
      .getState(ORDERS_SYNC_TOPIC)
      .then((data) => this.applySyncedState(data));

    const unsubscribe = this.sync.onTopic(ORDERS_SYNC_TOPIC, (data) =>
      this.applySyncedState(data)
    );
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  getOrder(orderNumber: string): Order | undefined {
    return this.ordersSignal().find((o) => o.orderNumber === orderNumber);
  }

  updateOrder(orderNumber: string, changes: OrderDraft): void {
    this.ordersSignal.update((orders) =>
      orders.map((o) => (o.orderNumber === orderNumber ? { ...o, ...changes } : o))
    );
    this.sync.publish(ORDERS_SYNC_TOPIC, this.ordersSignal());
  }

  /** Applique un état reçu du bus après validation (donnée non fiable). */
  private applySyncedState(data: unknown): void {
    if (data === null) {
      return;
    }
    const orders = parseSyncedOrders(data);
    if (orders) {
      this.ordersSignal.set(orders);
    }
  }
}
