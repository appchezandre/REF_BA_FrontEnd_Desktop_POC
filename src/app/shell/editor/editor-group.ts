import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild
} from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragMove, CdkDropList } from '@angular/cdk/drag-drop';
import { ElectronService } from '../../core/electron/electron.service';
import { TabDetachService } from '../../core/workspace/tab-detach.service';
import { WorkspaceCloseService } from '../../core/workspace/workspace-close.service';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { EditorGroup, WorkspaceTab } from '../../shared/models/workspace';
import { TabContent } from './tab-content';
import { TabDragService } from './tab-drag.service';

/**
 * Un groupe d'éditeurs : bande d'onglets (drag-and-drop CDK) + panneau de
 * contenu de l'onglet actif. Pendant le drag d'un onglet, le groupe survolé
 * affiche des guides de dock façon Visual Studio (centre = onglet, bords =
 * split) ; un drop sans destination détache l'onglet dans une fenêtre.
 * Seul l'onglet actif est monté ; la stratégie de conservation d'état des
 * onglets masqués viendra avec les features réelles.
 */
@Component({
  selector: 'app-editor-group',
  imports: [CdkDropList, CdkDrag, TabContent],
  templateUrl: './editor-group.html',
  styleUrl: './editor-group.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(click)': 'focusGroup()'
  }
})
export class EditorGroupPane {
  protected readonly store = inject(WorkspaceStore);
  protected readonly electron = inject(ElectronService);
  private readonly detachService = inject(TabDetachService);
  private readonly dragService = inject(TabDragService);
  private readonly closeGuard = inject(WorkspaceCloseService);
  private readonly destroyRef = inject(DestroyRef);

  readonly group = input.required<EditorGroup>();

  private readonly tabStrip = viewChild<ElementRef<HTMLElement>>('tabStrip');

  /** Débordement de la bande d'onglets : gouverne les chevrons de défilement. */
  protected readonly canScrollLeft = signal(false);
  protected readonly canScrollRight = signal(false);

  constructor() {
    // Défilement automatique vers l'onglet actif (ex. onglet fraîchement
    // ajouté hors du champ visible) + recalcul de la visibilité des chevrons
    // à chaque changement d'onglets.
    effect(() => {
      this.group().tabs.length;
      this.group().activeTabId;
      requestAnimationFrame(() => {
        this.scrollActiveIntoView();
        this.updateScrollState();
      });
    });

    afterNextRender(() => {
      this.updateScrollState();
      const strip = this.tabStrip()?.nativeElement;
      if (strip) {
        const observer = new ResizeObserver(() => this.updateScrollState());
        observer.observe(strip);
        this.destroyRef.onDestroy(() => observer.disconnect());
      }
    });
  }

  protected readonly isActiveGroup = computed(
    () => this.store.activeGroupId() === this.group().id
  );

  protected readonly activeTab = computed<WorkspaceTab | null>(() => {
    const group = this.group();
    return group.tabs.find((t) => t.id === group.activeTabId) ?? null;
  });

  protected readonly panelLabelledBy = computed(() => {
    const tab = this.activeTab();
    return tab ? `tab-${tab.id}` : null;
  });

  /** Destination de dock si ce groupe est survolé pendant un drag. */
  protected readonly dockTarget = computed(() => {
    const target = this.dragService.target();
    return target?.groupId === this.group().id ? target : null;
  });

  protected focusGroup(): void {
    this.store.setActiveGroup(this.group().id);
  }

  /** Recalcule la possibilité de défiler à gauche/droite (débordement). */
  protected updateScrollState(): void {
    const strip = this.tabStrip()?.nativeElement;
    if (!strip) {
      return;
    }
    const max = strip.scrollWidth - strip.clientWidth;
    this.canScrollLeft.set(strip.scrollLeft > 1);
    this.canScrollRight.set(strip.scrollLeft < max - 1);
  }

  /** Défile la bande d'un peu moins d'une page dans la direction donnée. */
  protected scrollTabs(direction: -1 | 1): void {
    const strip = this.tabStrip()?.nativeElement;
    if (!strip) {
      return;
    }
    strip.scrollBy({ left: direction * strip.clientWidth * 0.8, behavior: 'smooth' });
  }

  private scrollActiveIntoView(): void {
    const activeId = this.group().activeTabId;
    if (!this.tabStrip() || !activeId) {
      return;
    }
    // Id d'onglet unique dans le DOM : getElementById évite tout échappement.
    document
      .getElementById(`tab-${activeId}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  protected onTabClick(tab: WorkspaceTab): void {
    this.store.activateTab(tab.id);
  }

  protected closeTab(event: Event, tab: WorkspaceTab): void {
    event.stopPropagation();
    this.closeGuard.requestClose(tab.id);
  }

  protected detachActive(): void {
    const tab = this.activeTab();
    if (tab) {
      void this.detachService.detach(tab.id);
    }
  }

  protected onDragStarted(tab: WorkspaceTab): void {
    this.dragService.start(tab.id);
  }

  protected onDragMoved(event: CdkDragMove<string>): void {
    this.dragService.updateFromPointer(event.pointerPosition.x, event.pointerPosition.y);
  }

  protected onDragEnded(): void {
    // Différé : cdkDropListDropped (émis juste après) lit encore la cible.
    this.dragService.scheduleClear();
  }

  /**
   * Traduit le drop en commande du store :
   * - sur une bande d'onglets → réordonner / transférer (CDK) ;
   * - sur une feuille (guides de dock) → dockTab (onglet ou split) ;
   * - sans destination → détachement dans une nouvelle fenêtre (Electron).
   */
  protected onDrop(event: CdkDragDrop<string, string, string>): void {
    const target = this.dragService.target();
    this.dragService.clear();
    const tabId = event.item.data;

    if (event.isPointerOverContainer) {
      const targetGroupId = this.group().id;
      if (event.previousContainer === event.container) {
        this.store.moveTab(targetGroupId, event.previousIndex, event.currentIndex);
      } else {
        this.store.transferTab(
          event.previousContainer.data,
          targetGroupId,
          tabId,
          event.currentIndex
        );
      }
      return;
    }

    if (target) {
      this.store.dockTab(tabId, target.groupId, target.zone);
      return;
    }

    if (this.electron.isElectron) {
      void this.detachService.detach(tabId);
    }
    // En navigateur pur sans cible : l'onglet revient à sa place (CDK).
  }

  /** Navigation clavier locale de la bande d'onglets (roving tabindex). */
  protected onTabKeydown(event: KeyboardEvent, tab: WorkspaceTab): void {
    const tabs = this.group().tabs;
    const index = tabs.findIndex((t) => t.id === tab.id);
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(index + offset + tabs.length) % tabs.length];
        this.activateAndFocus(next.id);
        event.preventDefault();
        break;
      }
      case 'Home':
        this.activateAndFocus(tabs[0].id);
        event.preventDefault();
        break;
      case 'End':
        this.activateAndFocus(tabs[tabs.length - 1].id);
        event.preventDefault();
        break;
      case 'Delete':
        this.closeGuard.requestClose(tab.id);
        event.preventDefault();
        break;
      case 'Enter':
      case ' ':
        this.store.activateTab(tab.id);
        event.preventDefault();
        break;
    }
  }

  private activateAndFocus(tabId: string): void {
    this.store.activateTab(tabId);
    document.getElementById(`tab-${tabId}`)?.focus();
  }
}
