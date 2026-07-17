import { describe, it, expect, beforeEach } from 'vitest';
import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { UsersScreenRegistry } from './users-screen.registry';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { RecentRecordsService } from '../../../core/shell/recent-records.service';

const K1 = '1';
const K2 = '2';

/** Deux onglets « Utilisateurs » (Ctrl+clic) doivent rester indépendants. */
describe('UsersScreenRegistry', () => {
  let registry: UsersScreenRegistry;
  let workspace: WorkspaceStore;

  beforeEach(() => {
    // Le service de données utilise HttpClient (aucune requête n'est émise
    // tant que `ensureLoaded()` n'est pas appelé — pas de backend en test).
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    registry = TestBed.inject(UsersScreenRegistry);
    workspace = TestBed.inject(WorkspaceStore);
  });

  function openTwoUserTabs(): { readonly a: string; readonly b: string } {
    workspace.openTab({ type: 'user-list', title: 'Utilisateurs' });
    workspace.openTab({ type: 'user-list', title: 'Utilisateurs' }, { newInstance: true });
    const tabs = workspace.groups()[0].tabs.filter((t) => t.type === 'user-list');
    return { a: tabs[0].id, b: tabs[1].id };
  }

  it('retourne la même instance pour un même onglet', () => {
    const { a } = openTwoUserTabs();
    expect(registry.forTab(a)).toBe(registry.forTab(a));
  });

  it('deux onglets ont des instances distinctes et indépendantes', () => {
    const { a, b } = openTwoUserTabs();
    const screenA = registry.forTab(a);
    const screenB = registry.forTab(b);
    expect(screenA).not.toBe(screenB);

    screenA.openDetail(K1);
    screenB.openDetail(K2);
    expect(screenA.detailKeys()).toEqual([K1]);
    expect(screenB.detailKeys()).toEqual([K2]);
    expect(screenA.activeView()).toBe(K1);
    expect(screenB.activeView()).toBe(K2);
  });

  it('rouvre une fiche récente : crée le conteneur Utilisateurs et ouvre le détail', () => {
    const recent = TestBed.inject(RecentRecordsService);
    // L'injection du registre (beforeEach) a enregistré l'ouvreur 'user-list'.
    recent.open({
      key: `user-list::${K1}`,
      title: `Utilisateur ${K1}`,
      icon: 'users',
      containerType: 'user-list',
      recordId: K1
    });

    const tab = workspace
      .groups()
      .flatMap((g) => g.tabs)
      .find((t) => t.type === 'user-list');
    expect(tab).toBeTruthy();
    // On atterrit directement sur la fiche (vue Détail), pas sur la Liste.
    const screen = registry.forTab(tab!.id);
    expect(screen.detailKeys()).toContain(K1);
    expect(screen.activeView()).toBe(K1);
  });

  it('hydrate l’état d’un onglet détaché lu depuis un computed (pas de NG0600)', () => {
    // Reproduit une fenêtre détachée : l'onglet transporte un état d'écran et
    // `forTab` est appelé depuis un computed (comme UsersPage.screen).
    // L'hydratation écrit des signals ; sans isolation `untracked`, Angular
    // lève NG0600 (« Writing to signals is not allowed in a computed »).
    workspace.initializeForContext({
      windowId: 'win-detached',
      mode: 'detached-tab',
      initialTab: {
        id: 'tab-detached',
        type: 'user-list',
        title: 'Utilisateurs',
        state: { details: [K1], activeView: K1, search: { status: 'active' } }
      }
    });

    const screen = computed(() => registry.forTab('tab-detached'));

    expect(() => screen()).not.toThrow();
    expect(screen().detailKeys()).toEqual([K1]);
    expect(screen().activeView()).toBe(K1);
    expect(screen().searchStatus()).toBe('active');
  });

  it('libère l’instance quand l’onglet du workspace est fermé', () => {
    const { a } = openTwoUserTabs();
    const screenA = registry.forTab(a);
    screenA.openDetail(K1);
    workspace.closeTab(a);
    TestBed.tick(); // laisse l'effect de nettoyage s'exécuter
    // Une nouvelle demande crée une instance vierge (l'ancienne a été libérée).
    expect(registry.forTab(a)).not.toBe(screenA);
    expect(registry.forTab(a).detailKeys()).toEqual([]);
  });
});
