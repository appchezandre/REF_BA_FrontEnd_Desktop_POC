import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UsersPage } from './users-page';
import { UsersScreenRegistry } from '../store/users-screen.registry';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { UserAccessDto, UserDto } from '../data-access/user.dto';

const ALICE: UserDto = {
  id: 1,
  name: 'Alice Martin',
  email: 'alice@test.fr',
  isDeleted: false,
  rowVersion: 'AAAA',
  createdAt: '2026-06-01T08:00:00',
  updatedAt: '2026-07-01T08:00:00'
};

const ALICE_ACCESS: UserAccessDto = {
  userId: 1,
  roles: [],
  directPermissions: [],
  effectivePermissions: []
};

/**
 * Chaîne complète de la pastille « modifications non enregistrées » (parité
 * avec Commandes) : modifier un brouillon doit marquer à la fois l'onglet
 * interne Détail, l'onglet du workspace (via `setDirty`) et la ligne de la
 * table Liste (colonne indicateur).
 */
describe('UsersPage — pastille de modification', () => {
  let http: HttpTestingController;
  let workspace: WorkspaceStore;
  let registry: UsersScreenRegistry;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UsersPage],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    workspace = TestBed.inject(WorkspaceStore);
    registry = TestBed.inject(UsersScreenRegistry);
  });

  afterEach(() => {
    // Pas de http.verify() : les requêtes annexes (accès) peuvent rester en vol.
  });

  it('affiche la pastille sur l’onglet interne, l’onglet du workspace et la ligne de la liste', async () => {
    workspace.openTab({ type: 'user-list', title: 'Utilisateurs' });
    const tab = workspace
      .groups()
      .flatMap((g) => g.tabs)
      .find((t) => t.type === 'user-list')!;
    expect(tab).toBeTruthy();

    const fixture = TestBed.createComponent(UsersPage);
    fixture.componentRef.setInput('tab', tab);
    await fixture.whenStable();

    // Le montage de la page déclenche le chargement de la liste.
    http.expectOne((req) => req.url.endsWith('/api/users')).flush([ALICE]);
    await fixture.whenStable();

    // Ouvre la fiche d'Alice puis passe en édition et modifie le nom.
    const screen = registry.forTab(tab.id);
    screen.openDetail('1');
    await fixture.whenStable();
    // La fiche affichée charge les accès (rôles/permissions).
    http.expectOne((req) => req.url.endsWith('/api/users/1/access')).flush(ALICE_ACCESS);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.screen-tab-dirty')).toBeNull();

    screen.beginEdit('1');
    screen.updateDraft('1', { name: 'Alice Durand' });
    await fixture.whenStable();

    // 1. Pastille sur l'onglet interne Détail.
    expect(el.querySelector('.screen-tab-dirty')).toBeTruthy();
    // 2. Indicateur `dirty` reporté sur l'onglet du workspace (pastille du tab-strip).
    expect(workspace.findTab(tab.id)?.dirty).toBe(true);

    // 3. Pastille sur la ligne correspondante de la table Liste.
    screen.activateList();
    await fixture.whenStable();
    expect(el.querySelector('.row-dirty-dot')).toBeTruthy();

    // L'annulation efface la pastille partout.
    screen.cancelEdit('1');
    await fixture.whenStable();
    expect(el.querySelector('.row-dirty-dot')).toBeNull();
    expect(workspace.findTab(tab.id)?.dirty).toBe(false);
  });
});
