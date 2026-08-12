import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from './core/auth/auth.service';
import { ElectronService } from './core/electron/electron.service';
import { MaintenanceService } from './core/maintenance/maintenance.service';
import { ThemeService } from './core/theme/theme.service';
import { LoginPage } from './features/auth/pages/login-page';
import { MaintenanceBanner } from './shared/components/maintenance-banner/maintenance-banner';
import { MaintenanceOverlay } from './shared/components/maintenance-overlay/maintenance-overlay';
import { Shell } from './shell/shell';

/**
 * Racine : garde d'authentification. Tant qu'aucune session n'est établie,
 * seule la page de connexion est rendue ; le shell (et tous les écrans
 * protégés) est détruit à la déconnexion, dans toutes les fenêtres (la
 * session est synchronisée entre fenêtres par AuthService).
 *
 * Les surfaces de maintenance sont rendues EN DEHORS de cette garde :
 * - pendant le **sursis**, un bandeau non bloquant affiche le décompte, l'appli
 *   restant utilisable pour enregistrer le travail en cours ;
 * - au **gel**, le voile prend le relais ; comme la maintenance force la
 *   déconnexion, le shell disparaît et le voile doit continuer à couvrir
 *   l'écran de connexion pour interdire toute reconnexion.
 */
@Component({
  selector: 'app-root',
  imports: [Shell, LoginPage, MaintenanceBanner, MaintenanceOverlay],
  template: `
    @if (auth.isAuthenticated()) {
      <app-shell />
    } @else {
      <app-login-page />
    }

    @if (maintenance.inGrace()) {
      <app-maintenance-banner
        [message]="maintenance.message()"
        [remainingSeconds]="maintenance.remainingSeconds()" />
    }

    @if (maintenance.frozen()) {
      <app-maintenance-overlay
        [message]="maintenance.message()"
        [delayMinutes]="maintenance.delayMinutes()"
        [changedAtUtc]="maintenance.state().changedAtUtc"
        [canLift]="maintenance.initiatedLocally()"
        [canClose]="!maintenance.initiatedLocally()"
        [lifting]="lifting()"
        [error]="liftError()"
        (lift)="onLift()"
        (closed)="onClose()" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {
  protected readonly auth = inject(AuthService);
  // Instancié dès le boot pour que le thème s'applique aussi à l'écran de connexion.
  private readonly theme = inject(ThemeService);
  // Instancié dès le boot : la maintenance doit être connue avant toute
  // tentative de connexion, et le hub doit être branché sans attendre.
  protected readonly maintenance = inject(MaintenanceService);
  private readonly electron = inject(ElectronService);

  protected readonly lifting = signal(false);
  protected readonly liftError = signal<string | null>(null);

  /** Levée de la maintenance depuis la fenêtre qui l'a déclenchée. */
  protected async onLift(): Promise<void> {
    if (this.lifting()) {
      return;
    }
    this.lifting.set(true);
    this.liftError.set(null);
    const result = await this.maintenance.stopMaintenance();
    this.lifting.set(false);
    if (!result.ok) {
      this.liftError.set(result.error);
    }
  }

  /**
   * Ferme l'application entière, sans garde de modifications non enregistrées :
   * le sursis a déjà laissé le temps d'enregistrer, et le dialogue de
   * confirmation serait de toute façon masqué par le voile. Non proposé à la
   * fenêtre qui a déclenché la maintenance : elle seule peut la lever.
   */
  protected onClose(): void {
    void this.electron.quitApp();
  }
}
