import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  output,
  viewChild
} from '@angular/core';

const END_DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });
const END_TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit'
});

/**
 * Voile de maintenance : bloque intégralement l'interface tant que l'API est
 * en maintenance.
 *
 * Volontairement NON écartable : ni Échap, ni clic sur l'arrière-plan — le voile
 * ne se lève de lui-même qu'à la fin de la maintenance. Le fond opaque
 * neutralise le pointeur ; le focus est déplacé dans le voile à l'affichage puis
 * **retenu** (`onDocumentFocusIn`), sans quoi la tabulation atteindrait encore
 * le formulaire resté monté derrière.
 *
 * Deux publics, deux jeux d'actions exclusifs :
 * - la fenêtre qui a déclenché la maintenance (`canLift`) peut la **lever** ;
 *   sa session est conservée pour cela, et on ne lui propose pas de quitter
 *   l'application — elle est le seul moyen de la remettre en service ;
 * - les autres fenêtres (`canClose`) n'ont plus qu'à **fermer l'application**,
 *   ou attendre la fin de l'intervention.
 */
@Component({
  selector: 'app-maintenance-overlay',
  templateUrl: './maintenance-overlay.html',
  styleUrl: './maintenance-overlay.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:focusin)': 'onDocumentFocusIn($event)'
  }
})
export class MaintenanceOverlay {
  readonly message = input.required<string>();
  /** Durée estimée annoncée par le serveur ; masquée si 0 (inconnue). */
  readonly delayMinutes = input(0);
  /** Début de la maintenance côté serveur (chaîne ISO), pour la fin prévue. */
  readonly changedAtUtc = input('');
  /**
   * Affiche l'action d'exploitation « Lever la maintenance », et signale par là
   * même que la session de cette fenêtre a été conservée.
   */
  readonly canLift = input(false);
  /** Affiche « Fermer l'application ». */
  readonly canClose = input(true);
  /** Indique qu'une levée est en cours (bouton désactivé). */
  readonly lifting = input(false);
  /** Message d'erreur d'une tentative de levée échouée. */
  readonly error = input<string | null>(null);

  /** Fermeture de l'application demandée par l'utilisateur. */
  readonly closed = output<void>();
  readonly lift = output<void>();

  private readonly container = viewChild<ElementRef<HTMLElement>>('container');

  /**
   * Fin prévisionnelle : horodatage serveur + durée annoncée, affichée dans le
   * fuseau local. Null — donc masquée — si la durée est inconnue ou
   * l'horodatage inexploitable : mieux vaut aucune heure qu'une heure fausse.
   */
  protected readonly estimatedEnd = computed(() => {
    const delay = this.delayMinutes();
    if (delay <= 0) {
      return null;
    }
    const startedMs = Date.parse(this.changedAtUtc());
    if (Number.isNaN(startedMs)) {
      return null;
    }
    const end = new Date(startedMs + delay * 60_000);
    return `${END_DATE_FORMAT.format(end)} à ${END_TIME_FORMAT.format(end)}`;
  });

  constructor() {
    // Le focus va à la première action offerte, quelle qu'elle soit ; à défaut
    // au conteneur, qui reste focalisable pour retenir le focus.
    afterNextRender(() => {
      const container = this.container()?.nativeElement;
      (container?.querySelector('button') ?? container)?.focus();
    });
  }

  /**
   * Ramène le focus dans le voile s'il en sort (tabulation vers un champ resté
   * monté derrière). Sans effet lorsque le focus est déjà à l'intérieur, donc
   * pas de récurrence sur le `focusin` déclenché par ce rappel.
   */
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
