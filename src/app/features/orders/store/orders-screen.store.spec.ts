import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MIN_COLUMN_WIDTH, OrdersScreenStore, LIST_VIEW } from './orders-screen.store';
import { OrdersService } from '../data-access/orders.service';
import { ORDER_COLUMN_DEFS } from '../models/order-column';

const N1 = 'CMD-2026-0101';
const N2 = 'CMD-2026-0102';
const N3 = 'CMD-2026-0103';

describe('OrdersScreenStore', () => {
  let store: OrdersScreenStore;
  let orders: OrdersService;

  beforeEach(() => {
    orders = TestBed.inject(OrdersService);
    store = new OrdersScreenStore(orders);
  });

  it('démarre sur la vue Liste sans détail ouvert', () => {
    expect(store.activeView()).toBe(LIST_VIEW);
    expect(store.detailNumbers()).toHaveLength(0);
  });

  describe('openDetail', () => {
    it('ouvre un onglet Détail, l’active et initialise le brouillon', () => {
      store.openDetail(N1);
      expect(store.detailNumbers()).toEqual([N1]);
      expect(store.activeView()).toBe(N1);
      expect(store.drafts().get(N1)?.customer).toBe('Dupont Matériaux');
    });

    it('réactive l’onglet existant sans doublon ni perte de brouillon', () => {
      store.openDetail(N1);
      store.updateDraft(N1, { customer: 'Modifié' });
      store.activateList();
      store.openDetail(N1);
      expect(store.detailNumbers()).toEqual([N1]);
      expect(store.drafts().get(N1)?.customer).toBe('Modifié');
    });

    it('ignore un n° de commande inconnu', () => {
      store.openDetail('CMD-INCONNUE');
      expect(store.detailNumbers()).toHaveLength(0);
      expect(store.activeView()).toBe(LIST_VIEW);
    });
  });

  describe('brouillons et dirty', () => {
    it('marque le détail modifié quand le brouillon diverge', () => {
      store.openDetail(N1);
      expect(store.hasDirty()).toBe(false);
      store.updateDraft(N1, { notes: 'Urgent' });
      expect(store.dirtyNumbers().has(N1)).toBe(true);
    });

    it('saveDraft enregistre dans le service et efface le dirty', () => {
      store.openDetail(N1);
      store.updateDraft(N1, { customer: 'Nouveau client' });
      store.saveDraft(N1);
      expect(orders.getOrder(N1)?.customer).toBe('Nouveau client');
      expect(store.hasDirty()).toBe(false);
    });

    it('resetDraft revient aux valeurs enregistrées', () => {
      store.openDetail(N1);
      const original = orders.getOrder(N1)!.customer;
      store.updateDraft(N1, { customer: 'Temporaire' });
      store.resetDraft(N1);
      expect(store.drafts().get(N1)?.customer).toBe(original);
      expect(store.hasDirty()).toBe(false);
    });

    it('updateDraft ignore un détail non ouvert', () => {
      store.updateDraft(N1, { customer: 'X' });
      expect(store.drafts().has(N1)).toBe(false);
    });
  });

  describe('closeDetail', () => {
    it('active le voisin de droite, sinon de gauche, sinon la Liste', () => {
      store.openDetail(N1);
      store.openDetail(N2);
      store.openDetail(N3);
      store.activateDetail(N2);
      store.closeDetail(N2);
      expect(store.activeView()).toBe(N3);
      store.closeDetail(N3);
      expect(store.activeView()).toBe(N1);
      store.closeDetail(N1);
      expect(store.activeView()).toBe(LIST_VIEW);
    });

    it('nettoie le brouillon (fermer sans enregistrer abandonne les modifications)', () => {
      store.openDetail(N1);
      store.updateDraft(N1, { customer: 'Perdu' });
      store.closeDetail(N1);
      expect(store.drafts().has(N1)).toBe(false);
      expect(store.hasDirty()).toBe(false);
    });

    it('ne change pas la vue active quand un détail inactif est fermé', () => {
      store.openDetail(N1);
      store.openDetail(N2);
      store.closeDetail(N1);
      expect(store.activeView()).toBe(N2);
    });
  });

  it('activateDetail ignore un n° non ouvert', () => {
    store.activateDetail(N1);
    expect(store.activeView()).toBe(LIST_VIEW);
  });

  describe('mode édition (lecture seule par défaut)', () => {
    it('une fiche ouverte n’est pas en édition', () => {
      store.openDetail(N1);
      expect(store.isEditing(N1)).toBe(false);
    });

    it('beginEdit passe en édition avec un brouillon frais', () => {
      store.openDetail(N1);
      store.beginEdit(N1);
      expect(store.isEditing(N1)).toBe(true);
      expect(store.drafts().get(N1)?.customer).toBe(orders.getOrder(N1)!.customer);
    });

    it('saveDraft enregistre puis repasse en lecture seule', () => {
      store.openDetail(N1);
      store.beginEdit(N1);
      store.updateDraft(N1, { customer: 'Nouveau' });
      store.saveDraft(N1);
      expect(orders.getOrder(N1)?.customer).toBe('Nouveau');
      expect(store.isEditing(N1)).toBe(false);
      expect(store.hasDirty()).toBe(false);
    });

    it('cancelEdit rétablit les valeurs et repasse en lecture seule', () => {
      store.openDetail(N1);
      const original = orders.getOrder(N1)!.customer;
      store.beginEdit(N1);
      store.updateDraft(N1, { customer: 'Abandonné' });
      store.cancelEdit(N1);
      expect(store.isEditing(N1)).toBe(false);
      expect(store.drafts().get(N1)?.customer).toBe(original);
      expect(store.hasDirty()).toBe(false);
    });

    it('closeDetail nettoie aussi le mode édition', () => {
      store.openDetail(N1);
      store.beginEdit(N1);
      store.closeDetail(N1);
      expect(store.isEditing(N1)).toBe(false);
    });

    it('le mode édition est propre à chaque fiche', () => {
      store.openDetail(N1);
      store.openDetail(N2);
      store.beginEdit(N1);
      expect(store.isEditing(N1)).toBe(true);
      expect(store.isEditing(N2)).toBe(false);
    });
  });

  describe('snapshot / hydrate (détachement)', () => {
    it('restitue à l’identique l’état d’écran dans une nouvelle instance', () => {
      store.openDetail(N1);
      store.openDetail(N2);
      store.beginEdit(N2);
      store.updateDraft(N2, { customer: 'En cours' });
      store.setSearchStatus('confirmed');
      store.activateDetail(N1);

      const restored = new OrdersScreenStore(orders);
      restored.hydrate(store.snapshot());

      expect(restored.detailNumbers()).toEqual([N1, N2]);
      expect(restored.activeView()).toBe(N1);
      expect(restored.isEditing(N2)).toBe(true);
      expect(restored.drafts().get(N2)?.customer).toBe('En cours');
      expect(restored.dirtyNumbers().has(N2)).toBe(true);
      expect(restored.searchStatus()).toBe('confirmed');
    });

    it('le snapshot ne contient que des données simples (sérialisable)', () => {
      store.openDetail(N1);
      expect(() => structuredClone(store.snapshot())).not.toThrow();
    });

    it('écarte les détails inconnus et un instantané malformé', () => {
      const restored = new OrdersScreenStore(orders);
      restored.hydrate({
        details: [N1, 'CMD-INCONNUE', 42],
        activeView: 'CMD-INCONNUE',
        drafts: [[N1, { customer: 'X', date: '2026-01-01', status: 'draft', notes: '' }]],
        editing: ['CMD-INCONNUE'],
        search: { status: 'statut-bidon' }
      });
      expect(restored.detailNumbers()).toEqual([N1]);
      // activeView pointait un détail écarté -> retombe sur la Liste.
      expect(restored.activeView()).toBe(LIST_VIEW);
      expect(restored.isEditing(N1)).toBe(false);
      expect(restored.searchStatus()).toBe('all');
    });

    it('hydrate de manière inoffensive un instantané non-objet', () => {
      const restored = new OrdersScreenStore(orders);
      expect(() => restored.hydrate('n’importe quoi')).not.toThrow();
      expect(restored.detailNumbers()).toEqual([]);
    });

    it('complète les brouillons manquants depuis la commande enregistrée', () => {
      const restored = new OrdersScreenStore(orders);
      restored.hydrate({ details: [N1], activeView: N1 });
      expect(restored.drafts().get(N1)?.customer).toBe(orders.getOrder(N1)!.customer);
    });
  });

  describe('recherche', () => {
    it('sans critère, renvoie toutes les commandes', () => {
      expect(store.hasActiveSearch()).toBe(false);
      expect(store.filteredOrders().length).toBe(orders.orders().length);
    });

    it('filtre par n° de commande (sous-chaîne, insensible à la casse)', () => {
      store.setSearchNumber('0102');
      expect(store.filteredOrders().map((o) => o.orderNumber)).toEqual([N2]);
      expect(store.hasActiveSearch()).toBe(true);
    });

    it('filtre par statut', () => {
      store.setSearchStatus('cancelled');
      const result = store.filteredOrders();
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((o) => o.status === 'cancelled')).toBe(true);
    });

    it('recherche texte sur tous les champs (client)', () => {
      store.setSearchText('acme');
      expect(store.filteredOrders().every((o) => /acme/i.test(o.customer))).toBe(true);
      expect(store.filteredOrders().length).toBeGreaterThan(0);
    });

    it('combine les critères en ET', () => {
      store.setSearchText('acme');
      store.setSearchStatus('invoiced');
      const result = store.filteredOrders();
      expect(result.every((o) => /acme/i.test(o.customer) && o.status === 'invoiced')).toBe(true);
    });

    it('clearSearch réinitialise tous les critères', () => {
      store.setSearchText('x');
      store.setSearchNumber('y');
      store.setSearchStatus('draft');
      store.clearSearch();
      expect(store.hasActiveSearch()).toBe(false);
      expect(store.filteredOrders().length).toBe(orders.orders().length);
    });

    it('les critères sont propres à l’instance', () => {
      const other = new OrdersScreenStore(orders);
      store.setSearchStatus('cancelled');
      expect(other.hasActiveSearch()).toBe(false);
      expect(other.filteredOrders().length).toBe(orders.orders().length);
    });
  });

  describe('filtre par borne de dates', () => {
    it('filtre sur la borne basse (incluse)', () => {
      store.setDateFrom('2026-06-05');
      expect(store.filteredOrders().every((o) => o.date >= '2026-06-05')).toBe(true);
      expect(store.filteredOrders().length).toBeGreaterThan(0);
      expect(store.hasActiveSearch()).toBe(true);
    });

    it('filtre sur la borne haute (incluse)', () => {
      store.setDateTo('2026-05-20');
      expect(store.filteredOrders().every((o) => o.date <= '2026-05-20')).toBe(true);
    });

    it('combine les deux bornes', () => {
      store.setDateFrom('2026-05-15');
      store.setDateTo('2026-06-05');
      expect(
        store.filteredOrders().every((o) => o.date >= '2026-05-15' && o.date <= '2026-06-05')
      ).toBe(true);
    });
  });

  describe('filtre par borne de montant (Total HT)', () => {
    it('filtre sur le minimum (inclus)', () => {
      store.setAmountMin(8000);
      expect(store.filteredOrders().every((o) => o.total >= 8000)).toBe(true);
      expect(store.hasActiveSearch()).toBe(true);
    });

    it('filtre sur le maximum (inclus)', () => {
      store.setAmountMax(2000);
      expect(store.filteredOrders().every((o) => o.total <= 2000)).toBe(true);
    });

    it('null enlève la borne', () => {
      store.setAmountMin(8000);
      store.setAmountMin(null);
      expect(store.filteredOrders().length).toBe(orders.orders().length);
    });
  });

  describe('tri (multi-colonnes)', () => {
    it('setSort trie par total croissant puis décroissant', () => {
      store.setSort('total', 'asc');
      const asc = store.sortedOrders().map((o) => o.total);
      expect([...asc].sort((a, b) => a - b)).toEqual(asc);
      expect(store.sortDirectionFor('total')).toBe('asc');

      store.setSort('total', 'desc');
      expect(store.sortDirectionFor('total')).toBe('desc');
      const desc = store.sortedOrders().map((o) => o.total);
      expect([...desc].sort((a, b) => b - a)).toEqual(desc);
    });

    it('trie par date chronologiquement', () => {
      store.setSort('date', 'asc');
      const dates = store.sortedOrders().map((o) => o.date);
      expect([...dates].sort()).toEqual(dates);
    });

    it('setSort remplace tout le tri par une seule colonne', () => {
      store.setSort('total', 'desc');
      store.setSort('customer', 'asc');
      expect(store.sortCriteria()).toEqual([{ column: 'customer', direction: 'asc' }]);
      expect(store.sortRankFor('customer')).toBe(1);
      expect(store.sortRankFor('total')).toBeNull();
    });

    it('addSort ajoute des colonnes et départage par priorité (statut puis total)', () => {
      store.addSort('status', 'asc');
      store.addSort('total', 'desc');
      expect(store.sortCriteria()).toEqual([
        { column: 'status', direction: 'asc' },
        { column: 'total', direction: 'desc' }
      ]);
      expect(store.sortRankFor('status')).toBe(1);
      expect(store.sortRankFor('total')).toBe(2);

      // À statut égal, le total décroissant départage.
      const rows = store.sortedOrders();
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const curr = rows[i];
        if (prev.status === curr.status) {
          expect(prev.total).toBeGreaterThanOrEqual(curr.total);
        }
      }
    });

    it('addSort met à jour le sens d’une colonne déjà présente sans changer sa priorité', () => {
      store.addSort('status', 'asc');
      store.addSort('total', 'asc');
      store.addSort('status', 'desc'); // même colonne : sens mis à jour, rang conservé
      expect(store.sortCriteria()).toEqual([
        { column: 'status', direction: 'desc' },
        { column: 'total', direction: 'asc' }
      ]);
      expect(store.sortRankFor('status')).toBe(1);
    });

    it('removeSort retire une colonne, clearSort efface tout', () => {
      store.addSort('status', 'asc');
      store.addSort('total', 'desc');
      store.removeSort('status');
      expect(store.sortCriteria()).toEqual([{ column: 'total', direction: 'desc' }]);
      store.clearSort();
      expect(store.sortCriteria()).toEqual([]);
    });

    it('un changement de tri revient à la première page', () => {
      store.setPageSize(3);
      store.nextPage();
      expect(store.pageIndex()).toBe(1);
      store.setSort('total', 'asc');
      expect(store.pageIndex()).toBe(0);
    });

    it('sans tri, conserve l’ordre filtré', () => {
      expect(store.sortCriteria()).toEqual([]);
      expect(store.sortedOrders()).toEqual(store.filteredOrders());
    });
  });

  describe('colonnes (ordre et visibilité)', () => {
    it('toutes les colonnes sont visibles par défaut', () => {
      expect(store.visibleColumns().map((c) => c.id)).toEqual([
        'orderNumber',
        'date',
        'customer',
        'status',
        'total'
      ]);
    });

    it('masque puis réaffiche une colonne', () => {
      store.toggleColumnVisibility('status');
      expect(store.isColumnVisible('status')).toBe(false);
      expect(store.visibleColumns().some((c) => c.id === 'status')).toBe(false);
      store.toggleColumnVisibility('status');
      expect(store.isColumnVisible('status')).toBe(true);
    });

    it('refuse de masquer la dernière colonne visible', () => {
      for (const id of ['orderNumber', 'date', 'customer', 'status'] as const) {
        store.toggleColumnVisibility(id);
      }
      expect(store.visibleColumns()).toHaveLength(1);
      store.toggleColumnVisibility('total');
      expect(store.visibleColumns()).toHaveLength(1);
    });

    it('retire du tri une colonne masquée (sans toucher les autres critères)', () => {
      store.addSort('status', 'asc');
      store.addSort('total', 'desc');
      store.toggleColumnVisibility('status');
      expect(store.sortDirectionFor('status')).toBeNull();
      expect(store.sortCriteria()).toEqual([{ column: 'total', direction: 'desc' }]);
    });

    it('déplace une colonne visible en conservant les masquées ancrées', () => {
      // masque 'date' (index 1) puis déplace la 1re colonne visible en dernier
      store.toggleColumnVisibility('date');
      expect(store.visibleColumns().map((c) => c.id)).toEqual([
        'orderNumber',
        'customer',
        'status',
        'total'
      ]);
      store.moveColumn(0, 3);
      expect(store.visibleColumns().map((c) => c.id)).toEqual([
        'customer',
        'status',
        'total',
        'orderNumber'
      ]);
    });
  });

  describe('largeurs de colonnes', () => {
    it('renvoie la largeur par défaut tant qu’aucun override n’est posé', () => {
      expect(store.columnWidth('customer')).toBe(ORDER_COLUMN_DEFS.customer.width);
    });

    it('setColumnWidth fixe la largeur et arrondit', () => {
      store.setColumnWidth('customer', 260.7);
      expect(store.columnWidth('customer')).toBe(261);
    });

    it('borne la largeur au minimum autorisé', () => {
      store.setColumnWidth('customer', 10);
      expect(store.columnWidth('customer')).toBe(MIN_COLUMN_WIDTH);
    });

    it('ignore une largeur non finie', () => {
      store.setColumnWidth('customer', Number.NaN);
      expect(store.columnWidth('customer')).toBe(ORDER_COLUMN_DEFS.customer.width);
    });

    it('resetColumnWidth revient à la largeur par défaut', () => {
      store.setColumnWidth('customer', 300);
      store.resetColumnWidth('customer');
      expect(store.columnWidth('customer')).toBe(ORDER_COLUMN_DEFS.customer.width);
    });
  });

  describe('pagination', () => {
    it('découpe les résultats selon la taille de page', () => {
      store.setPageSize(3);
      expect(store.pageCount()).toBe(Math.ceil(orders.orders().length / 3));
      expect(store.pagedOrders()).toHaveLength(3);
    });

    it('navigue entre les pages et borne l’index', () => {
      store.setPageSize(3);
      store.nextPage();
      expect(store.pageIndex()).toBe(1);
      store.setPage(999);
      expect(store.pageIndex()).toBe(store.pageCount() - 1);
      store.previousPage();
      expect(store.pageIndex()).toBe(store.pageCount() - 2);
    });

    it('« tous » affiche une seule page avec toutes les commandes', () => {
      store.setPageSize('all');
      expect(store.pageCount()).toBe(1);
      expect(store.pagedOrders()).toHaveLength(orders.orders().length);
    });

    it('un changement de filtre revient à la première page', () => {
      store.setPageSize(3);
      store.nextPage();
      expect(store.pageIndex()).toBe(1);
      store.setSearchStatus('confirmed');
      expect(store.pageIndex()).toBe(0);
    });

    it('la pagination porte sur les résultats triés', () => {
      store.setPageSize(3);
      store.setSort('total', 'asc');
      const firstPageTotals = store.pagedOrders().map((o) => o.total);
      const allSorted = [...store.sortedOrders().map((o) => o.total)];
      expect(firstPageTotals).toEqual(allSorted.slice(0, 3));
    });
  });

  describe('snapshot / hydrate de la présentation', () => {
    it('restitue colonnes, largeurs, tri multi-colonnes et pagination à l’identique', () => {
      store.toggleColumnVisibility('status');
      store.moveColumn(0, 2);
      store.setColumnWidth('customer', 280);
      store.addSort('total', 'desc');
      store.addSort('customer', 'asc');
      store.setPageSize(3);
      store.nextPage();

      const restored = new OrdersScreenStore(orders);
      restored.hydrate(store.snapshot());

      expect(restored.visibleColumns().map((c) => c.id)).toEqual(
        store.visibleColumns().map((c) => c.id)
      );
      expect(restored.isColumnVisible('status')).toBe(false);
      expect(restored.columnWidth('customer')).toBe(280);
      expect(restored.sortCriteria()).toEqual([
        { column: 'total', direction: 'desc' },
        { column: 'customer', direction: 'asc' }
      ]);
      expect(restored.pageSize()).toBe(3);
      expect(restored.pageIndex()).toBe(1);
    });

    it('restitue les bornes de date et de montant', () => {
      store.setDateFrom('2026-05-15');
      store.setDateTo('2026-06-30');
      store.setAmountMin(1000);
      store.setAmountMax(20000);

      const restored = new OrdersScreenStore(orders);
      restored.hydrate(store.snapshot());

      expect(restored.dateFrom()).toBe('2026-05-15');
      expect(restored.dateTo()).toBe('2026-06-30');
      expect(restored.amountMin()).toBe(1000);
      expect(restored.amountMax()).toBe(20000);
    });

    it('écarte un ordre de colonnes malformé et complète les manquantes', () => {
      const restored = new OrdersScreenStore(orders);
      restored.hydrate({
        columns: { order: ['total', 'inconnue', 'total'], hidden: ['xxx'] },
        sort: [{ column: 'inconnue', direction: 'zzz' }]
      });
      // 'total' d'abord, puis les autres dans l'ordre par défaut ; pas de doublon.
      expect(restored.allColumns().map((c) => c.id)).toEqual([
        'total',
        'orderNumber',
        'date',
        'customer',
        'status'
      ]);
      expect(restored.sortCriteria()).toEqual([]);
    });

    it('n’hydrate le tri que sur des colonnes connues, visibles, sans doublon', () => {
      const restored = new OrdersScreenStore(orders);
      restored.hydrate({
        columns: { hidden: ['status'] },
        sort: [
          { column: 'total', direction: 'asc' },
          { column: 'inconnue', direction: 'desc' }, // colonne inconnue -> écartée
          { column: 'status', direction: 'asc' }, // colonne masquée -> écartée
          { column: 'total', direction: 'desc' }, // doublon -> écarté
          { column: 'date', direction: 'oops' } // sens invalide -> écarté
        ]
      });
      expect(restored.sortCriteria()).toEqual([{ column: 'total', direction: 'asc' }]);
    });
  });
});
