import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { ElectronService } from '../../core/electron/electron.service';
import { WindowCloseService } from '../../core/workspace/window-close.service';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { WorkspaceTab } from '../../shared/models/workspace';

/** Nom d'affichage de l'application (menu Aide, titre). */
const APP_NAME = 'Desktop App';

type MenuLabel = 'Fichier' | 'Édition' | 'Affichage' | 'Aide';

/**
 * Barre de titre personnalisée (fenêtre sans cadre) : menus déroulants, titre
 * centré, boutons d'agencement (side bar / panneau) et contrôles de fenêtre.
 * Les menus offrent Fichier › Quitter (garde de fermeture), Affichage › liste
 * des fenêtres ouvertes (focus au clic) et Aide › Version. Les contrôles
 * pilotent la fenêtre native via IPC.
 */
@Component({
  selector: 'app-title-bar',
  templateUrl: './title-bar.html',
  styleUrl: './title-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()'
  }
})
export class TitleBar {
  protected readonly electron = inject(ElectronService);
  private readonly store = inject(WorkspaceStore);
  private readonly windowClose = inject(WindowCloseService);

  readonly sidebarVisible = input.required<boolean>();
  readonly panelVisible = input.required<boolean>();
  readonly toggleSidebar = output<void>();
  readonly togglePanel = output<void>();

  protected readonly menus: readonly MenuLabel[] = ['Fichier', 'Édition', 'Affichage', 'Aide'];
  protected readonly appName = APP_NAME;
  protected readonly version = this.electron.version;

  /** Menu déroulant actuellement ouvert (null si aucun). */
  protected readonly openMenu = signal<MenuLabel | null>(null);
  /** Boîte « À propos » (Aide › Version). */
  protected readonly aboutOpen = signal(false);

  protected readonly title = computed(() => {
    const tab = this.store.activeTab();
    return tab ? `${tab.title} — ${APP_NAME}` : APP_NAME;
  });

  /** Écrans (onglets) ouverts de la fenêtre, tous groupes confondus. */
  protected readonly openTabs = computed<readonly WorkspaceTab[]>(() =>
    this.store.groups().flatMap((group) => group.tabs)
  );

  /** Id de l'écran actif (pour la puce « courant » du menu Affichage). */
  protected readonly activeTabId = computed(() => this.store.activeTab()?.id ?? null);

  constructor() {
    // Reflète le titre dans document.title : le main process l'utilise pour
    // libeller les fenêtres dans le menu Affichage (BrowserWindow.getTitle()).
    effect(() => {
      document.title = this.title();
    });
  }

  protected toggleMenu(menu: MenuLabel): void {
    if (this.openMenu() === menu) {
      this.openMenu.set(null);
      return;
    }
    this.openMenu.set(menu);
  }

  /** Survol : bascule le menu ouvert si un menu est déjà déroulé (façon VSCode). */
  protected onMenuHover(menu: MenuLabel): void {
    if (this.openMenu() !== null) {
      this.toggleMenu(menu);
    }
  }

  protected closeMenu(): void {
    this.openMenu.set(null);
  }

  /** Affichage › écran ouvert : l'active (le met au premier plan). */
  protected activateTab(tabId: string): void {
    this.closeMenu();
    this.store.activateTab(tabId);
  }

  /** Fichier › Quitter : ferme la fenêtre (garde si modifications non enregistrées). */
  protected exit(): void {
    this.closeMenu();
    this.windowClose.requestExit();
  }

  protected openAbout(): void {
    this.closeMenu();
    this.aboutOpen.set(true);
  }

  protected closeAbout(): void {
    this.aboutOpen.set(false);
  }

  protected onEscape(): void {
    if (this.aboutOpen()) {
      this.aboutOpen.set(false);
    } else {
      this.closeMenu();
    }
  }

  protected minimize(): void {
    void this.electron.minimize();
  }

  protected toggleMaximize(): void {
    void this.electron.toggleMaximize();
  }

  /** Croix système : même garde de fermeture que Fichier › Quitter. */
  protected close(): void {
    this.windowClose.requestExit();
  }
}
