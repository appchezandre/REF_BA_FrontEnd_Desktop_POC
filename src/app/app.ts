import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from './core/auth/auth.service';
import { ThemeService } from './core/theme/theme.service';
import { LoginPage } from './features/auth/pages/login-page';
import { Shell } from './shell/shell';

/**
 * Racine : garde d'authentification. Tant qu'aucune session n'est établie,
 * seule la page de connexion est rendue ; le shell (et tous les écrans
 * protégés) est détruit à la déconnexion, dans toutes les fenêtres (la
 * session est synchronisée entre fenêtres par AuthService).
 */
@Component({
  selector: 'app-root',
  imports: [Shell, LoginPage],
  template: `
    @if (auth.isAuthenticated()) {
      <app-shell />
    } @else {
      <app-login-page />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {
  protected readonly auth = inject(AuthService);
  // Instancié dès le boot pour que le thème s'applique aussi à l'écran de connexion.
  private readonly theme = inject(ThemeService);
}
