import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { OpenTabRequest } from '../../shared/models/workspace';

interface Shortcut {
  readonly keys: string;
  readonly label: string;
}

/** Page d'accueil style « Welcome » de VSCode. */
@Component({
  selector: 'app-welcome-view',
  templateUrl: './welcome-view.html',
  styleUrl: './welcome-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WelcomeView {
  private readonly store = inject(WorkspaceStore);

  protected readonly starters: readonly OpenTabRequest[] = [
    { type: 'dashboard', title: 'Tableau de bord' },
    { type: 'customer-list', title: 'Liste des clients' },
    { type: 'order-list', title: 'Liste des commandes' }
  ];

  protected readonly shortcuts: readonly Shortcut[] = [
    { keys: 'Ctrl+W', label: "Fermer l'onglet actif" },
    { keys: 'Ctrl+Tab', label: 'Onglet suivant' },
    { keys: 'Ctrl+Shift+Tab', label: 'Onglet précédent' },
    { keys: 'Glisser un onglet', label: "Diviser l'éditeur (guides de dock)" },
    { keys: 'Ctrl+B', label: 'Afficher / masquer le panneau latéral' },
    { keys: 'Ctrl+ù', label: 'Afficher / masquer le panneau inférieur' },
    { keys: 'Ctrl+Alt+D', label: 'Détacher l’onglet dans une fenêtre' },
    { keys: 'Ctrl+Shift+←/→', label: "Déplacer l'onglet (clavier)" },
    { keys: 'Ctrl+Alt+→', label: 'Envoyer l’onglet au groupe suivant' }
  ];

  protected open(request: OpenTabRequest): void {
    this.store.openTab(request);
  }
}
