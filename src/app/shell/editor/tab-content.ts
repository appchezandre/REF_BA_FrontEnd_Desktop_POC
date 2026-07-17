import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { WorkspaceTab } from '../../shared/models/workspace';
import { OrdersPage } from '../../features/orders/pages/orders-page';
import { SettingsPage } from '../../features/settings/pages/settings-page';
import { UsersPage } from '../../features/users/pages/users-page';
import { WelcomeView } from './welcome-view';

/**
 * Résout le type logique d'un onglet vers son contenu. Les écrans métier
 * vivent dans src/app/features/ (chargés en différé pour le code-splitting) ;
 * les types non encore implémentés affichent un placeholder qui démontre le
 * cycle de vie (dirty, dédoublonnage, détachement).
 */
@Component({
  selector: 'app-tab-content',
  imports: [WelcomeView, OrdersPage, SettingsPage, UsersPage],
  templateUrl: './tab-content.html',
  styleUrl: './tab-content.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TabContent {
  private readonly store = inject(WorkspaceStore);

  readonly tab = input.required<WorkspaceTab>();

  protected toggleDirty(): void {
    const tab = this.tab();
    this.store.setDirty(tab.id, !tab.dirty);
  }
}
