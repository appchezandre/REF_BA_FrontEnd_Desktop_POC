import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, OrderStatus } from '../models/order';
import { OrdersScreenRegistry } from '../store/orders-screen.registry';
import { StatusFilter } from '../store/orders-screen.store';

/**
 * Panneau de recherche contextuel de la fenêtre Commandes, rendu dans la
 * side bar quand l'onglet actif est une liste de commandes. Il pilote les
 * critères de l'instance d'écran correspondante (résolue par son id
 * d'onglet), si bien que deux listes ouvertes (Ctrl+clic) ont chacune leur
 * propre recherche.
 */
@Component({
  selector: 'app-orders-search',
  templateUrl: './orders-search.html',
  styleUrl: './orders-search.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrdersSearch {
  private readonly registry = inject(OrdersScreenRegistry);

  /** Id de l'onglet du workspace hébergeant la liste ciblée. */
  readonly tabId = input.required<string>();

  protected readonly screen = computed(() => this.registry.forTab(this.tabId()));

  protected readonly statuses = ORDER_STATUSES;
  protected readonly statusLabels = ORDER_STATUS_LABELS;

  protected onText(event: Event): void {
    this.screen().setSearchText((event.target as HTMLInputElement).value);
  }

  protected onNumber(event: Event): void {
    this.screen().setSearchNumber((event.target as HTMLInputElement).value);
  }

  protected onStatus(event: Event): void {
    this.screen().setSearchStatus((event.target as HTMLSelectElement).value as StatusFilter);
  }

  protected onDateFrom(event: Event): void {
    this.screen().setDateFrom((event.target as HTMLInputElement).value);
  }

  protected onDateTo(event: Event): void {
    this.screen().setDateTo((event.target as HTMLInputElement).value);
  }

  protected onAmountMin(event: Event): void {
    this.screen().setAmountMin(this.parseAmount((event.target as HTMLInputElement).value));
  }

  protected onAmountMax(event: Event): void {
    this.screen().setAmountMax(this.parseAmount((event.target as HTMLInputElement).value));
  }

  /** '' -> aucune borne ; sinon nombre fini, ou null si invalide. */
  private parseAmount(raw: string): number | null {
    if (raw.trim() === '') {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  protected clear(): void {
    this.screen().clearSearch();
  }
}
