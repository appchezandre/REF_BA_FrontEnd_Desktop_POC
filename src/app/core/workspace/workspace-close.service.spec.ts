import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { WorkspaceCloseService } from './workspace-close.service';
import { WorkspaceStore } from './workspace-store';

describe('WorkspaceCloseService', () => {
  let guard: WorkspaceCloseService;
  let store: WorkspaceStore;

  beforeEach(() => {
    store = TestBed.inject(WorkspaceStore);
    guard = TestBed.inject(WorkspaceCloseService);
  });

  function openDirtyTab(): string {
    store.openTab({ type: 'order-list', title: 'Commandes' });
    const tab = store.activeTab()!;
    store.setDirty(tab.id, true);
    return tab.id;
  }

  it('ferme immédiatement un onglet non modifié, sans confirmation', () => {
    store.openTab({ type: 'customer-list', title: 'Clients' });
    const tab = store.activeTab()!;
    guard.requestClose(tab.id);
    expect(guard.pendingTab()).toBeNull();
    expect(store.findTab(tab.id)).toBeNull();
  });

  it('demande confirmation pour un onglet modifié sans le fermer', () => {
    const id = openDirtyTab();
    guard.requestClose(id);
    expect(guard.pendingTab()?.id).toBe(id);
    expect(store.findTab(id)).not.toBeNull();
  });

  it('confirmClose ferme l’onglet en attente et efface l’attente', () => {
    const id = openDirtyTab();
    guard.requestClose(id);
    guard.confirmClose();
    expect(store.findTab(id)).toBeNull();
    expect(guard.pendingTab()).toBeNull();
  });

  it('cancelClose conserve l’onglet et efface l’attente', () => {
    const id = openDirtyTab();
    guard.requestClose(id);
    guard.cancelClose();
    expect(store.findTab(id)).not.toBeNull();
    expect(guard.pendingTab()).toBeNull();
  });

  it('ignore un id inconnu sans exception ni attente', () => {
    expect(() => guard.requestClose('id-inexistant')).not.toThrow();
    expect(guard.pendingTab()).toBeNull();
  });
});
