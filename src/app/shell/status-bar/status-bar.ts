import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { ElectronService } from '../../core/electron/electron.service';
import { WorkspaceStore } from '../../core/workspace/workspace-store';

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

  /** Libellé utilisateur : nom d'affichage, sinon e-mail (claims du JWT). */
  protected readonly userLabel = computed(() => {
    const user = this.auth.user();
    if (!user) {
      return null;
    }
    return user.displayName || user.email || 'Utilisateur connecté';
  });

  protected logout(): void {
    void this.auth.logout();
  }
}
