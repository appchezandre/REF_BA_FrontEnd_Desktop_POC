import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  inject,
  input,
  output
} from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { ActivityView } from '../../core/shell/shell-ui.service';

export type { ActivityView };

interface ActivityItem {
  readonly id: ActivityView;
  readonly label: string;
}

/** Barre d'activité verticale (style VSCode) : sélection du panneau latéral. */
@Component({
  selector: 'app-activity-bar',
  templateUrl: './activity-bar.html',
  styleUrl: './activity-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityBar {
  private readonly store = inject(WorkspaceStore);
  private readonly auth = inject(AuthService);
  // Résolution du registre Utilisateurs chargé en différé (cf. openAccount).
  private readonly injector = inject(EnvironmentInjector);

  readonly active = input.required<ActivityView>();
  readonly sidebarVisible = input.required<boolean>();
  readonly selected = output<ActivityView>();

  protected readonly items: readonly ActivityItem[] = [
    { id: 'explorer', label: 'Explorateur' },
    { id: 'search', label: 'Rechercher' }
  ];

  protected isActive(id: ActivityView): boolean {
    return this.active() === id && this.sidebarVisible();
  }

  protected openSettings(): void {
    this.store.openTab({ type: 'settings', title: 'Paramètres' });
  }

  /**
   * Compte : ouvre la fiche de l'utilisateur connecté dans le conteneur
   * Utilisateurs. La clé de fiche est l'id backend, porté par le claim `sub`
   * du JWT ; sans identité décodable (claim absent), le bouton est désactivé
   * plutôt que d'ouvrir une fiche arbitraire.
   *
   * Le registre est chargé en import dynamique : la feature Utilisateurs
   * (service de données, store d'écran) resterait sinon dans le bundle initial
   * du shell alors qu'elle est différée partout ailleurs.
   */
  protected async openAccount(): Promise<void> {
    const id = this.auth.user()?.id;
    if (!id) {
      return;
    }
    const { UsersScreenRegistry } = await import(
      '../../features/users/store/users-screen.registry'
    );
    this.injector.get(UsersScreenRegistry).openUser(id);
  }

  /** Vrai si l'identité du compte connecté est exploitable (fiche ouvrable). */
  protected hasAccount(): boolean {
    return (this.auth.user()?.id ?? '') !== '';
  }
}
