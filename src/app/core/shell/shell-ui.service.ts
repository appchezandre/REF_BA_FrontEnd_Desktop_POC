import { Injectable, signal } from '@angular/core';

/** Panneau latéral actif : explorateur des écrans ou recherche contextuelle. */
export type ActivityView = 'explorer' | 'search';

/**
 * État d'interface transverse du shell (visibilité et vue de la side bar).
 * Centralisé dans un service singleton pour qu'un composant profond (p. ex.
 * le bouton « Rechercher » de la table Commandes) puisse demander l'ouverture
 * de la recherche sans dépendance directe au composant Shell.
 */
@Injectable({ providedIn: 'root' })
export class ShellUiService {
  private readonly activityViewSignal = signal<ActivityView>('explorer');
  private readonly sidebarVisibleSignal = signal(true);
  private readonly userSwitchDialogVisibleSignal = signal(false);

  readonly activityView = this.activityViewSignal.asReadonly();
  readonly sidebarVisible = this.sidebarVisibleSignal.asReadonly();
  /** Dialog « Changer d'utilisateur » (rendu par `Shell`, ouvert depuis la status-bar). */
  readonly userSwitchDialogVisible = this.userSwitchDialogVisibleSignal.asReadonly();

  /**
   * Sélection d'une vue depuis la barre d'activité : re-cliquer sur la vue
   * active bascule la visibilité (comportement VSCode).
   */
  selectActivity(view: ActivityView): void {
    if (this.activityViewSignal() === view) {
      this.sidebarVisibleSignal.update((visible) => !visible);
    } else {
      this.activityViewSignal.set(view);
      this.sidebarVisibleSignal.set(true);
    }
  }

  toggleSidebar(): void {
    this.sidebarVisibleSignal.update((visible) => !visible);
  }

  /** Ouvre la side bar sur la vue recherche (contextuelle à l'onglet actif). */
  revealSearch(): void {
    this.activityViewSignal.set('search');
    this.sidebarVisibleSignal.set(true);
  }

  openUserSwitchDialog(): void {
    this.userSwitchDialogVisibleSignal.set(true);
  }

  closeUserSwitchDialog(): void {
    this.userSwitchDialogVisibleSignal.set(false);
  }
}
