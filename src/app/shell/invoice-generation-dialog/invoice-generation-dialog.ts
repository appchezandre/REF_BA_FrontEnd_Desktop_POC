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
import { InvoiceGenerationService } from '../../core/invoicing/invoice-generation.service';
import { ShellUiService } from '../../core/shell/shell-ui.service';

/** Bornes de validation, alignées sur celles du backend (FluentValidation). */
const MIN_YEAR = 2000;

/** Libellés des mois pour le sélecteur (index 0 = janvier, valeur = index + 1). */
const MONTH_LABELS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre'
] as const;

/**
 * Dialog modal « Génération Factures » : saisie de la période (pré-remplie au
 * mois précédent) et lancement du traitement backend. Sur succès, le dialog se
 * ferme et la side bar bascule sur « Traitements en cours » ; un 409 (run déjà
 * en cours pour la période) est un succès de reprise, signalé dans le panneau.
 *
 * Même piège de focus que le dialog « Changer d'utilisateur » : le shell reste
 * monté (et interactif) derrière.
 */
@Component({
  selector: 'app-invoice-generation-dialog',
  templateUrl: './invoice-generation-dialog.html',
  styleUrl: './invoice-generation-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'closed.emit()',
    '(document:focusin)': 'onDocumentFocusIn($event)'
  }
})
export class InvoiceGenerationDialog {
  private readonly invoiceGeneration = inject(InvoiceGenerationService);
  private readonly shellUi = inject(ShellUiService);

  /** Fermeture demandée : abandon (Annuler, Échap, arrière-plan) ou succès. */
  readonly closed = output<void>();

  protected readonly months = MONTH_LABELS;
  protected readonly minYear = MIN_YEAR;
  /** Borne backend : année courante + 1. */
  protected readonly maxYear = new Date().getFullYear() + 1;

  protected readonly year = signal(0);
  protected readonly month = signal(0);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly valid = computed(() => {
    const year = this.year();
    const month = this.month();
    return (
      Number.isInteger(year) &&
      year >= MIN_YEAR &&
      year <= this.maxYear &&
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12
    );
  });

  private readonly container = viewChild<ElementRef<HTMLElement>>('container');

  constructor() {
    // Pré-remplissage au mois précédent (cas d'usage : facturer le mois
    // écoulé), en gérant janvier -> décembre de l'année précédente.
    const previous = new Date();
    previous.setDate(1);
    previous.setMonth(previous.getMonth() - 1);
    this.year.set(previous.getFullYear());
    this.month.set(previous.getMonth() + 1);

    afterNextRender(() => {
      const container = this.container()?.nativeElement;
      (container?.querySelector('select') ?? container)?.focus();
    });
  }

  protected onMonthChange(event: Event): void {
    this.month.set(Number((event.target as HTMLSelectElement).value));
  }

  protected onYearChange(event: Event): void {
    this.year.set(Number((event.target as HTMLInputElement).value));
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting() || !this.valid()) {
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const result = await this.invoiceGeneration.launch(this.year(), this.month());
    this.submitting.set(false);
    if (result.ok) {
      this.closed.emit();
      this.shellUi.revealJobs();
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
