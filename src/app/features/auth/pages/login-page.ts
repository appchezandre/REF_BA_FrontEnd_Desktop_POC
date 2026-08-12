import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { ElectronService } from '../../../core/electron/electron.service';
import { MaintenanceService } from '../../../core/maintenance/maintenance.service';

/**
 * Écran de connexion, affiché à la place du shell tant qu'aucune session
 * n'est établie (cf. `App`). La fenêtre Electron étant sans cadre, la page
 * porte sa propre bande de titre minimale (zone de drag + réduire/fermer).
 */
@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginPage {
  protected readonly electron = inject(ElectronService);
  private readonly auth = inject(AuthService);
  private readonly maintenance = inject(MaintenanceService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async onSubmit(): Promise<void> {
    // Aucune connexion pendant une maintenance. Le voile rendu par `App`
    // recouvre déjà ce formulaire et l'intercepteur refuserait la requête :
    // ce garde-fou rend la règle explicite là où elle s'applique.
    if (this.submitting() || this.maintenance.underMaintenance()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    const result = await this.auth.login(email, password);
    this.submitting.set(false);
    if (!result.ok) {
      this.error.set(result.error);
    }
  }

  protected minimize(): void {
    void this.electron.minimize();
  }

  protected close(): void {
    void this.electron.closeWindow();
  }
}
