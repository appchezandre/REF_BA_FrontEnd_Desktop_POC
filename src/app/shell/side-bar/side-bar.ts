import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { RecentRecord, RecentRecordsService } from '../../core/shell/recent-records.service';
import { TabType } from '../../shared/models/workspace';
import { Icon, IconName } from '../../shared/components/icon/icon';
import { OrdersSearch } from '../../features/orders/components/orders-search';
import { UsersSearch } from '../../features/users/components/users-search';
import { ActivityView } from '../activity-bar/activity-bar';

interface SideBarEntry {
  readonly type: TabType;
  readonly title: string;
  readonly entityId?: string;
}

/** Feuille de l'arbre « Modules » : un écran ouvrable, avec son pictogramme. */
interface ModuleLink {
  readonly kind: 'item';
  readonly icon: IconName;
  readonly entry: SideBarEntry;
}

/** Nœud groupe : un pictogramme, un titre et des enfants repliables. */
interface ModuleGroup {
  readonly kind: 'group';
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  readonly children: readonly ModuleLink[];
}

/** Nœud de premier niveau de « Modules » : écran isolé ou groupe. */
type ModuleNode = ModuleLink | ModuleGroup;

/**
 * Panneau latéral : explorateur des modules métier (arbre hiérarchique de
 * démonstration en attendant les features) ou recherche contextuelle à
 * l'onglet actif.
 */
@Component({
  selector: 'app-side-bar',
  imports: [OrdersSearch, UsersSearch, Icon],
  templateUrl: './side-bar.html',
  styleUrl: './side-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SideBar {
  private readonly store = inject(WorkspaceStore);
  private readonly recentRecords = inject(RecentRecordsService);

  readonly view = input.required<ActivityView>();

  /** Onglet qui a le focus : détermine le contenu de la recherche. */
  protected readonly activeTab = this.store.activeTab;

  /** Fiches récentes (vide au démarrage ; alimentée à l'ouverture des fiches). */
  protected readonly records = this.recentRecords.records;

  // Arbre « Modules » : un écran isolé (Tableau de bord) puis des groupes
  // métier, chacun avec ses enfants. Icônes portées par chaque nœud.
  protected readonly modules: readonly ModuleNode[] = [
    { kind: 'item', icon: 'dashboard', entry: { type: 'dashboard', title: 'Tableau de bord' } },
    {
      kind: 'group',
      id: 'ventes',
      title: 'Ventes',
      icon: 'sales',
      children: [
        { kind: 'item', icon: 'customers', entry: { type: 'customer-list', title: 'Clients' } },
        { kind: 'item', icon: 'orders', entry: { type: 'order-list', title: 'Commandes' } }
      ]
    },
    {
      kind: 'group',
      id: 'donnees-base',
      title: 'Données de base',
      icon: 'database',
      children: [
        { kind: 'item', icon: 'product', entry: { type: 'article-list', title: 'Articles' } }
      ]
    },
    {
      kind: 'group',
      id: 'administration',
      title: 'Administration',
      icon: 'users',
      children: [
        { kind: 'item', icon: 'users', entry: { type: 'user-list', title: 'Utilisateurs' } }
      ]
    },
    {
      kind: 'group',
      id: 'stock',
      title: 'Stock',
      icon: 'stock',
      children: [
        { kind: 'item', icon: 'stock-view', entry: { type: 'inventory', title: 'Consultation Stock' } },
        {
          kind: 'item',
          icon: 'movements',
          entry: { type: 'inventory-movements', title: 'Consultation Mouvements' }
        }
      ]
    }
  ];

  // Nœuds repliés (sections d'accordéon ET groupes de l'arbre), par clé stable ;
  // vide = tout déplié. État local au composant : il survit au basculement
  // Explorateur ↔ Rechercher.
  private readonly collapsed = signal<ReadonlySet<string>>(new Set());

  protected isExpanded(key: string): boolean {
    return !this.collapsed().has(key);
  }

  /** Replie/déplie une section ou un groupe par sa clé. */
  protected toggle(key: string): void {
    this.collapsed.update((collapsed) => {
      const next = new Set(collapsed);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  /** Clé de suivi `@for` d'un nœud de l'arbre (id de groupe ou type d'écran). */
  protected nodeKey(node: ModuleNode): string {
    return node.kind === 'group' ? node.id : node.entry.type;
  }

  /** Clic : ouvre ou réactive l'écran ; Ctrl+clic : nouvelle instance. */
  protected open(entry: SideBarEntry, event?: MouseEvent): void {
    const newInstance = event?.ctrlKey === true || event?.metaKey === true;
    this.store.openTab(entry, { newInstance });
  }

  /** Clic sur une fiche récente : la réouvre directement (via son conteneur). */
  protected openRecent(record: RecentRecord): void {
    this.recentRecords.open(record);
  }
}
