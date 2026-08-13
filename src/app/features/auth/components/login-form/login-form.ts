import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

/** Identifiants saisis, émis à la soumission d'un formulaire valide. */
export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
}

/**
 * Formulaire de connexion (présentation pure), partagé entre la page de
 * connexion plein écran et le dialog « Changer d'utilisateur ». La validation
 * de saisie vit ici ; l'appel à `AuthService` et la garde maintenance restent
 * chez l'hôte, qui pilote `submitting`/`error` en retour.
 */
@Component({
  selector: 'app-login-form',
  imports: [ReactiveFormsModule],
  templateUrl: './login-form.html',
  styleUrl: './login-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginForm {
  private readonly fb = inject(NonNullableFormBuilder);

  readonly submitLabel = input('Se connecter');
  readonly submitting = input(false);
  readonly error = input<string | null>(null);
  readonly showCancel = input(false);

  readonly submitted = output<LoginCredentials>();
  readonly cancelled = output<void>();

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  protected onSubmit(): void {
    if (this.submitting()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitted.emit(this.form.getRawValue());
  }
}
