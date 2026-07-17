import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  input,
  output,
  viewChild
} from '@angular/core';

/**
 * Boîte de dialogue de confirmation modale, accessible et réutilisable.
 * Présentation pure : l'appelant décide de l'afficher et réagit aux sorties.
 * Échap et le clic sur l'arrière-plan annulent ; le focus va au bouton
 * primaire à l'ouverture.
 */
@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'cancelled.emit()'
  }
})
export class ConfirmDialog {
  readonly title = input('Confirmer');
  readonly message = input.required<string>();
  readonly confirmLabel = input('Confirmer');
  readonly cancelLabel = input('Annuler');
  /** Style d'accent du bouton primaire (`danger` pour une action destructive). */
  readonly tone = input<'primary' | 'danger'>('primary');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly confirmButton =
    viewChild<ElementRef<HTMLButtonElement>>('confirmButton');

  constructor() {
    afterNextRender(() => this.confirmButton()?.nativeElement.focus());
  }
}
