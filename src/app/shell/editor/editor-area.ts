import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { LayoutNode } from './layout-node';

/**
 * Zone d'éditeurs : rend l'arbre de layout récursif (splits horizontaux et
 * verticaux imbriqués). `cdkDropListGroup` connecte automatiquement toutes
 * les bandes d'onglets, quelle que soit leur profondeur dans l'arbre.
 */
@Component({
  selector: 'app-editor-area',
  imports: [CdkDropListGroup, LayoutNode],
  template: `
    <div class="editor-area" cdkDropListGroup>
      <app-layout-node [node]="store.layout()" />
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-width: 0;
    }

    .editor-area {
      height: 100%;
    }

    app-layout-node {
      display: block;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorArea {
  protected readonly store = inject(WorkspaceStore);
}
