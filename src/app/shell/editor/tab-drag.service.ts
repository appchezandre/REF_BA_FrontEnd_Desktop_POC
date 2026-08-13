import { Injectable, signal } from '@angular/core';
import { DockZone } from '../../shared/models/workspace';

export interface DockTarget {
  readonly groupId: string;
  readonly zone: DockZone;
  /** Faux quand les guides de bord sont supprimés (dock qui serait un no-op). */
  readonly edgeGuides: boolean;
}

/** Demi-côté d'une pastille de guide (pastilles de 40 px). */
const GUIDE_HALF = 20;
/** Distance entre le centre du groupe et le centre d'une pastille latérale
    (cellules de 40 px + espacement de 4 px dans la grille des guides). */
const GUIDE_OFFSET = 44;
/** Largeur relative des bandes de proximité des bords. */
const EDGE_BAND = 0.2;

/** Poignées de redimensionnement (bandes de 2-4 px recouvrant les bords des
    groupes) : le hit-test les traverse en conservant la cible précédente. */
const RESIZE_HANDLE_SELECTOR =
  '.split-handle, .panel-resize-handle, .sidebar-resize-handle';

/**
 * Zone de dock sous le pointeur : d'abord les pastilles de la croix de
 * guides (comme Visual Studio), sinon les bandes de proximité des bords,
 * sinon le centre. Avec `suppressEdges`, les zones de bord sont dégradées
 * vers `center` (jamais null : un target null déclencherait le détachement
 * sous Electron) — cas de l'unique onglet survolant son propre groupe, où
 * un split serait un no-op.
 */
export function computeZone(
  rect: DOMRect,
  x: number,
  y: number,
  suppressEdges = false
): DockZone {
  if (suppressEdges) {
    return 'center';
  }
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const guides: ReadonlyArray<readonly [DockZone, number, number]> = [
    ['center', cx, cy],
    ['left', cx - GUIDE_OFFSET, cy],
    ['right', cx + GUIDE_OFFSET, cy],
    ['top', cx, cy - GUIDE_OFFSET],
    ['bottom', cx, cy + GUIDE_OFFSET]
  ];
  for (const [zone, gx, gy] of guides) {
    if (Math.abs(x - gx) <= GUIDE_HALF && Math.abs(y - gy) <= GUIDE_HALF) {
      return zone;
    }
  }
  const rx = (x - rect.left) / rect.width;
  const ry = (y - rect.top) / rect.height;
  if (rx < EDGE_BAND) {
    return 'left';
  }
  if (rx > 1 - EDGE_BAND) {
    return 'right';
  }
  if (ry < EDGE_BAND) {
    return 'top';
  }
  if (ry > 1 - EDGE_BAND) {
    return 'bottom';
  }
  return 'center';
}

/**
 * Suit le drag d'un onglet et détermine la destination de dock sous le
 * pointeur (groupe + zone). Seuls les groupes d'éditeurs sont des cibles
 * (éléments `[data-dock-group]`) : le panneau inférieur, la side bar, etc.
 * ne sont jamais des destinations — un drop sans destination détache
 * l'onglet dans une nouvelle fenêtre.
 */
@Injectable({ providedIn: 'root' })
export class TabDragService {
  private readonly draggingSignal = signal<string | null>(null);
  private readonly targetSignal = signal<DockTarget | null>(null, {
    equal: (a, b) =>
      a?.groupId === b?.groupId && a?.zone === b?.zone && a?.edgeGuides === b?.edgeGuides
  });
  /** Groupe d'origine de l'onglet en cours de drag. */
  private sourceGroupId: string | null = null;
  /** Vrai si l'onglet glissé est le seul onglet de son groupe d'origine. */
  private soleTab = false;

  /** Id de l'onglet en cours de drag, sinon null. */
  readonly dragging = this.draggingSignal.asReadonly();
  /** Destination de dock courante, sinon null. */
  readonly target = this.targetSignal.asReadonly();

  start(tabId: string, sourceGroupId: string, isSoleTab: boolean): void {
    this.draggingSignal.set(tabId);
    this.targetSignal.set(null);
    this.sourceGroupId = sourceGroupId;
    this.soleTab = isSoleTab;
  }

  updateFromPointer(x: number, y: number): void {
    if (this.draggingSignal() === null) {
      return;
    }
    // L'aperçu CDK et l'overlay de dock sont en pointer-events: none.
    const element = document.elementFromPoint(x, y);
    // Poignée de redimensionnement (2-4 px) : cible précédente conservée.
    if (element?.closest(RESIZE_HANDLE_SELECTOR)) {
      return;
    }
    // Au-dessus d'une bande d'onglets, le CDK gère l'insertion : pas de dock.
    if (!element || element.closest('.tab-strip')) {
      this.targetSignal.set(null);
      return;
    }
    const section = element.closest<HTMLElement>('[data-dock-group]');
    const groupId = section?.dataset['dockGroup'];
    if (!section || !groupId) {
      this.targetSignal.set(null);
      return;
    }
    // Unique onglet survolant son propre groupe : un split serait un no-op
    // (dockTab l'ignore) — on n'affiche que la zone centre.
    const suppressEdges = this.soleTab && groupId === this.sourceGroupId;
    this.targetSignal.set({
      groupId,
      zone: computeZone(section.getBoundingClientRect(), x, y, suppressEdges),
      edgeGuides: !suppressEdges
    });
  }

  clear(): void {
    this.draggingSignal.set(null);
    this.targetSignal.set(null);
    this.sourceGroupId = null;
    this.soleTab = false;
  }

  /**
   * Nettoyage différé pour la fin de drag : l'événement `cdkDragEnded` est
   * émis AVANT `cdkDropListDropped`, qui a encore besoin de la cible.
   */
  scheduleClear(): void {
    setTimeout(() => this.clear(), 0);
  }
}
