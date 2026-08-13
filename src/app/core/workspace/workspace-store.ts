import { Injectable, computed, signal } from '@angular/core';
import {
  DockZone,
  EditorGroup,
  OpenTabRequest,
  SplitDirection,
  WorkspaceLayout,
  WorkspaceTab,
  createTab
} from '../../shared/models/workspace';
import { WindowContext, WindowMode } from '../electron/desktop-api';
import {
  collectGroups,
  groupLeaf,
  mapGroups,
  removeGroup,
  setSplitRatio,
  splitGroup
} from './layout';

function createGroup(
  tabs: readonly WorkspaceTab[],
  activeTabId: string | null
): EditorGroup {
  return { id: `group-${crypto.randomUUID()}`, tabs, activeTabId };
}

function createWelcomeTab(): WorkspaceTab {
  return createTab({ type: 'welcome', title: 'Bienvenue' });
}

function createDefaultLayout(): WorkspaceLayout {
  const welcome = createWelcomeTab();
  return groupLeaf(createGroup([welcome], welcome.id));
}

/** Deux onglets de même type et même entité représentent le même écran. */
function dedupeKey(type: string, entityId: string | undefined): string {
  return `${type}::${entityId ?? ''}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Garde de type : `initialTab` provient d'IPC et est non fiable. */
function parseInitialTab(raw: unknown, windowId: string): WorkspaceTab | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value['id'] !== 'string' || value['id'].length === 0) {
    return null;
  }
  if (typeof value['type'] !== 'string' || value['type'].length === 0) {
    return null;
  }
  if (typeof value['title'] !== 'string' || value['title'].length === 0) {
    return null;
  }
  const state = value['state'];
  return {
    id: value['id'],
    type: value['type'],
    title: value['title'],
    entityId: typeof value['entityId'] === 'string' ? value['entityId'] : undefined,
    icon: typeof value['icon'] === 'string' ? value['icon'] : undefined,
    closable: value['closable'] !== false,
    dirty: value['dirty'] === true,
    pinned: value['pinned'] === true,
    detached: true,
    windowId,
    // État d'écran transporté par le détachement ; hydraté par la feature.
    state:
      typeof state === 'object' && state !== null && !Array.isArray(state)
        ? (state as Record<string, unknown>)
        : undefined
  };
}

/**
 * État du workspace de CETTE fenêtre : arbre récursif de layout
 * (`WorkspaceLayout`) dont les feuilles sont les groupes d'onglets et les
 * nœuds internes des splits horizontaux ou verticaux avec un ratio.
 *
 * Les composants ne manipulent jamais l'arbre directement : toute mutation
 * passe par les méthodes de ce store (structures immutables, références des
 * sous-arbres non modifiés préservées pour OnPush).
 *
 * Le store est pur (aucun IPC) : la synchronisation inter-fenêtres passe par
 * les services de core/electron.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly layoutSignal = signal<WorkspaceLayout>(createDefaultLayout());
  private readonly activeGroupIdSignal = signal<string | null>(null);
  private readonly windowModeSignal = signal<WindowMode>('main');
  private readonly pendingDetachIdsSignal = signal<ReadonlySet<string>>(new Set());
  private initialized = false;

  readonly layout = this.layoutSignal.asReadonly();
  readonly windowMode = this.windowModeSignal.asReadonly();
  readonly pendingDetachIds = this.pendingDetachIdsSignal.asReadonly();

  /** Feuilles de l'arbre, de gauche à droite (parcours en profondeur). */
  readonly groups = computed(() => collectGroups(this.layoutSignal()));

  readonly activeGroup = computed<EditorGroup | null>(() => {
    const groups = this.groups();
    return groups.find((g) => g.id === this.activeGroupIdSignal()) ?? groups[0] ?? null;
  });

  readonly activeGroupId = computed(() => this.activeGroup()?.id ?? null);

  readonly activeTab = computed<WorkspaceTab | null>(() => {
    const group = this.activeGroup();
    return group?.tabs.find((t) => t.id === group.activeTabId) ?? null;
  });

  readonly totalTabCount = computed(() =>
    this.groups().reduce((count, group) => count + group.tabs.length, 0)
  );

  /** Vrai si au moins un onglet de la fenêtre porte des modifications non
   *  enregistrées (garde de fermeture de fenêtre). */
  readonly hasUnsavedChanges = computed(() =>
    this.groups().some((group) => group.tabs.some((tab) => tab.dirty))
  );

  /**
   * Applique le contexte transmis par Electron Main au démarrage.
   * Fenêtre détachée : une seule feuille contenant l'onglet transféré.
   * Contexte absent (navigateur) ou fenêtre principale : état par défaut.
   */
  initializeForContext(context: WindowContext | null): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    if (!context) {
      return;
    }
    this.windowModeSignal.set(context.mode);
    if (context.mode !== 'detached-tab') {
      return;
    }
    const tab = parseInitialTab(context.initialTab, context.windowId);
    if (!tab) {
      // Payload invalide : on conserve l'état par défaut (welcome).
      return;
    }
    const group = createGroup([tab], tab.id);
    this.layoutSignal.set(groupLeaf(group));
    this.activeGroupIdSignal.set(group.id);
  }

  findTab(tabId: string): WorkspaceTab | null {
    for (const group of this.groups()) {
      const tab = group.tabs.find((t) => t.id === tabId);
      if (tab) {
        return tab;
      }
    }
    return null;
  }

  /**
   * Ouvre un écran ; si un onglet équivalent existe déjà, l'active.
   * `newInstance` (Ctrl+clic) court-circuite le dédoublonnage : une seconde
   * instance indépendante du même écran est créée.
   */
  openTab(request: OpenTabRequest, options?: { readonly newInstance?: boolean }): void {
    if (!options?.newInstance) {
      const key = dedupeKey(request.type, request.entityId);
      for (const group of this.groups()) {
        const existing = group.tabs.find((t) => dedupeKey(t.type, t.entityId) === key);
        if (existing) {
          this.activateTab(existing.id);
          return;
        }
      }
    }
    const tab = createTab(request);
    const active = this.activeGroup();
    if (!active) {
      const group = createGroup([tab], tab.id);
      this.layoutSignal.set(groupLeaf(group));
      this.activeGroupIdSignal.set(group.id);
      return;
    }
    this.layoutSignal.update((layout) =>
      mapGroups(layout, (g) =>
        g.id === active.id ? { ...g, tabs: [...g.tabs, tab], activeTabId: tab.id } : g
      )
    );
    this.activeGroupIdSignal.set(active.id);
  }

  activateTab(tabId: string): void {
    const owner = this.groups().find((g) => g.tabs.some((t) => t.id === tabId));
    if (!owner) {
      return;
    }
    this.layoutSignal.update((layout) =>
      mapGroups(layout, (g) =>
        g.id === owner.id && g.activeTabId !== tabId ? { ...g, activeTabId: tabId } : g
      )
    );
    this.activeGroupIdSignal.set(owner.id);
  }

  setActiveGroup(groupId: string): void {
    if (this.groups().some((g) => g.id === groupId)) {
      this.activeGroupIdSignal.set(groupId);
    }
  }

  /**
   * Ferme un onglet (respecte `closable`).
   * NOTE : accueillera plus tard une garde asynchrone pour les onglets dirty.
   */
  closeTab(tabId: string): void {
    const tab = this.findTab(tabId);
    if (!tab || !tab.closable) {
      return;
    }
    this.removeTab(tabId);
  }

  /** Retire un onglet sans condition (fin de détachement, déconnexion…). */
  forceRemoveTab(tabId: string): void {
    this.removeTab(tabId);
  }

  moveTab(groupId: string, fromIndex: number, toIndex: number): void {
    this.layoutSignal.update((layout) =>
      mapGroups(layout, (group) => {
        if (group.id !== groupId || group.tabs.length === 0) {
          return group;
        }
        const from = clamp(fromIndex, 0, group.tabs.length - 1);
        const to = clamp(toIndex, 0, group.tabs.length - 1);
        if (from === to) {
          return group;
        }
        const tabs = [...group.tabs];
        const [moved] = tabs.splice(from, 1);
        tabs.splice(to, 0, moved);
        return { ...group, tabs };
      })
    );
  }

  /** Déplace un onglet vers un autre groupe ; le focus suit le drop. */
  transferTab(
    sourceGroupId: string,
    targetGroupId: string,
    tabId: string,
    targetIndex: number
  ): void {
    if (sourceGroupId === targetGroupId) {
      const group = this.groups().find((g) => g.id === sourceGroupId);
      const fromIndex = group?.tabs.findIndex((t) => t.id === tabId) ?? -1;
      if (fromIndex >= 0) {
        this.moveTab(sourceGroupId, fromIndex, targetIndex);
      }
      return;
    }
    const groups = this.groups();
    const source = groups.find((g) => g.id === sourceGroupId);
    const target = groups.find((g) => g.id === targetGroupId);
    const tab = source?.tabs.find((t) => t.id === tabId);
    if (!source || !target || !tab) {
      return;
    }

    const sourceIndex = source.tabs.findIndex((t) => t.id === tabId);
    const sourceTabs = source.tabs.filter((t) => t.id !== tabId);
    const sourceActiveTabId =
      source.activeTabId === tabId
        ? (sourceTabs[Math.min(sourceIndex, sourceTabs.length - 1)]?.id ?? null)
        : source.activeTabId;

    const insertAt = clamp(targetIndex, 0, target.tabs.length);
    const targetTabs = [...target.tabs];
    targetTabs.splice(insertAt, 0, tab);

    let layout = mapGroups(this.layoutSignal(), (g) => {
      if (g.id === source.id) {
        return { ...g, tabs: sourceTabs, activeTabId: sourceActiveTabId };
      }
      if (g.id === target.id) {
        return { ...g, tabs: targetTabs, activeTabId: tabId };
      }
      return g;
    });
    // Groupe source vidé -> retiré de l'arbre, son frère est promu.
    if (sourceTabs.length === 0) {
      layout = removeGroup(layout, source.id) ?? layout;
    }
    this.layoutSignal.set(layout);
    this.activeGroupIdSignal.set(target.id);
  }

  /**
   * Divise le groupe actif : sa feuille est remplacée par un nœud split
   * (à parts égales) dont le second enfant est un nouveau groupe contenant
   * un duplicata de l'onglet actif (nouvel id, `dirty` réinitialisé).
   */
  splitActiveGroup(direction: SplitDirection = 'horizontal'): void {
    const group = this.activeGroup();
    const tab = this.activeTab();
    if (!group || !tab) {
      return;
    }
    const copy: WorkspaceTab = { ...tab, id: `tab-${crypto.randomUUID()}`, dirty: false };
    const newGroup = createGroup([copy], copy.id);
    this.layoutSignal.update((layout) =>
      splitGroup(layout, group.id, direction, groupLeaf(newGroup), `split-${crypto.randomUUID()}`)
    );
    this.activeGroupIdSignal.set(newGroup.id);
  }

  /**
   * Dock un onglet sur un groupe (drag-and-drop façon Visual Studio) :
   * `center` l'ajoute comme onglet du groupe cible ; un bord retire l'onglet
   * de son groupe source (élagué s'il se vide) puis divise la cible dans la
   * direction correspondante, le nouveau groupe étant placé du côté choisi.
   */
  dockTab(tabId: string, targetGroupId: string, zone: DockZone): void {
    const groups = this.groups();
    const source = groups.find((g) => g.tabs.some((t) => t.id === tabId));
    const target = groups.find((g) => g.id === targetGroupId);
    const tab = source?.tabs.find((t) => t.id === tabId);
    if (!source || !target || !tab) {
      return;
    }

    if (zone === 'center') {
      // Centre sur son propre groupe : l'onglet reste où il est (comme
      // VS Code) — sans ce garde, transferTab le déplacerait en fin de bande.
      if (source.id === target.id) {
        return;
      }
      this.transferTab(source.id, target.id, tabId, target.tabs.length);
      return;
    }

    // Diviser un groupe avec son propre unique onglet ne changerait rien.
    if (source.id === target.id && source.tabs.length === 1) {
      return;
    }

    const direction: SplitDirection =
      zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
    const newLeafFirst = zone === 'left' || zone === 'top';

    const sourceIndex = source.tabs.findIndex((t) => t.id === tabId);
    const sourceTabs = source.tabs.filter((t) => t.id !== tabId);
    const sourceActiveTabId =
      source.activeTabId === tabId
        ? (sourceTabs[Math.min(sourceIndex, sourceTabs.length - 1)]?.id ?? null)
        : source.activeTabId;

    let layout = mapGroups(this.layoutSignal(), (g) =>
      g.id === source.id ? { ...g, tabs: sourceTabs, activeTabId: sourceActiveTabId } : g
    );
    if (sourceTabs.length === 0) {
      layout = removeGroup(layout, source.id) ?? layout;
    }
    const newGroup = createGroup([tab], tab.id);
    layout = splitGroup(
      layout,
      target.id,
      direction,
      groupLeaf(newGroup),
      `split-${crypto.randomUUID()}`,
      newLeafFirst
    );
    this.layoutSignal.set(layout);
    this.activeGroupIdSignal.set(newGroup.id);
  }

  /** Ajuste le ratio d'un nœud split (poignée de redimensionnement). */
  resizeSplit(splitId: string, ratio: number): void {
    if (!Number.isFinite(ratio)) {
      return;
    }
    const clamped = clamp(ratio, 0.1, 0.9);
    this.layoutSignal.update((layout) => setSplitRatio(layout, splitId, clamped));
  }

  activateNextTab(): void {
    this.cycleTab(1);
  }

  activatePreviousTab(): void {
    this.cycleTab(-1);
  }

  focusNextGroup(): void {
    const groups = this.groups();
    if (groups.length < 2) {
      return;
    }
    const index = groups.findIndex((g) => g.id === this.activeGroupId());
    const next = groups[(index + 1 + groups.length) % groups.length];
    this.activeGroupIdSignal.set(next.id);
  }

  /** Alternative clavier au drag-and-drop inter-groupes. */
  moveActiveTabToNextGroup(): void {
    const groups = this.groups();
    if (groups.length < 2) {
      return;
    }
    const group = this.activeGroup();
    const tab = this.activeTab();
    if (!group || !tab) {
      return;
    }
    const index = groups.findIndex((g) => g.id === group.id);
    const target = groups[(index + 1) % groups.length];
    this.transferTab(group.id, target.id, tab.id, target.tabs.length);
  }

  setDirty(tabId: string, dirty: boolean): void {
    this.layoutSignal.update((layout) =>
      mapGroups(layout, (g) =>
        g.tabs.some((t) => t.id === tabId)
          ? { ...g, tabs: g.tabs.map((t) => (t.id === tabId ? { ...t, dirty } : t)) }
          : g
      )
    );
  }

  /** Verrou anti double-détachement ; l'UI grise l'onglet en attente. */
  markDetachPending(tabId: string): void {
    this.pendingDetachIdsSignal.update((set) => {
      const next = new Set(set);
      next.add(tabId);
      return next;
    });
  }

  unmarkDetachPending(tabId: string): void {
    this.pendingDetachIdsSignal.update((set) => {
      const next = new Set(set);
      next.delete(tabId);
      return next;
    });
  }

  isDetachPending(tabId: string): boolean {
    return this.pendingDetachIdsSignal().has(tabId);
  }

  private cycleTab(offset: number): void {
    const group = this.activeGroup();
    if (!group || group.tabs.length < 2) {
      return;
    }
    const index = group.tabs.findIndex((t) => t.id === group.activeTabId);
    const next = group.tabs[(index + offset + group.tabs.length) % group.tabs.length];
    this.activateTab(next.id);
  }

  /**
   * Retrait d'un onglet : active le voisin de droite (sinon de gauche).
   * Un groupe vidé est retiré de l'arbre — son frère occupe alors tout
   * l'espace du split disparu — sauf s'il est le dernier groupe (zone vide).
   */
  private removeTab(tabId: string): void {
    const groups = this.groups();
    const groupIndex = groups.findIndex((g) => g.tabs.some((t) => t.id === tabId));
    if (groupIndex === -1) {
      return;
    }
    const group = groups[groupIndex];
    const tabIndex = group.tabs.findIndex((t) => t.id === tabId);
    const tabs = group.tabs.filter((t) => t.id !== tabId);
    const activeTabId =
      group.activeTabId === tabId
        ? (tabs[Math.min(tabIndex, tabs.length - 1)]?.id ?? null)
        : group.activeTabId;

    if (tabs.length > 0 || groups.length === 1) {
      // Groupe conservé (éventuellement vide s'il est le dernier).
      this.layoutSignal.update((layout) =>
        mapGroups(layout, (g) => (g.id === group.id ? { ...g, tabs, activeTabId } : g))
      );
      return;
    }

    const nextLayout = removeGroup(this.layoutSignal(), group.id);
    if (!nextLayout) {
      return;
    }
    this.layoutSignal.set(nextLayout);
    if (this.activeGroupIdSignal() === group.id) {
      const remaining = collectGroups(nextLayout);
      const neighbor = remaining[Math.min(groupIndex, remaining.length - 1)];
      this.activeGroupIdSignal.set(neighbor.id);
    }
  }
}
