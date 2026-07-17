import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { WindowSyncService } from '../electron/window-sync.service';

export type Theme = 'dark' | 'dark-red' | 'dark-mint' | 'light' | 'light-mint';

const THEMES: readonly Theme[] = ['dark', 'dark-red', 'dark-mint', 'light', 'light-mint'];
const STORAGE_KEY = 'app-theme';
const SYNC_TOPIC = 'ui/theme';
const DEFAULT_THEME: Theme = 'dark';

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Thème de l'application (sombre / clair). Applique le thème à l'élément
 * racine (`data-theme`), le persiste (localStorage, partagé par les fenêtres
 * de même origine) et le synchronise en direct entre fenêtres via le bus.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly sync = inject(WindowSyncService);
  private readonly themeSignal = signal<Theme>(readStoredTheme());

  readonly theme = this.themeSignal.asReadonly();
  readonly available = THEMES;

  constructor() {
    effect(() => {
      const theme = this.themeSignal();
      document.documentElement.setAttribute('data-theme', theme);
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // Stockage indisponible : le thème reste appliqué pour la session.
      }
    });

    const unsubscribe = this.sync.onTopic(SYNC_TOPIC, (data) => {
      if (isTheme(data)) {
        this.themeSignal.set(data);
      }
    });
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  /** Change le thème (action utilisateur) et le diffuse aux autres fenêtres. */
  setTheme(theme: Theme): void {
    if (!isTheme(theme) || theme === this.themeSignal()) {
      return;
    }
    this.themeSignal.set(theme);
    this.sync.publish(SYNC_TOPIC, theme);
  }
}
