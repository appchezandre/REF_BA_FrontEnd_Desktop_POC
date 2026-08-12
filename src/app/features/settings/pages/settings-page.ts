import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MaintenanceService } from '../../../core/maintenance/maintenance.service';
import { Theme, ThemeService } from '../../../core/theme/theme.service';

interface ThemeOption {
  readonly value: Theme;
  readonly label: string;
}

/** Délai par défaut annoncé aux utilisateurs, aligné sur celui de l'API. */
const DEFAULT_DELAY_MINUTES = 5;

/** Écran Paramètres : apparence (thème) et, à terme, autres préférences. */
@Component({
  selector: 'app-settings-page',
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsPage {
  protected readonly themeService = inject(ThemeService);
  private readonly maintenance = inject(MaintenanceService);

  protected readonly themeOptions: readonly ThemeOption[] = [
    { value: 'dark', label: 'Sombre (bleu)' },
    { value: 'dark-red', label: 'Sombre (rouge)' },
    { value: 'dark-mint', label: 'Sombre (vert menthe)' },
    { value: 'light', label: 'Clair (rouge)' },
    { value: 'light-mint', label: 'Clair (vert menthe)' }
  ];

  protected readonly delayMinutes = signal(DEFAULT_DELAY_MINUTES);
  protected readonly customMessage = signal('');
  protected readonly starting = signal(false);
  protected readonly maintenanceError = signal<string | null>(null);

  protected onThemeChange(event: Event): void {
    this.themeService.setTheme((event.target as HTMLSelectElement).value as Theme);
  }

  protected onDelayInput(event: Event): void {
    const parsed = Number.parseInt((event.target as HTMLInputElement).value, 10);
    this.delayMinutes.set(
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DELAY_MINUTES
    );
  }

  protected onMessageInput(event: Event): void {
    this.customMessage.set((event.target as HTMLInputElement).value);
  }

  /**
   * Passe l'application en maintenance. Conséquence immédiate et voulue :
   * toutes les fenêtres, y compris celle-ci, sont figées et déconnectées ;
   * la levée se fait depuis le voile de maintenance de cette fenêtre.
   */
  protected async onStartMaintenance(): Promise<void> {
    if (this.starting()) {
      return;
    }
    this.starting.set(true);
    this.maintenanceError.set(null);
    const message = this.customMessage().trim();
    const result = await this.maintenance.startMaintenance(
      this.delayMinutes(),
      message.length > 0 ? message : null
    );
    this.starting.set(false);
    if (!result.ok) {
      this.maintenanceError.set(result.error);
    }
  }
}
