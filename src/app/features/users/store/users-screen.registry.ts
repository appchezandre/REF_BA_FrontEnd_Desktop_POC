import { Injectable, effect, inject, untracked } from '@angular/core';
import { TabStateRegistry } from '../../../core/workspace/tab-state-registry';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { RecentRecordsService } from '../../../core/shell/recent-records.service';
import { WorkspaceTab } from '../../../shared/models/workspace';
import { UsersService } from '../data-access/users.service';
import { UsersScreenStore } from './users-screen.store';

/**
 * Registre des instances de la fenêtre Utilisateurs : une `UsersScreenStore`
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
export class UsersScreenRegistry {
  private readonly usersService = inject(UsersService);
  private readonly workspace = inject(WorkspaceStore);
  private readonly tabState = inject(TabStateRegistry);
  private readonly recentRecords = inject(RecentRecordsService);
  private readonly stores = new Map<string, UsersScreenStore>();

  constructor() {
    this.tabState.register('user-list', { capture: (id) => this.capture(id) });
    // Réouverture d'une fiche utilisateur depuis « Fiches récentes » : on la
    // rouvre directement dans le conteneur Utilisateurs (sans passer par la liste).
    this.recentRecords.registerOpener('user-list', (key) => this.openUser(key));

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

  forTab(tabId: string): UsersScreenStore {
    let store = this.stores.get(tabId);
    if (!store) {
      // Création paresseuse + hydratation dans un contexte `untracked` :
      // `forTab` est lu depuis un `computed` (UsersPage.screen) et
      // l'hydratation écrit des signals — interdit dans un computed (NG0600).
      // `untracked` isole cette initialisation mémoïsée du contexte réactif
      // appelant (les lectures ne créent pas de dépendance, les écritures sont
      // autorisées).
      store = untracked(() => {
        const created = new UsersScreenStore(this.usersService);
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
   * Ouvre (ou réactive) le conteneur Utilisateurs puis y ouvre directement la
   * fiche demandée — l'utilisateur atterrit sur le détail, pas sur la liste.
   * Réutilise un conteneur existant, en crée un sinon.
   *
   * Point d'entrée des ouvertures « par clé » venant d'ailleurs que la liste :
   * fiches récentes et bouton Compte de la barre d'activité. La clé est
   * acceptée même si la liste n'est pas encore chargée (la fiche s'affiche à
   * l'arrivée des données, cf. `UsersScreenStore.openDetail`).
   */
  openUser(key: string): void {
    let tab = this.findUserListTab();
    if (tab) {
      this.workspace.activateTab(tab.id);
    } else {
      this.workspace.openTab({ type: 'user-list', title: 'Utilisateurs' });
      tab = this.findUserListTab();
    }
    if (tab) {
      this.forTab(tab.id).openDetail(key);
    }
  }

  /** Premier onglet Utilisateurs de la fenêtre, s'il existe. */
  private findUserListTab(): WorkspaceTab | null {
    for (const group of this.workspace.groups()) {
      const tab = group.tabs.find((t) => t.type === 'user-list');
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
