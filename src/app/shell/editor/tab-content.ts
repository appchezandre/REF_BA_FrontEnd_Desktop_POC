import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { CDK_DROP_LIST_GROUP } from '@angular/cdk/drag-drop';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  // CdkDropList hérite du CDK_DROP_LIST_GROUP par injecteur d'élément
  // (inject optional + skipSelf) : sans cette coupure, tout `cdkDropList`
  // d'un écran métier (ex. réordonnancement de colonnes) rejoindrait le
  // `cdkDropListGroup` de l'éditeur et capturerait le drag des onglets.
  // `useValue: null` est sûr avec CDK 21.x (tous les accès à `_group` sont
  // gardés) — à revérifier lors d'une montée de version du CDK.
  providers: [{ provide: CDK_DROP_LIST_GROUP, useValue: null }]
})
export class TabContent {
  private readonly store = inject(WorkspaceStore);

  readonly tab = input.required<WorkspaceTab>();

  protected toggleDirty(): void {
    const tab = this.tab();
    this.store.setDirty(tab.id, !tab.dirty);
  }
}
