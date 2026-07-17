import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal
} from '@angular/core';
import { ElectronService } from '../core/electron/electron.service';
import { ShellUiService, ActivityView } from '../core/shell/shell-ui.service';
import { ThemeService } from '../core/theme/theme.service';
import { TabDetachService } from '../core/workspace/tab-detach.service';
import { WindowCloseService } from '../core/workspace/window-close.service';
import { WorkspaceCloseService } from '../core/workspace/workspace-close.service';
import { WorkspaceStore } from '../core/workspace/workspace-store';
import { ConfirmDialog } from '../shared/components/confirm-dialog/confirm-dialog';
import { ActivityBar } from './activity-bar/activity-bar';
import { EditorArea } from './editor/editor-area';
import { Panel } from './panel/panel';
import { SideBar } from './side-bar/side-bar';
import { StatusBar } from './status-bar/status-bar';
import { TitleBar } from './title-bar/title-bar';

const PANEL_MIN_HEIGHT = 100;
const PANEL_DEFAULT_HEIGHT = 200;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_DEFAULT_WIDTH = 330;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Page principale : layout type VSCode (title bar, activity bar, side bar,
 * groupes d'éditeurs, panneau inférieur, status bar). Tous les raccourcis
 * clavier globaux sont centralisés ici — pas de HostListener dispersés.
 */
@Component({
  selector: 'app-shell',
  imports: [TitleBar, ActivityBar, SideBar, EditorArea, Panel, StatusBar, ConfirmDialog],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeydown($event)'
  }
})
export class Shell {
  protected readonly store = inject(WorkspaceStore);
  protected readonly electron = inject(ElectronService);
  protected readonly closeGuard = inject(WorkspaceCloseService);
  protected readonly windowClose = inject(WindowCloseService);
  protected readonly shellUi = inject(ShellUiService);
  private readonly detachService = inject(TabDetachService);
  // Instancié dès le boot pour appliquer le thème enregistré.
  private readonly theme = inject(ThemeService);

  // Visibilité et vue de la side bar : portées par ShellUiService pour être
  // pilotables depuis des composants profonds (bouton Rechercher de la table).
  protected readonly sidebarVisible = this.shellUi.sidebarVisible;
  protected readonly activeActivity = this.shellUi.activityView;
  // Préférences d'agencement. À intégrer au schéma de persistance du workspace
  // (cf. docs/systeme-fenetrage.md §12) : largeur side bar, hauteur panneau,
  // visibilités — restaurées au démarrage une fois la persistance en place.
  protected readonly panelVisible = signal(true);
  protected readonly panelHeight = signal(PANEL_DEFAULT_HEIGHT);
  protected readonly sidebarWidth = signal(SIDEBAR_DEFAULT_WIDTH);

  constructor() {
    // Contexte transmis par Electron Main (null en navigateur pur).
    void this.electron
      .getContext()
      .then((context) => this.store.initializeForContext(context));

    // Fenêtre détachée : fermer le dernier onglet ferme la fenêtre native.
    effect(() => {
      if (this.store.windowMode() === 'detached-tab' && this.store.totalTabCount() === 0) {
        void this.electron.closeWindow();
      }
    });
  }

  protected onActivitySelected(view: ActivityView): void {
    this.shellUi.selectActivity(view);
  }

  protected toggleSidebar(): void {
    this.shellUi.toggleSidebar();
  }

  protected togglePanel(): void {
    this.panelVisible.update((visible) => !visible);
  }

  /** Redimensionnement du panneau inférieur à la poignée (pointeur). */
  protected onPanelResizeStart(event: PointerEvent): void {
    event.preventDefault();
    const handle = event.target as HTMLElement;
    handle.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = this.panelHeight();

    const onMove = (moveEvent: PointerEvent) => {
      this.panelHeight.set(
        this.clampPanelHeight(startHeight + (startY - moveEvent.clientY))
      );
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

  /** Alternative clavier : flèches haut/bas par pas de 24 px. */
  protected onPanelResizeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    const step = event.key === 'ArrowUp' ? 24 : -24;
    this.panelHeight.set(this.clampPanelHeight(this.panelHeight() + step));
    event.preventDefault();
  }

  /** Redimensionnement de la side bar à la poignée (pointeur). */
  protected onSidebarResizeStart(event: PointerEvent): void {
    event.preventDefault();
    const handle = event.target as HTMLElement;
    handle.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = this.sidebarWidth();

    const onMove = (moveEvent: PointerEvent) => {
      this.sidebarWidth.set(
        this.clampSidebarWidth(startWidth + (moveEvent.clientX - startX))
      );
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

  /** Alternative clavier : flèches gauche/droite par pas de 24 px. */
  protected onSidebarResizeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    const step = event.key === 'ArrowRight' ? 24 : -24;
    this.sidebarWidth.set(this.clampSidebarWidth(this.sidebarWidth() + step));
    event.preventDefault();
  }

  /**
   * Raccourcis globaux. En navigateur pur, Ctrl+W et Ctrl+Tab sont réservés
   * par Chrome : Ctrl+PageUp/PageDown servent d'alias (comme dans VSCode).
   */
  protected onKeydown(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) {
      return;
    }
    const key = event.key.toLowerCase();

    if (key === 'w' && !event.shiftKey && !event.altKey) {
      const tab = this.store.activeTab();
      if (tab) {
        this.closeGuard.requestClose(tab.id);
      }
      event.preventDefault();
      return;
    }

    if (key === 'tab' || key === 'pagedown' || key === 'pageup') {
      const backwards = key === 'pageup' || (key === 'tab' && event.shiftKey);
      if (backwards) {
        this.store.activatePreviousTab();
      } else {
        this.store.activateNextTab();
      }
      event.preventDefault();
      return;
    }

    if (key === 'b' && !event.shiftKey && !event.altKey) {
      this.toggleSidebar();
      event.preventDefault();
      return;
    }

    // 'ù' : disposition AZERTY (comme VSCode en clavier français) ; 'j' en QWERTY.
    if ((key === 'ù' || key === 'j') && !event.shiftKey && !event.altKey) {
      this.togglePanel();
      event.preventDefault();
      return;
    }

    if (key === 'd' && event.altKey) {
      const tab = this.store.activeTab();
      if (tab) {
        void this.detachService.detach(tab.id);
      }
      event.preventDefault();
      return;
    }

    // Alternatives clavier au drag-and-drop.
    if (event.shiftKey && (key === 'arrowleft' || key === 'arrowright')) {
      this.moveActiveTab(key === 'arrowright' ? 1 : -1);
      event.preventDefault();
      return;
    }

    if (event.altKey && key === 'arrowright') {
      this.store.moveActiveTabToNextGroup();
      event.preventDefault();
      return;
    }

    if (key === 'f6') {
      this.store.focusNextGroup();
      event.preventDefault();
    }
  }

  private moveActiveTab(offset: number): void {
    const group = this.store.activeGroup();
    const tab = this.store.activeTab();
    if (!group || !tab) {
      return;
    }
    const index = group.tabs.findIndex((t) => t.id === tab.id);
    this.store.moveTab(group.id, index, index + offset);
  }

  private clampPanelHeight(height: number): number {
    const max = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - 220);
    return clamp(height, PANEL_MIN_HEIGHT, max);
  }

  private clampSidebarWidth(width: number): number {
    // Réserve la barre d'activité (48px) + une largeur minimale d'éditeur.
    const max = Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - 48 - 300);
    return clamp(width, SIDEBAR_MIN_WIDTH, max);
  }
}
