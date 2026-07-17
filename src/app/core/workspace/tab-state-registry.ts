import { Injectable } from '@angular/core';
import { TabType, WorkspaceTab } from '../../shared/models/workspace';

/**
 * Fournit un instantané sérialisable de l'état d'écran d'un onglet (onglets
 * internes, brouillons, filtres…) pour le transporter lors d'un détachement.
 */
export interface TabStateProvider {
  capture(tabId: string): Record<string, unknown> | null;
}

/**
 * Registre des fournisseurs d'état d'écran, par type d'onglet. Permet au
 * détachement (générique, dans `core`) de récupérer l'état d'une feature
 * sans en connaître les détails : chaque feature enregistre son fournisseur.
 * L'état est ensuite embarqué dans `WorkspaceTab.state` (champ sérialisable
 * du modèle) et revalidé/hydraté côté fenêtre destination.
 */
@Injectable({ providedIn: 'root' })
export class TabStateRegistry {
  private readonly providers = new Map<TabType, TabStateProvider>();

  register(type: TabType, provider: TabStateProvider): void {
    this.providers.set(type, provider);
  }

  /** Instantané de l'état d'écran d'un onglet, ou undefined si aucun fournisseur. */
  capture(tab: WorkspaceTab): Record<string, unknown> | undefined {
    return this.providers.get(tab.type)?.capture(tab.id) ?? undefined;
  }
}
