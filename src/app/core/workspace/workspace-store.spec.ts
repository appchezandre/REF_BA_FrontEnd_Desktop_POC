import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceStore } from './workspace-store';
import { WindowContext } from '../electron/desktop-api';
import { SplitLayout } from '../../shared/models/workspace';

describe('WorkspaceStore', () => {
  let store: WorkspaceStore;

  beforeEach(() => {
    store = new WorkspaceStore();
  });

  function openThree(): void {
    store.openTab({ type: 'customer-list', title: 'Clients' });
    store.openTab({ type: 'order-list', title: 'Commandes' });
    store.openTab({ type: 'article-list', title: 'Articles' });
  }

  describe('état initial', () => {
    it('démarre avec un groupe contenant l’onglet welcome actif', () => {
      expect(store.groups()).toHaveLength(1);
      expect(store.groups()[0].tabs).toHaveLength(1);
      expect(store.activeTab()?.type).toBe('welcome');
      expect(store.windowMode()).toBe('main');
    });
  });

  describe('hasUnsavedChanges', () => {
    it('est faux sans onglet modifié', () => {
      openThree();
      expect(store.hasUnsavedChanges()).toBe(false);
    });

    it('devient vrai dès qu’un onglet est marqué modifié', () => {
      store.openTab({ type: 'order-list', title: 'Commandes' });
      const id = store.activeTab()!.id;
      store.setDirty(id, true);
      expect(store.hasUnsavedChanges()).toBe(true);
      store.setDirty(id, false);
      expect(store.hasUnsavedChanges()).toBe(false);
    });
  });

  describe('initializeForContext', () => {
    it('conserve l’état par défaut pour un contexte null (navigateur)', () => {
      store.initializeForContext(null);
      expect(store.activeTab()?.type).toBe('welcome');
      expect(store.windowMode()).toBe('main');
    });

    it('monte un groupe unique avec l’onglet transféré en mode détaché', () => {
      const context: WindowContext = {
        windowId: 'win-2',
        mode: 'detached-tab',
        initialTab: {
          id: 'tab-x',
          type: 'customer-editor',
          title: 'Client ACME',
          entityId: 'CUST-001'
        }
      };
      store.initializeForContext(context);
      expect(store.groups()).toHaveLength(1);
      expect(store.groups()[0].tabs).toHaveLength(1);
      const tab = store.activeTab();
      expect(tab?.id).toBe('tab-x');
      expect(tab?.entityId).toBe('CUST-001');
      expect(tab?.detached).toBe(true);
      expect(tab?.windowId).toBe('win-2');
      expect(store.windowMode()).toBe('detached-tab');
    });

    it('retombe sur welcome si initialTab est invalide (donnée IPC hostile)', () => {
      const cases: unknown[] = [
        null,
        'texte',
        {},
        { id: '', type: 'x', title: 'y' },
        { id: 'a', type: 42, title: 'y' },
        { id: 'a', type: 'x' }
      ];
      for (const initialTab of cases) {
        const s = new WorkspaceStore();
        s.initializeForContext({ windowId: 'w', mode: 'detached-tab', initialTab });
        expect(s.activeTab()?.type).toBe('welcome');
      }
    });

    it('est idempotent (second appel ignoré)', () => {
      store.initializeForContext({
        windowId: 'w',
        mode: 'detached-tab',
        initialTab: { id: 't1', type: 'a', title: 'A' }
      });
      store.initializeForContext({
        windowId: 'w',
        mode: 'detached-tab',
        initialTab: { id: 't2', type: 'b', title: 'B' }
      });
      expect(store.activeTab()?.id).toBe('t1');
    });
  });

  describe('openTab', () => {
    it('ajoute l’onglet en fin du groupe actif et l’active', () => {
      store.openTab({ type: 'customer-list', title: 'Clients' });
      const group = store.groups()[0];
      expect(group.tabs).toHaveLength(2);
      expect(group.tabs[1].type).toBe('customer-list');
      expect(store.activeTab()?.type).toBe('customer-list');
    });

    it('déduplique sur type + entityId en réactivant l’existant', () => {
      store.openTab({ type: 'customer-editor', title: 'ACME', entityId: 'C1' });
      store.openTab({ type: 'order-list', title: 'Commandes' });
      store.openTab({ type: 'customer-editor', title: 'ACME', entityId: 'C1' });
      const group = store.groups()[0];
      expect(group.tabs.filter((t) => t.type === 'customer-editor')).toHaveLength(1);
      expect(store.activeTab()?.entityId).toBe('C1');
    });

    it('crée un nouvel onglet pour une entité différente du même type', () => {
      store.openTab({ type: 'customer-editor', title: 'ACME', entityId: 'C1' });
      store.openTab({ type: 'customer-editor', title: 'Contoso', entityId: 'C2' });
      const editors = store.groups()[0].tabs.filter((t) => t.type === 'customer-editor');
      expect(editors).toHaveLength(2);
    });

    it('newInstance ouvre un second onglet du même écran sans dédoublonner (Ctrl+clic)', () => {
      store.openTab({ type: 'order-list', title: 'Commandes' });
      store.openTab({ type: 'order-list', title: 'Commandes' }, { newInstance: true });
      const lists = store.groups()[0].tabs.filter((t) => t.type === 'order-list');
      expect(lists).toHaveLength(2);
      expect(lists[0].id).not.toBe(lists[1].id);
      // La seconde instance devient l'onglet actif.
      expect(store.activeTab()?.id).toBe(lists[1].id);
    });

    it('retrouve un onglet situé dans un autre groupe et y bascule le focus', () => {
      store.openTab({ type: 'customer-list', title: 'Clients' });
      store.splitActiveGroup();
      const secondGroupId = store.activeGroupId();
      store.setActiveGroup(store.groups()[0].id);
      // welcome n'existe que dans le premier groupe ; customer-list dupliqué…
      // on ouvre un type présent uniquement dans le second groupe :
      store.setActiveGroup(secondGroupId!);
      store.openTab({ type: 'order-list', title: 'Commandes' });
      store.setActiveGroup(store.groups()[0].id);
      store.openTab({ type: 'order-list', title: 'Commandes' });
      expect(store.activeGroupId()).toBe(secondGroupId);
      expect(store.activeTab()?.type).toBe('order-list');
    });
  });

  describe('closeTab', () => {
    it('active le voisin de droite quand l’onglet actif du milieu est fermé', () => {
      openThree();
      const group = store.groups()[0];
      const middle = group.tabs[2]; // order-list
      store.activateTab(middle.id);
      store.closeTab(middle.id);
      expect(store.activeTab()?.type).toBe('article-list');
    });

    it('active le voisin de gauche quand le dernier onglet est fermé', () => {
      openThree();
      const tabs = store.groups()[0].tabs;
      store.closeTab(tabs[tabs.length - 1].id); // article-list actif en dernier
      expect(store.activeTab()?.type).toBe('order-list');
    });

    it('ne change pas l’onglet actif quand un onglet inactif est fermé', () => {
      openThree();
      const first = store.groups()[0].tabs[0]; // welcome
      store.closeTab(first.id);
      expect(store.activeTab()?.type).toBe('article-list');
    });

    it('ignore un onglet non fermable', () => {
      const s = new WorkspaceStore();
      s.initializeForContext({
        windowId: 'w',
        mode: 'detached-tab',
        initialTab: { id: 't', type: 'a', title: 'A', closable: false }
      });
      s.closeTab('t');
      expect(s.totalTabCount()).toBe(1);
    });

    it('ignore un id inconnu sans exception', () => {
      expect(() => store.closeTab('inconnu')).not.toThrow();
      expect(store.totalTabCount()).toBe(1);
    });

    it('supprime un groupe vidé et réassigne le groupe actif au voisin', () => {
      store.splitActiveGroup();
      expect(store.groups()).toHaveLength(2);
      const splitGroup = store.activeGroup()!;
      store.closeTab(splitGroup.tabs[0].id);
      expect(store.groups()).toHaveLength(1);
      expect(store.activeGroupId()).toBe(store.groups()[0].id);
    });

    it('conserve le dernier groupe vide quand tous les onglets sont fermés', () => {
      store.closeTab(store.activeTab()!.id);
      expect(store.groups()).toHaveLength(1);
      expect(store.groups()[0].tabs).toHaveLength(0);
      expect(store.activeTab()).toBeNull();
      expect(store.totalTabCount()).toBe(0);
    });
  });

  describe('forceRemoveTab', () => {
    it('retire même un onglet non fermable', () => {
      const s = new WorkspaceStore();
      s.initializeForContext({
        windowId: 'w',
        mode: 'detached-tab',
        initialTab: { id: 't', type: 'a', title: 'A', closable: false }
      });
      s.forceRemoveTab('t');
      expect(s.totalTabCount()).toBe(0);
    });
  });

  describe('moveTab', () => {
    it('réordonne les onglets dans un groupe', () => {
      openThree();
      const group = store.groups()[0];
      store.moveTab(group.id, 0, 2);
      expect(store.groups()[0].tabs.map((t) => t.type)).toEqual([
        'customer-list',
        'order-list',
        'welcome',
        'article-list'
      ]);
    });

    it('clampe les indices hors bornes', () => {
      openThree();
      const group = store.groups()[0];
      store.moveTab(group.id, 99, -5);
      expect(store.groups()[0].tabs[0].type).toBe('article-list');
    });

    it('laisse l’onglet actif actif après déplacement', () => {
      openThree();
      const group = store.groups()[0];
      const active = store.activeTab()!;
      store.moveTab(group.id, 3, 0);
      expect(store.activeTab()?.id).toBe(active.id);
    });

    it('ignore un groupe inconnu', () => {
      expect(() => store.moveTab('inconnu', 0, 1)).not.toThrow();
    });
  });

  describe('transferTab', () => {
    function setupTwoGroups(): { firstId: string; secondId: string } {
      openThree();
      store.splitActiveGroup();
      return { firstId: store.groups()[0].id, secondId: store.groups()[1].id };
    }

    it('insère à l’index cible, active l’onglet et focalise le groupe cible', () => {
      const { firstId, secondId } = setupTwoGroups();
      const moved = store.groups()[0].tabs[1]; // customer-list
      store.transferTab(firstId, secondId, moved.id, 0);
      const target = store.groups()[1];
      expect(target.tabs[0].id).toBe(moved.id);
      expect(target.activeTabId).toBe(moved.id);
      expect(store.activeGroupId()).toBe(secondId);
      expect(store.groups()[0].tabs.some((t) => t.id === moved.id)).toBe(false);
    });

    it('réactive un voisin dans le groupe source', () => {
      const { firstId, secondId } = setupTwoGroups();
      const source = store.groups()[0];
      store.setActiveGroup(firstId);
      store.activateTab(source.tabs[1].id);
      store.transferTab(firstId, secondId, source.tabs[1].id, 0);
      expect(store.groups()[0].activeTabId).toBe(source.tabs[2].id);
    });

    it('supprime le groupe source vidé', () => {
      const { firstId, secondId } = setupTwoGroups();
      const soloTab = store.groups()[1].tabs[0];
      store.transferTab(secondId, firstId, soloTab.id, 0);
      expect(store.groups()).toHaveLength(1);
      expect(store.groups()[0].id).toBe(firstId);
      expect(store.activeGroupId()).toBe(firstId);
    });

    it('délègue à moveTab quand source et cible sont identiques', () => {
      openThree();
      const group = store.groups()[0];
      store.transferTab(group.id, group.id, group.tabs[0].id, 2);
      expect(store.groups()[0].tabs[2].type).toBe('welcome');
    });

    it('ignore des ids inconnus sans exception', () => {
      expect(() => store.transferTab('a', 'b', 'c', 0)).not.toThrow();
    });
  });

  describe('splitActiveGroup', () => {
    it('insère un nouveau groupe juste après l’actif avec un duplicata', () => {
      store.openTab({ type: 'customer-editor', title: 'ACME', entityId: 'C1' });
      const original = store.activeTab()!;
      store.splitActiveGroup();
      expect(store.groups()).toHaveLength(2);
      const copy = store.groups()[1].tabs[0];
      expect(copy.id).not.toBe(original.id);
      expect(copy.type).toBe(original.type);
      expect(copy.entityId).toBe(original.entityId);
      expect(store.activeGroupId()).toBe(store.groups()[1].id);
      expect(store.activeTab()?.id).toBe(copy.id);
    });

    it('ne fait rien sans onglet actif', () => {
      store.closeTab(store.activeTab()!.id);
      store.splitActiveGroup();
      expect(store.groups()).toHaveLength(1);
    });
  });

  describe('activateNextTab / activatePreviousTab', () => {
    it('cycle avec wrap-around dans le groupe actif', () => {
      openThree();
      // actif : article-list (dernier)
      store.activateNextTab();
      expect(store.activeTab()?.type).toBe('welcome');
      store.activatePreviousTab();
      expect(store.activeTab()?.type).toBe('article-list');
    });

    it('ne fait rien avec un seul onglet', () => {
      store.activateNextTab();
      expect(store.activeTab()?.type).toBe('welcome');
    });
  });

  describe('focusNextGroup / moveActiveTabToNextGroup', () => {
    it('cycle le groupe actif', () => {
      store.splitActiveGroup();
      const second = store.activeGroupId();
      store.focusNextGroup();
      expect(store.activeGroupId()).toBe(store.groups()[0].id);
      store.focusNextGroup();
      expect(store.activeGroupId()).toBe(second);
    });

    it('déplace l’onglet actif vers le groupe suivant', () => {
      openThree();
      store.splitActiveGroup();
      store.setActiveGroup(store.groups()[0].id);
      const moved = store.activeTab()!;
      store.moveActiveTabToNextGroup();
      expect(store.groups()[1].tabs.some((t) => t.id === moved.id)).toBe(true);
      expect(store.activeGroupId()).toBe(store.groups()[1].id);
    });
  });

  describe('détachement (verrou)', () => {
    it('marque et démarque un onglet en attente', () => {
      const tab = store.activeTab()!;
      store.markDetachPending(tab.id);
      expect(store.isDetachPending(tab.id)).toBe(true);
      store.markDetachPending(tab.id);
      store.unmarkDetachPending(tab.id);
      expect(store.isDetachPending(tab.id)).toBe(false);
    });
  });

  describe('layout récursif', () => {
    function rootSplit(): SplitLayout {
      const layout = store.layout();
      if (layout.kind !== 'split') {
        throw new Error('nœud split attendu à la racine');
      }
      return layout;
    }

    it('un split horizontal remplace la feuille par un nœud split à parts égales', () => {
      const original = store.activeGroup()!;
      store.splitActiveGroup();
      const split = rootSplit();
      expect(split.direction).toBe('horizontal');
      expect(split.ratio).toBeCloseTo(0.5);
      expect(split.first.kind).toBe('group');
      expect(split.second.kind).toBe('group');
      expect(split.first.kind === 'group' && split.first.group.id).toBe(original.id);
    });

    it('un split vertical crée un nœud de direction vertical', () => {
      store.splitActiveGroup('vertical');
      expect(rootSplit().direction).toBe('vertical');
    });

    it('des splits imbriqués construisent un arbre', () => {
      store.splitActiveGroup('horizontal'); // actif = nouveau groupe (second)
      store.splitActiveGroup('vertical'); // divise le second en profondeur
      const split = rootSplit();
      expect(split.first.kind).toBe('group');
      expect(split.second.kind).toBe('split');
      expect(split.second.kind === 'split' && split.second.direction).toBe('vertical');
      expect(store.groups()).toHaveLength(3);
    });

    it('resizeSplit borne le ratio entre 0.1 et 0.9 et ignore NaN', () => {
      store.splitActiveGroup();
      const splitId = rootSplit().id;
      store.resizeSplit(splitId, 0.7);
      expect(rootSplit().ratio).toBeCloseTo(0.7);
      store.resizeSplit(splitId, 1.5);
      expect(rootSplit().ratio).toBeCloseTo(0.9);
      store.resizeSplit(splitId, -2);
      expect(rootSplit().ratio).toBeCloseTo(0.1);
      store.resizeSplit(splitId, Number.NaN);
      expect(rootSplit().ratio).toBeCloseTo(0.1);
    });

    it('la suppression d’un groupe vidé promeut son frère (pleine surface)', () => {
      store.splitActiveGroup();
      const detached = store.activeTab()!;
      store.forceRemoveTab(detached.id); // même chemin que le détachement
      expect(store.layout().kind).toBe('group');
      expect(store.groups()).toHaveLength(1);
    });

    it('un transfert qui vide le groupe source simplifie l’arbre', () => {
      openThree();
      store.splitActiveGroup();
      const [first, second] = store.groups();
      store.transferTab(second.id, first.id, second.tabs[0].id, 0);
      expect(store.layout().kind).toBe('group');
      expect(store.groups()).toHaveLength(1);
    });

    it('la promotion du frère préserve le reste de l’arbre en profondeur', () => {
      store.splitActiveGroup('horizontal'); // g1 | g2 (actif)
      store.splitActiveGroup('vertical'); // g1 | (g2 / g3 actif)
      const g3Tab = store.activeTab()!;
      store.forceRemoveTab(g3Tab.id); // g3 vidé -> g2 promu
      const layout = store.layout();
      expect(layout.kind).toBe('split');
      expect(layout.kind === 'split' && layout.second.kind).toBe('group');
      expect(store.groups()).toHaveLength(2);
    });
  });

  describe('dockTab', () => {
    function rootSplit(): SplitLayout {
      const layout = store.layout();
      if (layout.kind !== 'split') {
        throw new Error('nœud split attendu à la racine');
      }
      return layout;
    }

    it('center : ajoute l’onglet à la fin du groupe cible', () => {
      openThree();
      store.splitActiveGroup(); // g2 avec le duplicata de article-list
      const [g1, g2] = store.groups();
      const moved = g1.tabs[1]; // customer-list
      store.dockTab(moved.id, g2.id, 'center');
      expect(store.layout().kind).toBe('split');
      const target = store.groups()[1];
      expect(target.tabs[target.tabs.length - 1].id).toBe(moved.id);
      expect(target.activeTabId).toBe(moved.id);
      expect(store.groups()[0].tabs.some((t) => t.id === moved.id)).toBe(false);
    });

    it('right : split horizontal avec le nouveau groupe en second', () => {
      openThree();
      const group = store.groups()[0];
      const moved = store.activeTab()!; // article-list
      store.dockTab(moved.id, group.id, 'right');
      const split = rootSplit();
      expect(split.direction).toBe('horizontal');
      expect(split.second.kind).toBe('group');
      expect(split.second.kind === 'group' && split.second.group.tabs[0].id).toBe(moved.id);
      expect(split.first.kind === 'group' && split.first.group.tabs).toHaveLength(3);
      expect(store.activeTab()?.id).toBe(moved.id);
    });

    it('left : split horizontal avec le nouveau groupe en premier', () => {
      openThree();
      const group = store.groups()[0];
      const moved = store.activeTab()!;
      store.dockTab(moved.id, group.id, 'left');
      const split = rootSplit();
      expect(split.direction).toBe('horizontal');
      expect(split.first.kind === 'group' && split.first.group.tabs[0].id).toBe(moved.id);
    });

    it('top et bottom : split vertical du côté choisi', () => {
      openThree();
      const group = store.groups()[0];
      store.dockTab(store.activeTab()!.id, group.id, 'bottom');
      const split = rootSplit();
      expect(split.direction).toBe('vertical');
      expect(split.second.kind).toBe('group');
    });

    it('no-op pour un split sur son propre groupe à onglet unique', () => {
      const welcome = store.activeTab()!;
      store.dockTab(welcome.id, store.groups()[0].id, 'right');
      expect(store.layout().kind).toBe('group');
    });

    it('élague le groupe source vidé par le dock', () => {
      openThree();
      store.splitActiveGroup(); // g2 : un seul onglet (duplicata)
      const [g1, g2] = store.groups();
      store.dockTab(g2.tabs[0].id, g1.id, 'bottom');
      // g2 supprimé, g1 divisé verticalement : toujours 2 groupes.
      expect(store.groups()).toHaveLength(2);
      const split = rootSplit();
      expect(split.direction).toBe('vertical');
    });

    it('ignore des ids inconnus sans exception', () => {
      expect(() => store.dockTab('x', 'y', 'left')).not.toThrow();
    });
  });

  describe('setDirty', () => {
    it('positionne le drapeau dirty sans toucher aux autres onglets', () => {
      openThree();
      const tab = store.activeTab()!;
      store.setDirty(tab.id, true);
      expect(store.activeTab()?.dirty).toBe(true);
      expect(store.groups()[0].tabs[0].dirty).toBe(false);
    });
  });

  describe('immutabilité', () => {
    it('change la référence du tableau de groupes après mutation', () => {
      const before = store.groups();
      store.openTab({ type: 'customer-list', title: 'Clients' });
      expect(store.groups()).not.toBe(before);
    });

    it('conserve la référence des groupes non touchés', () => {
      openThree();
      store.splitActiveGroup();
      const untouched = store.groups()[0];
      store.setDirty(store.groups()[1].tabs[0].id, true);
      expect(store.groups()[0]).toBe(untouched);
    });
  });
});
