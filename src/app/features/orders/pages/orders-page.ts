import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal
} from '@angular/core';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { RecentRecordsService } from '../../../core/shell/recent-records.service';
import { WorkspaceTab } from '../../../shared/models/workspace';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { OrderDetail } from '../components/order-detail';
import { OrderList } from '../components/order-list';
import { OrdersScreenRegistry } from '../store/orders-screen.registry';
import { LIST_VIEW } from '../store/orders-screen.store';

/**
 * Fenêtre Commandes : écran de type « liste d'entités » avec un onglet
 * interne Liste systématique (non fermable) et un onglet Détail par
 * commande ouverte (clé naturelle = n° de commande). Chaque onglet du
 * workspace (Ctrl+clic = seconde instance) possède son propre état,
 * résolu via le registre. Modèle à répliquer pour les autres entités en
 * liste ; une entité simple s'affichera au contraire directement en fiche.
 */
@Component({
  selector: 'app-orders-page',
  imports: [OrderList, OrderDetail, ConfirmDialog],
  templateUrl: './orders-page.html',
  styleUrl: './orders-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrdersPage {
  private readonly registry = inject(OrdersScreenRegistry);
  private readonly workspace = inject(WorkspaceStore);
  private readonly recentRecords = inject(RecentRecordsService);

  /** Onglet du workspace qui héberge cette instance de l'écran. */
  readonly tab = input.required<WorkspaceTab>();

  /** État propre à cette instance (persiste entre les changements d'onglet). */
  protected readonly screen = computed(() => this.registry.forTab(this.tab().id));

  /** N° de la fiche modifiée dont la fermeture attend confirmation. */
  protected readonly pendingClose = signal<string | null>(null);

  // N° des détails déjà consignés dans « Fiches récentes » (évite les doublons ;
  // resynchronisé sur les détails ouverts pour qu'une réouverture reconsigne).
  private recordedDetails = new Set<string>();

  protected readonly LIST_VIEW = LIST_VIEW;

  constructor() {
    // Reflète les modifications non enregistrées sur l'onglet du workspace.
    effect(() => {
      this.workspace.setDirty(this.tab().id, this.screen().hasDirty());
    });

    // Consigne toute fiche nouvellement ouverte dans « Fiches récentes »
    // (la simple ouverture suffit, sans modification).
    effect(() => {
      const open = this.screen().detailNumbers();
      for (const orderNumber of open) {
        if (!this.recordedDetails.has(orderNumber)) {
          this.recentRecords.add({
            key: `order-list::${orderNumber}`,
            title: `Commande ${orderNumber}`,
            icon: 'orders',
            containerType: 'order-list',
            recordId: orderNumber
          });
        }
      }
      // Ne garder que les détails encore ouverts : rouvrir un détail fermé le
      // reconsigne (et le remonte en tête).
      this.recordedDetails = new Set(open);
    });
  }

  protected closeDetail(event: Event, orderNumber: string): void {
    event.stopPropagation();
    // Fiche modifiée : demander confirmation avant de perdre les changements.
    if (this.screen().dirtyNumbers().has(orderNumber)) {
      this.pendingClose.set(orderNumber);
    } else {
      this.screen().closeDetail(orderNumber);
    }
  }

  protected confirmClose(): void {
    const orderNumber = this.pendingClose();
    if (orderNumber) {
      this.screen().closeDetail(orderNumber);
    }
    this.pendingClose.set(null);
  }

  protected cancelClose(): void {
    this.pendingClose.set(null);
  }
}
