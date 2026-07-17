import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal
} from '@angular/core';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { RecentRecordsService } from '../../../core/shell/recent-records.service';
import { WorkspaceTab } from '../../../shared/models/workspace';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { UsersService } from '../data-access/users.service';
import { UserDetail } from '../components/user-detail';
import { UserList } from '../components/user-list';
import { UsersScreenRegistry } from '../store/users-screen.registry';
import { LIST_VIEW } from '../store/users-screen.store';

/**
 * Fenêtre Utilisateurs : écran de type « liste d'entités » (patron Commandes)
 * avec un onglet interne Liste systématique (non fermable) et un onglet
 * Détail par utilisateur ouvert (clé = id backend). Chaque onglet du
 * workspace (Ctrl+clic = seconde instance) possède son propre état, résolu
 * via le registre. Les données viennent de l'API Ref.Api (`api/users`).
 */
@Component({
  selector: 'app-users-page',
  imports: [UserList, UserDetail, ConfirmDialog],
  templateUrl: './users-page.html',
  styleUrl: './users-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UsersPage {
  private readonly registry = inject(UsersScreenRegistry);
  private readonly workspace = inject(WorkspaceStore);
  private readonly recentRecords = inject(RecentRecordsService);
  protected readonly usersService = inject(UsersService);

  /** Onglet du workspace qui héberge cette instance de l'écran. */
  readonly tab = input.required<WorkspaceTab>();

  /** État propre à cette instance (persiste entre les changements d'onglet). */
  protected readonly screen = computed(() => this.registry.forTab(this.tab().id));

  /** Clé de la fiche modifiée dont la fermeture attend confirmation. */
  protected readonly pendingClose = signal<string | null>(null);

  // Clés des détails déjà consignés dans « Fiches récentes » (évite les doublons ;
  // resynchronisé sur les détails ouverts pour qu'une réouverture reconsigne).
  private recordedDetails = new Set<string>();

  protected readonly LIST_VIEW = LIST_VIEW;

  constructor() {
    // Premier chargement de la liste depuis l'API (idempotent).
    this.usersService.ensureLoaded();

    // Reflète les modifications non enregistrées sur l'onglet du workspace.
    effect(() => {
      this.workspace.setDirty(this.tab().id, this.screen().hasDirty());
    });

    // Consigne toute fiche nouvellement ouverte dans « Fiches récentes »
    // (la simple ouverture suffit, sans modification).
    effect(() => {
      const open = this.screen().detailKeys();
      for (const key of open) {
        if (!this.recordedDetails.has(key)) {
          this.recentRecords.add({
            key: `user-list::${key}`,
            title: this.detailLabel(key),
            icon: 'users',
            containerType: 'user-list',
            recordId: key
          });
        }
      }
      // Ne garder que les détails encore ouverts : rouvrir un détail fermé le
      // reconsigne (et le remonte en tête).
      this.recordedDetails = new Set(open);
    });
  }

  /** Libellé d'une fiche : nom de l'utilisateur si chargé, sinon sa clé. */
  protected detailLabel(key: string): string {
    const user = this.usersService.getUserByKey(key);
    return user ? user.name : `Utilisateur ${key}`;
  }

  protected closeDetail(event: Event, key: string): void {
    event.stopPropagation();
    // Fiche modifiée : demander confirmation avant de perdre les changements.
    if (this.screen().dirtyKeys().has(key)) {
      this.pendingClose.set(key);
    } else {
      this.screen().closeDetail(key);
    }
  }

  protected confirmClose(): void {
    const key = this.pendingClose();
    if (key) {
      this.screen().closeDetail(key);
    }
    this.pendingClose.set(null);
  }

  protected cancelClose(): void {
    this.pendingClose.set(null);
  }
}
