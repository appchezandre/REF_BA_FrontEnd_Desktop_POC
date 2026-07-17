import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { LIST_VIEW, MIN_COLUMN_WIDTH, UsersScreenStore, UsersScreenData } from './users-screen.store';
import { USER_COLUMN_DEFS } from '../models/user-column';
import { User, UserDraft, userKey } from '../models/user';

/** Jeu de données de test (sans HTTP : le store est testé via l'interface
 *  `UsersScreenData`, implémentée en mémoire). */
function makeUser(id: number, overrides: Partial<User> = {}): User {
  return {
    id,
    name: `Utilisateur ${id}`,
    email: `user${id}@test.fr`,
    deleted: false,
    createdAt: `2026-06-${String(id).padStart(2, '0')}T08:00:00`,
    updatedAt: `2026-07-01T08:00:00`,
    rowVersion: 'AAAA',
    ...overrides
  };
}

class FakeUsersData implements UsersScreenData {
  readonly usersSignal = signal<readonly User[]>([
    makeUser(1, { name: 'Alice Martin', email: 'alice@test.fr' }),
    makeUser(2, { name: 'Bruno Diaz', email: 'bruno@acme.fr' }),
    makeUser(3, { name: 'Chloé Bernard', email: 'chloe@acme.fr', deleted: true }),
    makeUser(4, { name: 'David Cohen', email: 'david@test.fr' }),
    makeUser(5, { name: 'Emma Petit', email: 'emma@contoso.fr' })
  ]);
  readonly users = this.usersSignal.asReadonly();

  getUserByKey(key: string): User | undefined {
    return this.usersSignal().find((u) => userKey(u) === key);
  }

  async updateUser(user: User, draft: UserDraft): Promise<User> {
    const updated: User = { ...user, name: draft.name, rowVersion: user.rowVersion + 'X' };
    this.usersSignal.update((users) => users.map((u) => (u.id === user.id ? updated : u)));
    return updated;
  }
}

const K1 = '1';
const K2 = '2';
const K3 = '3';

