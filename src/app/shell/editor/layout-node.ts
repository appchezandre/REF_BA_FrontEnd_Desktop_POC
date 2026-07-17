import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { SplitLayout, WorkspaceLayout } from '../../shared/models/workspace';
import { EditorGroupPane } from './editor-group';

/**
 * Rendu récursif de l'arbre de layout : une feuille affiche un groupe
 * d'éditeurs, un nœud split affiche ses deux branches (elles-mêmes des
 * <app-layout-node>) séparées par une poignée de redimensionnement qui
 * pilote le ratio du nœud (pointeur ou flèches clavier).
 */
@Component({
  selector: 'app-layout-node',
  imports: [EditorGroupPane, LayoutNode],
  template: `
    @let n = node();
    @if (n.kind === 'group') {
      <app-editor-group [group]="n.group" />
    } @else {
      <div class="split" [class.vertical]="n.direction === 'vertical'" #container>
        <app-layout-node [node]="n.first" [style.flexGrow]="n.ratio" />
        <div class="split-handle" role="separator" tabindex="0"
             [attr.aria-orientation]="n.direction === 'horizontal' ? 'vertical' : 'horizontal'"
             aria-label="Redimensionner les groupes d'éditeurs"
             [attr.aria-valuenow]="Math.round(n.ratio * 100)"
             (pointerdown)="onHandlePointerDown($event, n, container)"
             (keydown)="onHandleKeydown($event, n)"></div>
        <app-layout-node [node]="n.second" [style.flexGrow]="1 - n.ratio" />
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
    }

    app-editor-group {
      height: 100%;
    }

    .split {
      display: flex;
      width: 100%;
      height: 100%;
    }

    .split.vertical {
      flex-direction: column;
    }

    .split > app-layout-node {
      flex-basis: 0;
      flex-shrink: 1;
      min-width: 0;
      min-height: 0;
    }

    .split-handle {
      flex: none;
      background: var(--vscode-border);
      background-clip: content-box;
      touch-action: none;
      z-index: 1;
      transition: background-color 100ms linear 150ms;
    }

    .split:not(.vertical) > .split-handle {
      width: 4px;
      margin: 0 -1px;
      padding: 0 1px;
      cursor: ew-resize;
    }

    .split.vertical > .split-handle {
      height: 4px;
      margin: -1px 0;
      padding: 1px 0;
      cursor: ns-resize;
    }

    .split-handle:hover,
    .split-handle:focus-visible,
    .split-handle.dragging {
      background: var(--vscode-accent);
      background-clip: border-box;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LayoutNode {
  protected readonly Math = Math;
  private readonly store = inject(WorkspaceStore);

  readonly node = input.required<WorkspaceLayout>();

  protected onHandlePointerDown(
    event: PointerEvent,
    split: SplitLayout,
    container: HTMLElement
  ): void {
    const horizontal = split.direction === 'horizontal';
    const totalPx = horizontal ? container.offsetWidth : container.offsetHeight;
    if (totalPx <= 0) {
      return;
    }
    event.preventDefault();
    const handle = event.target as HTMLElement;
    handle.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    const startPosition = horizontal ? event.clientX : event.clientY;
    const startRatio = split.ratio;

    const onMove = (moveEvent: PointerEvent) => {
      const position = horizontal ? moveEvent.clientX : moveEvent.clientY;
      this.store.resizeSplit(split.id, startRatio + (position - startPosition) / totalPx);
    };
    const onEnd = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  }

  /** Alternative clavier au drag : flèches selon l'axe, pas de 5 %. */
  protected onHandleKeydown(event: KeyboardEvent, split: SplitLayout): void {
    const horizontal = split.direction === 'horizontal';
    const decreaseKey = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const increaseKey = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== decreaseKey && event.key !== increaseKey) {
      return;
    }
    const step = event.key === increaseKey ? 0.05 : -0.05;
    this.store.resizeSplit(split.id, split.ratio + step);
    event.preventDefault();
  }
}
