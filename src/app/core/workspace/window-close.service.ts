import { Injectable, inject, signal } from '@angular/core';
import { ElectronService } from '../electron/electron.service';
import { WorkspaceStore } from './workspace-store';

/**
 * Garde de fermeture de la **fenêtre** (croix système et commande
 * Fichier › Quitter, comportement identique). Si un onglet porte des
 * modifications non enregistrées, une confirmation est demandée avant de
 * fermer ; sinon la fenêtre se ferme directement (fermer la dernière fenêtre
 * quitte l'application, cf. `window-all-closed` côté main).
 *
 * À distinguer de `WorkspaceCloseService`, qui garde la fermeture d'un
 * **onglet** ; ici on garde la fermeture de la fenêtre entière. Le dialogue
 * est rendu par le `Shell` ; ce service ne porte que l'état d'attente.
 */
@Injectable({ providedIn: 'root' })
export class WindowCloseService {
  private readonly store = inject(WorkspaceStore);
  private readonly electron = inject(ElectronService);
  private readonly pendingSignal = signal(false);

  /** Vrai quand la confirmation de fermeture est affichée. */
  readonly pending = this.pendingSignal.asReadonly();

  /** Ferme la fenêtre ; si des modifications sont en attente, confirme d'abord. */
  requestExit(): void {
    if (this.store.hasUnsavedChanges()) {
      this.pendingSignal.set(true);
    } else {
      void this.electron.closeWindow();
    }
  }

  confirmExit(): void {
    this.pendingSignal.set(false);
    void this.electron.closeWindow();
  }

  cancelExit(): void {
    this.pendingSignal.set(false);
  }
}
