import { Injectable, effect, inject, untracked } from '@angular/core';
import { TabStateRegistry } from '../../../core/workspace/tab-state-registry';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { RecentRecordsService } from '../../../core/shell/recent-records.service';
import { WorkspaceTab } from '../../../shared/models/workspace';
import { OrdersService } from '../data-access/orders.service';
import { OrdersScreenStore } from './orders-screen.store';

/**
 * Registre des instances de la fenêtre Commandes : une `OrdersScreenStore`
 * par onglet du workspace (Ctrl+clic dans l'explorateur ouvre une seconde
 * instance indépendante). L'état survit aux changements d'onglet (seul
 * l'onglet actif est monté) et est libéré quand l'onglet du workspace
 * disparaît de la fenêtre (fermeture ou détachement).
 *
 * S'enregistre comme fournisseur d'état d'écran (`TabStateRegistry`) : au
 * détachement, l'état est capturé et embarqué dans l'onglet ; à l'arrivée
 * dans la nouvelle fenêtre, l'instance est hydratée depuis `tab.state`.
 */
@Injectable({ providedIn: 'root' })
export class OrdersScreenRegistry {
  private readonly ordersService = inject(OrdersService);
  private readonly workspace = inject(WorkspaceStore);
  private readonly tabState = inject(TabStateRegistry);
  private readonly recentRecords = inject(RecentRecordsService);
  private readonly stores = new Map<string, OrdersScreenStore>();

  constructor() {
    this.tabState.register('order-list', { capture: (id) => this.capture(id) });
    // Réouverture d'une fiche commande depuis « Fiches récentes » : on la rouvre
    // directement dans le conteneur Commandes (sans passer par la liste).
    this.recentRecords.registerOpener('order-list', (orderNumber) =>
      this.openRecord(orderNumber)
    );

    effect(() => {
      const alive = new Set(
        this.workspace.groups().flatMap((group) => group.tabs.map((tab) => tab.id))
      );
      for (const tabId of [...this.stores.keys()]) {
        if (!alive.has(tabId)) {
          this.stores.delete(tabId);
        }
      }
    });
  }

  forTab(tabId: string): OrdersScreenStore {
    let store = this.stores.get(tabId);
    if (!store) {
      // Création paresseuse + hydratation dans un contexte `untracked` :
      // `forTab` est lu depuis un `computed` (OrdersPage.screen) et
      // l'hydratation écrit des signals — interdit dans un computed (NG0600).
      // `untracked` isole cette initialisation mémoïsée du contexte réactif
      // appelant (les lectures ne créent pas de dépendance, les écritures sont
      // autorisées).
      store = untracked(() => {
        const created = new OrdersScreenStore(this.ordersService);
        // Fenêtre détachée : reconstruire l'état d'écran transporté par l'onglet.
        const state = this.workspace.findTab(tabId)?.state;
        if (state) {
          created.hydrate(state);
        }
        return created;
      });
      this.stores.set(tabId, store);
    }
    return store;
  }

  /**
   * Ouvre (ou réactive) le conteneur Commandes puis y ouvre directement la
   * fiche demandée — l'utilisateur atterrit sur le détail, pas sur la liste.
   * Réutilise un conteneur existant, en crée un sinon.
   */
  private openRecord(orderNumber: string): void {
    let tab = this.findOrderListTab();
    if (tab) {
      this.workspace.activateTab(tab.id);
    } else {
      this.workspace.openTab({ type: 'order-list', title: 'Commandes' });
      tab = this.findOrderListTab();
    }
    if (tab) {
      this.forTab(tab.id).openDetail(orderNumber);
    }
  }

  /** Premier onglet Commandes de la fenêtre, s'il existe. */
  private findOrderListTab(): WorkspaceTab | null {
    for (const group of this.workspace.groups()) {
      const tab = group.tabs.find((t) => t.type === 'order-list');
      if (tab) {
        return tab;
      }
    }
    return null;
  }

  private capture(tabId: string): Record<string, unknown> | null {
    return this.stores.get(tabId)?.snapshot() ?? null;
  }
}