describe('UsersScreenStore', () => {
  let data: FakeUsersData;
  let store: UsersScreenStore;

  beforeEach(() => {
    data = new FakeUsersData();
    store = new UsersScreenStore(data);
  });

  it('démarre sur la vue Liste sans détail ouvert', () => {
    expect(store.activeView()).toBe(LIST_VIEW);
    expect(store.detailKeys()).toHaveLength(0);
  });

  describe('openDetail', () => {
    it('ouvre un onglet Détail, l’active et initialise le brouillon', () => {
      store.openDetail(K1);
      expect(store.detailKeys()).toEqual([K1]);
      expect(store.activeView()).toBe(K1);
      expect(store.drafts().get(K1)?.name).toBe('Alice Martin');
    });

    it('réactive l’onglet existant sans doublon ni perte de brouillon', () => {
      store.openDetail(K1);
      store.updateDraft(K1, { name: 'Modifié' });
      store.activateList();
      store.openDetail(K1);
      expect(store.detailKeys()).toEqual([K1]);
      expect(store.drafts().get(K1)?.name).toBe('Modifié');
    });

    it('accepte une clé numérique inconnue (données pas encore chargées)', () => {
      store.openDetail('999');
      expect(store.detailKeys()).toEqual(['999']);
      expect(store.activeView()).toBe('999');
      // Pas de brouillon tant que l'utilisateur n'est pas chargé.
      expect(store.drafts().has('999')).toBe(false);
    });

    it('ignore une clé non numérique', () => {
      store.openDetail('abc');
      expect(store.detailKeys()).toHaveLength(0);
      expect(store.activeView()).toBe(LIST_VIEW);
    });
  });

  describe('brouillons et dirty', () => {
    it('marque le détail modifié quand le brouillon diverge', () => {
      store.openDetail(K1);
      expect(store.hasDirty()).toBe(false);
      store.updateDraft(K1, { name: 'Alice Durand' });
      expect(store.dirtyKeys().has(K1)).toBe(true);
    });

    it('un mot de passe saisi rend le brouillon dirty', () => {
      store.openDetail(K1);
      store.updateDraft(K1, { password: 'nouveau' });
      expect(store.dirtyKeys().has(K1)).toBe(true);
    });

    it('saveDraft enregistre via le service et efface le dirty', async () => {
      store.openDetail(K1);
      store.updateDraft(K1, { name: 'Nouveau nom' });
      const error = await store.saveDraft(K1);
      expect(error).toBeNull();
      expect(data.getUserByKey(K1)?.name).toBe('Nouveau nom');
      expect(store.hasDirty()).toBe(false);
    });

    it('saveDraft renvoie un message présentable en cas d’échec API', async () => {
      data.updateUser = async () => {
        throw new Error('réseau');
      };
      store.openDetail(K1);
      store.updateDraft(K1, { name: 'Nouveau nom' });
      const error = await store.saveDraft(K1);
      expect(error).toBe("Échec de l'enregistrement de l'utilisateur.");
      expect(store.dirtyKeys().has(K1)).toBe(true);
    });

    it('resetDraft revient aux valeurs enregistrées', () => {
      store.openDetail(K1);
      store.updateDraft(K1, { name: 'Temporaire' });
      store.resetDraft(K1);
      expect(store.drafts().get(K1)?.name).toBe('Alice Martin');
      expect(store.hasDirty()).toBe(false);
    });

    it('updateDraft ignore un détail non ouvert', () => {
      store.updateDraft(K1, { name: 'X' });
      expect(store.drafts().has(K1)).toBe(false);
    });
  });

  describe('closeDetail', () => {
    it('active le voisin de droite, sinon de gauche, sinon la Liste', () => {
      store.openDetail(K1);
      store.openDetail(K2);
      store.openDetail(K3);
      store.activateDetail(K2);
      store.closeDetail(K2);
      expect(store.activeView()).toBe(K3);
      store.closeDetail(K3);
      expect(store.activeView()).toBe(K1);
      store.closeDetail(K1);
      expect(store.activeView()).toBe(LIST_VIEW);
    });

    it('nettoie le brouillon (fermer sans enregistrer abandonne les modifications)', () => {
      store.openDetail(K1);
      store.updateDraft(K1, { name: 'Perdu' });
      store.closeDetail(K1);
      expect(store.drafts().has(K1)).toBe(false);
      expect(store.hasDirty()).toBe(false);
    });
  });

  describe('mode édition (lecture seule par défaut)', () => {
    it('une fiche ouverte n’est pas en édition', () => {
      store.openDetail(K1);
      expect(store.isEditing(K1)).toBe(false);
    });

    it('beginEdit passe en édition avec un brouillon frais', () => {
      store.openDetail(K1);
      store.beginEdit(K1);
      expect(store.isEditing(K1)).toBe(true);
      expect(store.drafts().get(K1)?.name).toBe('Alice Martin');
      expect(store.drafts().get(K1)?.password).toBe('');
    });

    it('beginEdit refuse une fiche dont l’utilisateur n’est pas chargé', () => {
      store.openDetail('999');
      store.beginEdit('999');
      expect(store.isEditing('999')).toBe(false);
    });

    it('cancelEdit rétablit les valeurs et repasse en lecture seule', () => {
      store.openDetail(K1);
      store.beginEdit(K1);
      store.updateDraft(K1, { name: 'Abandonné' });
      store.cancelEdit(K1);
      expect(store.isEditing(K1)).toBe(false);
      expect(store.drafts().get(K1)?.name).toBe('Alice Martin');
      expect(store.hasDirty()).toBe(false);
    });
  });

  describe('snapshot / hydrate (détachement)', () => {
    it('restitue à l’identique l’état d’écran dans une nouvelle instance', () => {
      store.openDetail(K1);
      store.openDetail(K2);
      store.beginEdit(K2);
      store.updateDraft(K2, { name: 'En cours' });
      store.setSearchStatus('active');
      store.activateDetail(K1);

      const restored = new UsersScreenStore(data);
      restored.hydrate(store.snapshot());

      expect(restored.detailKeys()).toEqual([K1, K2]);
      expect(restored.activeView()).toBe(K1);
      expect(restored.isEditing(K2)).toBe(true);
      expect(restored.drafts().get(K2)?.name).toBe('En cours');
      expect(restored.dirtyKeys().has(K2)).toBe(true);
      expect(restored.searchStatus()).toBe('active');
    });

    it('le snapshot ne contient que des données simples (sérialisable)', () => {
      store.openDetail(K1);
      expect(() => structuredClone(store.snapshot())).not.toThrow();
    });

    it('conserve une clé numérique non chargée mais écarte les clés invalides', () => {
      const restored = new UsersScreenStore(data);
      restored.hydrate({
        details: [K1, '999', 'abc', 42],
        activeView: '999',
        drafts: [[K1, { name: 'X', password: '' }]],
        editing: ['abc'],
        search: { status: 'statut-bidon' }
      });
      // '999' est conservée (les données arrivent de l'API après coup).
      expect(restored.detailKeys()).toEqual([K1, '999']);
      expect(restored.activeView()).toBe('999');
      expect(restored.isEditing(K1)).toBe(false);
      expect(restored.searchStatus()).toBe('all');
    });

    it('hydrate de manière inoffensive un instantané non-objet', () => {
      const restored = new UsersScreenStore(data);
      expect(() => restored.hydrate('n’importe quoi')).not.toThrow();
      expect(restored.detailKeys()).toEqual([]);
    });

    it('complète les brouillons manquants depuis l’utilisateur chargé', () => {
      const restored = new UsersScreenStore(data);
      restored.hydrate({ details: [K1], activeView: K1 });
      expect(restored.drafts().get(K1)?.name).toBe('Alice Martin');
    });
  });

  describe('recherche', () => {
    it('sans critère, renvoie tous les utilisateurs', () => {
      expect(store.hasActiveSearch()).toBe(false);
      expect(store.filteredUsers().length).toBe(data.users().length);
    });

    it('filtre par e-mail (sous-chaîne, insensible à la casse)', () => {
      store.setSearchEmail('ACME');
      expect(store.filteredUsers().map((u) => u.id)).toEqual([2, 3]);
      expect(store.hasActiveSearch()).toBe(true);
    });

    it('filtre par statut', () => {
      store.setSearchStatus('deleted');
      const result = store.filteredUsers();
      expect(result.length).toBe(1);
      expect(result.every((u) => u.deleted)).toBe(true);
    });

    it('recherche texte sur tous les champs (nom)', () => {
      store.setSearchText('alice');
      expect(store.filteredUsers().map((u) => u.id)).toEqual([1]);
    });

    it('combine les critères en ET', () => {
      store.setSearchText('acme');
      store.setSearchStatus('active');
      expect(store.filteredUsers().map((u) => u.id)).toEqual([2]);
    });

    it('filtre par borne de dates de création (incluses)', () => {
      store.setCreatedFrom('2026-06-02');
      store.setCreatedTo('2026-06-04');
      expect(store.filteredUsers().map((u) => u.id)).toEqual([2, 3, 4]);
    });

    it('clearSearch réinitialise tous les critères', () => {
      store.setSearchText('x');
      store.setSearchEmail('y');
      store.setSearchStatus('deleted');
      store.setCreatedFrom('2026-06-02');
      store.clearSearch();
      expect(store.hasActiveSearch()).toBe(false);
      expect(store.filteredUsers().length).toBe(data.users().length);
    });

    it('les critères sont propres à l’instance', () => {
      const other = new UsersScreenStore(data);
      store.setSearchStatus('deleted');
      expect(other.hasActiveSearch()).toBe(false);
      expect(other.filteredUsers().length).toBe(data.users().length);
    });
  });

  describe('tri (multi-colonnes)', () => {
    it('setSort trie par nom croissant puis décroissant', () => {
      store.setSort('name', 'asc');
      const asc = store.sortedUsers().map((u) => u.name);
      expect([...asc].sort((a, b) => a.localeCompare(b, 'fr'))).toEqual(asc);

      store.setSort('name', 'desc');
      const desc = store.sortedUsers().map((u) => u.name);
      expect([...desc].sort((a, b) => b.localeCompare(a, 'fr'))).toEqual(desc);
    });

    it('trie par date de création chronologiquement', () => {
      store.setSort('createdAt', 'asc');
      const dates = store.sortedUsers().map((u) => u.createdAt);
      expect([...dates].sort()).toEqual(dates);
    });

    it('addSort ajoute des colonnes et départage par priorité (statut puis id)', () => {
      store.addSort('status', 'asc');
      store.addSort('id', 'desc');
      expect(store.sortCriteria()).toEqual([
        { column: 'status', direction: 'asc' },
        { column: 'id', direction: 'desc' }
      ]);
      const rows = store.sortedUsers();
      for (let i = 1; i < rows.length; i++) {
        if (rows[i - 1].deleted === rows[i].deleted) {
          expect(rows[i - 1].id).toBeGreaterThanOrEqual(rows[i].id);
        }
      }
    });

    it('un changement de tri revient à la première page', () => {
      store.setPageSize(2);
      store.nextPage();
      expect(store.pageIndex()).toBe(1);
      store.setSort('id', 'asc');
      expect(store.pageIndex()).toBe(0);
    });
  });

  describe('colonnes (ordre, visibilité, largeurs)', () => {
    it('toutes les colonnes sont visibles par défaut', () => {
      expect(store.visibleColumns().map((c) => c.id)).toEqual([
        'id',
        'name',
        'email',
        'status',
        'createdAt',
        'updatedAt'
      ]);
    });

    it('masque puis réaffiche une colonne', () => {
      store.toggleColumnVisibility('status');
      expect(store.isColumnVisible('status')).toBe(false);
      store.toggleColumnVisibility('status');
      expect(store.isColumnVisible('status')).toBe(true);
    });

    it('refuse de masquer la dernière colonne visible', () => {
      for (const id of ['id', 'name', 'email', 'status', 'createdAt'] as const) {
        store.toggleColumnVisibility(id);
      }
      expect(store.visibleColumns()).toHaveLength(1);
      store.toggleColumnVisibility('updatedAt');
      expect(store.visibleColumns()).toHaveLength(1);
    });

    it('déplace une colonne visible en conservant les masquées ancrées', () => {
      store.toggleColumnVisibility('name');
      store.moveColumn(0, 4);
      expect(store.visibleColumns().map((c) => c.id)).toEqual([
        'email',
        'status',
        'createdAt',
        'updatedAt',
        'id'
      ]);
    });

    it('setColumnWidth borne et arrondit, resetColumnWidth rétablit le défaut', () => {
      store.setColumnWidth('email', 260.7);
      expect(store.columnWidth('email')).toBe(261);
      store.setColumnWidth('email', 10);
      expect(store.columnWidth('email')).toBe(MIN_COLUMN_WIDTH);
      store.resetColumnWidth('email');
      expect(store.columnWidth('email')).toBe(USER_COLUMN_DEFS.email.width);
    });
  });

  describe('pagination', () => {
    it('découpe les résultats selon la taille de page', () => {
      store.setPageSize(2);
      expect(store.pageCount()).toBe(Math.ceil(data.users().length / 2));
      expect(store.pagedUsers()).toHaveLength(2);
    });

    it('navigue entre les pages et borne l’index', () => {
      store.setPageSize(2);
      store.nextPage();
      expect(store.pageIndex()).toBe(1);
      store.setPage(999);
      expect(store.pageIndex()).toBe(store.pageCount() - 1);
      store.previousPage();
      expect(store.pageIndex()).toBe(store.pageCount() - 2);
    });

    it('« tous » affiche une seule page avec tous les utilisateurs', () => {
      store.setPageSize('all');
      expect(store.pageCount()).toBe(1);
      expect(store.pagedUsers()).toHaveLength(data.users().length);
    });

    it('un changement de filtre revient à la première page', () => {
      store.setPageSize(2);
      store.nextPage();
      expect(store.pageIndex()).toBe(1);
      store.setSearchStatus('active');
      expect(store.pageIndex()).toBe(0);
    });
  });

  describe('snapshot / hydrate de la présentation', () => {
    it('restitue colonnes, largeurs, tri multi-colonnes et pagination à l’identique', () => {
      store.toggleColumnVisibility('status');
      store.moveColumn(0, 2);
      store.setColumnWidth('email', 280);
      store.addSort('id', 'desc');
      store.addSort('name', 'asc');
      store.setPageSize(2);
      store.nextPage();

      const restored = new UsersScreenStore(data);
      restored.hydrate(store.snapshot());

      expect(restored.visibleColumns().map((c) => c.id)).toEqual(
        store.visibleColumns().map((c) => c.id)
      );
      expect(restored.isColumnVisible('status')).toBe(false);
      expect(restored.columnWidth('email')).toBe(280);
      expect(restored.sortCriteria()).toEqual([
        { column: 'id', direction: 'desc' },
        { column: 'name', direction: 'asc' }
      ]);
      expect(restored.pageSize()).toBe(2);
      expect(restored.pageIndex()).toBe(1);
    });

    it('restitue les critères de recherche (e-mail et bornes de dates)', () => {
      store.setSearchEmail('acme');
      store.setCreatedFrom('2026-06-02');
      store.setCreatedTo('2026-06-30');

      const restored = new UsersScreenStore(data);
      restored.hydrate(store.snapshot());

      expect(restored.searchEmail()).toBe('acme');
      expect(restored.createdFrom()).toBe('2026-06-02');
      expect(restored.createdTo()).toBe('2026-06-30');
    });

    it('écarte un ordre de colonnes malformé et complète les manquantes', () => {
      const restored = new UsersScreenStore(data);
      restored.hydrate({
        columns: { order: ['email', 'inconnue', 'email'], hidden: ['xxx'] },
        sort: [{ column: 'inconnue', direction: 'zzz' }]
      });
      expect(restored.allColumns().map((c) => c.id)).toEqual([
        'email',
        'id',
        'name',
        'status',
        'createdAt',
        'updatedAt'
      ]);
      expect(restored.sortCriteria()).toEqual([]);
    });

    it('n’hydrate le tri que sur des colonnes connues, visibles, sans doublon', () => {
      const restored = new UsersScreenStore(data);
      restored.hydrate({
        columns: { hidden: ['status'] },
        sort: [
          { column: 'id', direction: 'asc' },
          { column: 'inconnue', direction: 'desc' },
          { column: 'status', direction: 'asc' },
          { column: 'id', direction: 'desc' },
          { column: 'name', direction: 'oops' }
        ]
      });
      expect(restored.sortCriteria()).toEqual([{ column: 'id', direction: 'asc' }]);
    });
  });
});
