import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Theme, ThemeService } from '../../../core/theme/theme.service';

interface ThemeOption {
  readonly value: Theme;
  readonly label: string;
}

/** Écran Paramètres : apparence (thème) et, à terme, autres préférences. */
@Component({
  selector: 'app-settings-page',
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsPage {
  protected readonly themeService = inject(ThemeService);

  protected readonly themeOptions: readonly ThemeOption[] = [
    { value: 'dark', label: 'Sombre (bleu)' },
    { value: 'dark-red', label: 'Sombre (rouge)' },
    { value: 'dark-mint', label: 'Sombre (vert menthe)' },
    { value: 'light', label: 'Clair (rouge)' },
    { value: 'light-mint', label: 'Clair (vert menthe)' }
  ];

  protected onThemeChange(event: Event): void {
    this.themeService.setTheme((event.target as HTMLSelectElement).value as Theme);
  }
}
