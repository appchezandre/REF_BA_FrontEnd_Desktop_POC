import { Injectable, computed, inject, signal } from '@angular/core';
import { WorkspaceStore } from './workspace-store';
import { WorkspaceTab } from '../../shared/models/workspace';

/**
 * Garde de fermeture des onglets du workspace : intercepte l'intention de
 * fermeture (× de l'onglet, Ctrl+W, Suppr) et, si l'onglet porte des
 * modifications non enregistrées (`dirty`), demande confirmation avant de
 * fermer. Le dialogue est rendu par le `Shell` ; ce service ne fait que
 * porter l'état d'attente et déléguer au `WorkspaceStore`.
 *
 * Les fermetures programmatiques (détachement, transfert) passent par le
 * store directement et ne sont donc pas gardées — ce sont des déplacements,
 * pas des abandons.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceCloseService {
  private readonly store = inject(WorkspaceStore);
  private readonly pendingIdSignal = signal<string | null>(null);

  /** Onglet dont la fermeture attend confirmation (null sinon). */
  readonly pendingTab = computed<WorkspaceTab | null>(() => {
    const id = this.pendingIdSignal();
    return id ? this.store.findTab(id) : null;
  });

  /** Ferme un onglet ; si modifié, ouvre d'abord la confirmation. */
  requestClose(tabId: string): void {
    const tab = this.store.findTab(tabId);
    if (!tab || !tab.closable) {
      return;
    }
    if (tab.dirty) {
      this.pendingIdSignal.set(tabId);
    } else {
      this.store.closeTab(tabId);
    }
  }

  confirmClose(): void {
    const id = this.pendingIdSignal();
    if (id) {
      this.store.closeTab(id);
    }
    this.pendingIdSignal.set(null);
  }

  cancelClose(): void {
    this.pendingIdSignal.set(null);
  }
}
