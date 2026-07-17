import { describe, it, expect, beforeEach } from 'vitest';
import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OrdersScreenRegistry } from './orders-screen.registry';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { RecentRecordsService } from '../../../core/shell/recent-records.service';

const N1 = 'CMD-2026-0101';
const N2 = 'CMD-2026-0102';

/** Deux onglets « Commandes » (Ctrl+clic) doivent rester indépendants. */
describe('OrdersScreenRegistry', () => {
  let registry: OrdersScreenRegistry;
  let workspace: WorkspaceStore;

  beforeEach(() => {
    registry = TestBed.inject(OrdersScreenRegistry);
    workspace = TestBed.inject(WorkspaceStore);
  });

  function openTwoOrderTabs(): { readonly a: string; readonly b: string } {
    workspace.openTab({ type: 'order-list', title: 'Commandes' });
    workspace.openTab({ type: 'order-list', title: 'Commandes' }, { newInstance: true });
    const tabs = workspace.groups()[0].tabs.filter((t) => t.type === 'order-list');
    return { a: tabs[0].id, b: tabs[1].id };
  }

  it('retourne la même instance pour un même onglet', () => {
    const { a } = openTwoOrderTabs();
    expect(registry.forTab(a)).toBe(registry.forTab(a));
  });

  it('deux onglets ont des instances distinctes et indépendantes', () => {
    const { a, b } = openTwoOrderTabs();
    const screenA = registry.forTab(a);
    const screenB = registry.forTab(b);
    expect(screenA).not.toBe(screenB);

    screenA.openDetail(N1);
    screenB.openDetail(N2);
    expect(screenA.detailNumbers()).toEqual([N1]);
    expect(screenB.detailNumbers()).toEqual([N2]);
    expect(screenA.activeView()).toBe(N1);
    expect(screenB.activeView()).toBe(N2);
  });

  it('rouvre une fiche récente : crée le conteneur Commandes et ouvre le détail', () => {
    const recent = TestBed.inject(RecentRecordsService);
    // L'injection du registre (beforeEach) a enregistré l'ouvreur 'order-list'.
    recent.open({
      key: `order-list::${N1}`,
      title: `Commande ${N1}`,
      icon: 'orders',
      containerType: 'order-list',
      recordId: N1
    });

    const tab = workspace
      .groups()
      .flatMap((g) => g.tabs)
      .find((t) => t.type === 'order-list');
    expect(tab).toBeTruthy();
    // On atterrit directement sur la fiche (vue Détail), pas sur la Liste.
    const screen = registry.forTab(tab!.id);
    expect(screen.detailNumbers()).toContain(N1);
    expect(screen.activeView()).toBe(N1);
  });

  it('hydrate l’état d’un onglet détaché lu depuis un computed (pas de NG0600)', () => {
    // Reproduit une fenêtre détachée : l'onglet transporte un état d'écran et
    // `forTab` est appelé depuis un computed (comme OrdersPage.screen).
    // L'hydratation écrit des signals ; sans isolation `untracked`, Angular
    // lève NG0600 (« Writing to signals is not allowed in a computed »).
    workspace.initializeForContext({
      windowId: 'win-detached',
      mode: 'detached-tab',
      initialTab: {
        id: 'tab-detached',
        type: 'order-list',
        title: 'Commandes',
        state: { details: [N1], activeView: N1, search: { status: 'confirmed' } }
      }
    });

    const screen = computed(() => registry.forTab('tab-detached'));

    expect(() => screen()).not.toThrow();
    expect(screen().detailNumbers()).toEqual([N1]);
    expect(screen().activeView()).toBe(N1);
    expect(screen().searchStatus()).toBe('confirmed');
  });

  it('libère l’instance quand l’onglet du workspace est fermé', () => {
    const { a } = openTwoOrderTabs();
    const screenA = registry.forTab(a);
    screenA.openDetail(N1);
    workspace.closeTab(a);
    TestBed.tick(); // laisse l'effect de nettoyage s'exécuter
    // Une nouvelle demande crée une instance vierge (l'ancienne a été libérée).
    expect(registry.forTab(a)).not.toBe(screenA);
    expect(registry.forTab(a).detailNumbers()).toEqual([]);
  });
});
