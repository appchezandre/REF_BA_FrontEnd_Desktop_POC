/**
 * Modèle sérialisable des onglets et groupes d'éditeurs.
 * Aucune classe Angular ne doit transiter par IPC : uniquement ces données.
 */

export type TabType =
  | 'welcome'
  | 'dashboard'
  | 'customer-list'
  | 'customer-editor'
  | 'order-list'
  | 'order-editor'
  | 'article-list'
  | 'inventory'
  | 'inventory-movements'
  | 'user-list'
  | 'settings'
  | (string & {});

export interface WorkspaceTab {
  readonly id: string;
  readonly type: TabType;
  readonly title: string;
  readonly entityId?: string;
  readonly icon?: string;
  readonly closable: boolean;
  readonly dirty: boolean;
  readonly pinned: boolean;
  readonly detached: boolean;
  readonly windowId?: string;
  readonly state?: Record<string, unknown>;
}

export interface EditorGroup {
  readonly id: string;
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string | null;
}

export type SplitDirection = 'horizontal' | 'vertical';

/** Feuille de l'arbre de layout : un groupe d'onglets. */
export interface GroupLayout {
  readonly kind: 'group';
  readonly group: EditorGroup;
}

/** Nœud de division : chaque branche est elle-même un layout complet. */
export interface SplitLayout {
  readonly kind: 'split';
  readonly id: string;
  /** horizontal : enfants côte à côte ; vertical : enfants empilés. */
  readonly direction: SplitDirection;
  /** Part de l'espace attribuée au premier enfant (0..1). */
  readonly ratio: number;
  readonly first: WorkspaceLayout;
  readonly second: WorkspaceLayout;
}

/** Arbre récursif de la disposition des groupes d'éditeurs. */
export type WorkspaceLayout = GroupLayout | SplitLayout;

/**
 * Zone de dock lors du drag-and-drop d'un onglet sur un groupe :
 * au centre (ajout comme onglet) ou sur un bord (split dans cette direction).
 */
export type DockZone = 'center' | 'left' | 'right' | 'top' | 'bottom';

export interface OpenTabRequest {
  readonly type: TabType;
  readonly title: string;
  readonly entityId?: string;
  readonly icon?: string;
  readonly closable?: boolean;
}

export function createTab(request: OpenTabRequest): WorkspaceTab {
  return {
    id: `tab-${crypto.randomUUID()}`,
    type: request.type,
    title: request.title,
    entityId: request.entityId,
    icon: request.icon,
    closable: request.closable ?? true,
    dirty: false,
    pinned: false,
    detached: false
  };
}
