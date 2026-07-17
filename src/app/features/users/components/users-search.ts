import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { USER_STATUSES, USER_STATUS_LABELS } from '../models/user';
import { UsersScreenRegistry } from '../store/users-screen.registry';
import { StatusFilter } from '../store/users-screen.store';

/**
 * Panneau de recherche contextuel de la fenêtre Utilisateurs, rendu dans la
 * side bar quand l'onglet actif est une liste d'utilisateurs. Il pilote les
 * critères de l'instance d'écran correspondante (résolue par son id
 * d'onglet), si bien que deux listes ouvertes (Ctrl+clic) ont chacune leur
 * propre recherche.
 */
@Component({
  selector: 'app-users-search',
  templateUrl: './users-search.html',
  styleUrl: './users-search.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UsersSearch {
  private readonly registry = inject(UsersScreenRegistry);

  /** Id de l'onglet du workspace hébergeant la liste ciblée. */
  readonly tabId = input.required<string>();

  protected readonly screen = computed(() => this.registry.forTab(this.tabId()));

  protected readonly statuses = USER_STATUSES;
  protected readonly statusLabels = USER_STATUS_LABELS;

  protected onText(event: Event): void {
    this.screen().setSearchText((event.target as HTMLInputElement).value);
  }

  protected onEmail(event: Event): void {
    this.screen().setSearchEmail((event.target as HTMLInputElement).value);
  }

  protected onStatus(event: Event): void {
    this.screen().setSearchStatus((event.target as HTMLSelectElement).value as StatusFilter);
  }

  protected onCreatedFrom(event: Event): void {
    this.screen().setCreatedFrom((event.target as HTMLInputElement).value);
  }

  protected onCreatedTo(event: Event): void {
    this.screen().setCreatedTo((event.target as HTMLInputElement).value);
  }

  protected clear(): void {
    this.screen().clearSearch();
  }
}
