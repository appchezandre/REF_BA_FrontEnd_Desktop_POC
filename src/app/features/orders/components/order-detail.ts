import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { OrdersService } from '../data-access/orders.service';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  OrderDraft,
  OrderStatus
} from '../models/order';
import { OrdersScreenStore } from '../store/orders-screen.store';

/**
 * Onglet Détail de la fenêtre Commandes : fiche d'une commande, identifiée
 * par sa clé naturelle (n° de commande). Lecture seule par défaut (bouton
 * « Modifier ») ; en édition, les champs sont modifiables et le brouillon
 * vit dans l'`OrdersScreenStore` de l'instance hôte pour survivre aux
 * changements d'onglet.
 */
@Component({
  selector: 'app-order-detail',
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrderDetail {
  private readonly ordersService = inject(OrdersService);

  /** État de l'instance d'écran hôte (fourni par la page). */
  readonly screen = input.required<OrdersScreenStore>();
  readonly orderNumber = input.required<string>();

  protected readonly statuses = ORDER_STATUSES;
  protected readonly statusLabels = ORDER_STATUS_LABELS;

  protected readonly order = computed(() =>
    this.ordersService.getOrder(this.orderNumber())
  );

  protected readonly draft = computed(() =>
    this.screen().drafts().get(this.orderNumber())
  );

  protected readonly editing = computed(() =>
    this.screen().editing().has(this.orderNumber())
  );

  protected readonly dirty = computed(() =>
    this.screen().dirtyNumbers().has(this.orderNumber())
  );

  protected beginEdit(): void {
    this.screen().beginEdit(this.orderNumber());
  }

  protected updateField(field: keyof OrderDraft, event: Event): void {
    const value = (
      event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    ).value;
    if (field === 'status') {
      this.screen().updateDraft(this.orderNumber(), { status: value as OrderStatus });
    } else {
      this.screen().updateDraft(this.orderNumber(), { [field]: value });
    }
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.screen().saveDraft(this.orderNumber());
  }

  protected cancel(): void {
    this.screen().cancelEdit(this.orderNumber());
  }
}
