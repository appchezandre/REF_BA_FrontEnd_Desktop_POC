import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { ElectronService } from '../../core/electron/electron.service';
import { ShellUiService } from '../../core/shell/shell-ui.service';
import { WorkspaceStore } from '../../core/workspace/workspace-store';

/** Libellé d'affichage d'un utilisateur : nom, sinon e-mail. */
function userLabelOf(user: { displayName: string; email: string } | null): string | null {
  if (!user) {
    return null;
  }
  return user.displayName || user.email || 'Utilisateur connecté';
}

/** Barre d'état (style VSCode) : mode de fenêtre, runtime, utilisateur, compteurs. */
@Component({
  selector: 'app-status-bar',
  templateUrl: './status-bar.html',
  styleUrl: './status-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StatusBar {
  protected readonly store = inject(WorkspaceStore);
  protected readonly electron = inject(ElectronService);
  protected readonly auth = inject(AuthService);
  private readonly shellUi = inject(ShellUiService);

  protected readonly isDetached = computed(
    () => this.store.windowMode() === 'detached-tab'
  );

  protected readonly modeLabel = computed(() =>
    this.isDetached() ? 'Fenêtre détachée' : 'Fenêtre principale'
  );

  protected readonly runtimeLabel = computed(() => {
    if (!this.electron.isElectron) {
      return 'Navigateur';
    }
    const version = this.electron.version();
    return version ? `Desktop v${version}` : 'Desktop';
  });

  /** Libellé utilisateur actif : nom d'affichage, sinon e-mail (claims du JWT). */
  protected readonly userLabel = computed(() => userLabelOf(this.auth.user()));

  /** Utilisateur qui redeviendra actif à la prochaine déconnexion (pile). */
  protected readonly previousUserLabel = computed(() =>
    userLabelOf(this.auth.previousUser())
  );

  /** Nombre de sessions restées connectées derrière la session active. */
  protected readonly stackedCount = computed(() =>
    Math.max(0, this.auth.sessionCount() - 1)
  );

  protected readonly logoutLabel = computed(() => {
    const previous = this.previousUserLabel();
    return previous ? `Se déconnecter (revient à ${previous})` : 'Se déconnecter';
  });

  protected readonly logoutTitle = computed(() => {
    const previous = this.previousUserLabel();
    return previous
      ? `Se déconnecter : ${previous} redevient l'utilisateur actif (toutes les fenêtres)`
      : 'Se déconnecter (toutes les fenêtres)';
  });

  protected switchUser(): void {
    this.shellUi.openUserSwitchDialog();
  }

  protected logout(): void {
    void this.auth.logout();
  }
}
