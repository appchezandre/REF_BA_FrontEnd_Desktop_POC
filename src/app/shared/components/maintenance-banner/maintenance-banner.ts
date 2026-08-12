import { CdkDrag, CdkDragEnd } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  signal,
  viewChild
} from '@angular/core';

interface Offset {
  readonly x: number;
  readonly y: number;
}

const CENTERED: Offset = { x: 0, y: 0 };

/** Pas de déplacement au clavier (px), et pas accéléré avec Maj. */
const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_LARGE = 48;

/**
 * Bandeau du sursis de maintenance : avertit que l'application va être figée et
 * affiche le décompte restant.
 *
 * Volontairement **non bloquant** — l'utilisateur doit pouvoir continuer à
 * travailler et enregistrer. Il s'affiche au centre de la fenêtre, et comme il
 * peut masquer justement ce qu'il faut enregistrer, il est **déplaçable** : à la
 * souris (CDK Drag and Drop) ou au clavier depuis sa poignée, alternative exigée
 * pour tout drag-and-drop.
 *
 * Le centrage est assuré par la couche d'accueil (`place-items: center`) et non
 * par une transformation CSS : le CDK pilote lui-même `transform`, les deux
 * entreraient en conflit. Le décalage est donc exprimé *relativement au centre*,
 * ce qui rend le bornage trivial (± la moitié de l'espace libre).
 */
@Component({
  selector: 'app-maintenance-banner',
  imports: [CdkDrag],
  templateUrl: './maintenance-banner.html',
  styleUrl: './maintenance-banner.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MaintenanceBanner {
  readonly message = input.required<string>();
  /** Secondes restantes avant le gel. */
  readonly remainingSeconds = input.required<number>();

  private readonly banner = viewChild<ElementRef<HTMLElement>>('banner');

  /** Décalage courant par rapport au centre de la fenêtre. */
  protected readonly offset = signal<Offset>(CENTERED);

  /** Décompte au format `m:ss`. */
  protected readonly countdown = computed(() => {
    const total = Math.max(0, this.remainingSeconds());
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });

  protected onDragEnded(event: CdkDragEnd): void {
    this.offset.set(this.clampToViewport(event.source.getFreeDragPosition()));
  }

  /** Alternative clavier au déplacement à la souris (flèches, Maj = grand pas). */
  protected onHandleKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
    let dx = 0;
    let dy = 0;
    switch (event.key) {
      case 'ArrowLeft':
        dx = -step;
        break;
      case 'ArrowRight':
        dx = step;
        break;
      case 'ArrowUp':
        dy = -step;
        break;
      case 'ArrowDown':
        dy = step;
        break;
      case 'Home':
        this.offset.set(CENTERED);
        event.preventDefault();
        return;
      default:
        return;
    }
    const current = this.offset();
    this.offset.set(this.clampToViewport({ x: current.x + dx, y: current.y + dy }));
    event.preventDefault();
  }

  /**
   * Borne le décalage pour que le bandeau reste entièrement visible. Le CDK
   * s'en charge pendant un glisser (`cdkDragBoundary`) ; ce bornage couvre le
   * déplacement au clavier et un redimensionnement de la fenêtre.
   */
  private clampToViewport(offset: Offset): Offset {
    const element = this.banner()?.nativeElement;
    if (!element) {
      return offset;
    }
    // `getBoundingClientRect` ignore la translation appliquée par le CDK pour
    // les dimensions : la taille mesurée est bien celle du bandeau.
    const { width, height } = element.getBoundingClientRect();
    const maxX = Math.max(0, (window.innerWidth - width) / 2);
    const maxY = Math.max(0, (window.innerHeight - height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, offset.x)),
      y: Math.min(maxY, Math.max(-maxY, offset.y))
    };
  }
}
