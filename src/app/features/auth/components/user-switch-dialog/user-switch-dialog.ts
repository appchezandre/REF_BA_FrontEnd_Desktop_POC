import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild
} from '@angular/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { MaintenanceService } from '../../../../core/maintenance/maintenance.service';
import { LoginCredentials, LoginForm } from '../login-form/login-form';

/**
 * Dialog modal « Changer d'utilisateur » : une nouvelle connexion EMPILE une
 * session (l'utilisateur courant reste connecté, inactif, et redeviendra
 * actif à la déconnexion du nouveau) ; Annuler / Échap / clic sur
 * l'arrière-plan abandonnent sans rien changer.
 *
 * Contrairement au voile de maintenance, le dialog est écartable ; il en
 * reprend en revanche le piège de focus (`onDocumentFocusIn`) : sans lui, la
 * tabulation atteindrait le shell resté monté (et interactif) derrière.
 */
@Component({
  selector: 'app-user-switch-dialog',
  imports: [LoginForm],
  templateUrl: './user-switch-dialog.html',
  styleUrl: './user-switch-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'closed.emit()',
    '(document:focusin)': 'onDocumentFocusIn($event)'
  }
})
export class UserSwitchDialog {
  private readonly auth = inject(AuthService);
  private readonly maintenance = inject(MaintenanceService);

  /** Fermeture demandée : abandon (Annuler, Échap, arrière-plan) ou succès. */
  readonly closed = output<void>();

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Rappel : qui reste connecté derrière la nouvelle session. */
  protected readonly currentUserLabel = computed(() => {
    const user = this.auth.user();
    return user ? user.displayName || user.email : null;
  });

  private readonly container = viewChild<ElementRef<HTMLElement>>('container');

  constructor() {
    afterNextRender(() => {
      const container = this.container()?.nativeElement;
      (container?.querySelector('input') ?? container)?.focus();
    });
  }

  protected async onSubmit(credentials: LoginCredentials): Promise<void> {
    // Même règle que la page de connexion : aucune connexion pendant une
    // maintenance (le voile recouvre le dialog, z-index 2000 contre 1500).
    if (this.submitting() || this.maintenance.underMaintenance()) {
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const result = await this.auth.switchUser(credentials.email, credentials.password);
    this.submitting.set(false);
    if (result.ok) {
      this.closed.emit();
    } else {
      this.error.set(result.error);
    }
  }

  /** Retient le focus dans le dialog (shell interactif resté monté derrière). */
  protected onDocumentFocusIn(event: FocusEvent): void {
    const container = this.container()?.nativeElement;
    if (!container || !(event.target instanceof Node)) {
      return;
    }
    if (!container.contains(event.target)) {
      container.focus();
    }
  }
}
