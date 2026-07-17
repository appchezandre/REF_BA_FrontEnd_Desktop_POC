import { Injectable, inject } from '@angular/core';
import { ElectronService } from '../electron/electron.service';
import { TabStateRegistry } from './tab-state-registry';
import { WorkspaceStore } from './workspace-store';

/**
 * Détachement transactionnel d'un onglet vers une nouvelle fenêtre native :
 * l'onglet n'est retiré de la fenêtre source qu'après confirmation IPC du
 * main process. En cas d'échec, il reste intact.
 *
 * L'état d'écran de l'onglet (onglets internes, brouillons, filtres…) est
 * capturé via `TabStateRegistry` et embarqué dans `tab.state`, pour être
 * reconstruit à l'identique dans la fenêtre destination.
 */
@Injectable({ providedIn: 'root' })
export class TabDetachService {
  private readonly electron = inject(ElectronService);
  private readonly store = inject(WorkspaceStore);
  private readonly tabState = inject(TabStateRegistry);

  get available(): boolean {
    return this.electron.isElectron;
  }

  async detach(tabId: string): Promise<void> {
    const tab = this.store.findTab(tabId);
    if (!tab || !this.electron.isElectron || this.store.isDetachPending(tabId)) {
      return;
    }
    this.store.markDetachPending(tabId);
    try {
      const state = this.tabState.capture(tab) ?? tab.state;
      const result = await this.electron.detachTab({
        tab: { ...tab, detached: true, state }
      });
      if (result.ok) {
        this.store.forceRemoveTab(tabId);
      }
    } finally {
      this.store.unmarkDetachPending(tabId);
    }
  }
}
