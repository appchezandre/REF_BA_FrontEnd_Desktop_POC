import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { WindowSyncService } from '../electron/window-sync.service';
import { TabType } from '../../shared/models/workspace';
import { IconName } from '../../shared/components/icon/icon';

/**
 * Une fiche récemment ouverte, telle qu'affichée dans l'explorateur.
 * Données simples uniquement (sérialisable) : `containerType` + `recordId`
 * permettent de réouvrir la fiche via l'ouvreur enregistré par la feature.
 */
export interface RecentRecord {
  /** Clé stable de dédoublonnage (`<containerType>::<recordId>`). */
  readonly key: string;
  readonly title: string;
  readonly icon: IconName;
  /** Type d'onglet qui héberge la fiche (ex. `'order-list'`). */
  readonly containerType: TabType;
  /** Clé naturelle de la fiche dans son conteneur (ex. n° de commande). */
  readonly recordId: string;
}

/** Nombre maximal de fiches conservées dans « Fiches récentes ». */
export const MAX_RECENT_RECORDS = 15;

/** Sujet du bus inter-fenêtres portant l'historique complet des fiches. */
const RECENT_RECORDS_SYNC_TOPIC = 'recent-records/state';

/**
 * Historique des fiches récemment ouvertes (« Fiches récentes » de
 * l'explorateur). **Vide au démarrage** (aucune persistance disque) : la liste
 * se remplit à l'ouverture des fiches.
 *
 * **Portée globale** : l'historique est partagé entre **toutes les fenêtres**.
 * Les Signals n'étant jamais partagés entre fenêtres, la synchronisation passe
 * par le bus inter-fenêtres (`WindowSyncService`) — chaque mutation publie la
 * liste complète ; les autres fenêtres l'appliquent après validation, et une
 * fenêtre ouverte après coup rattrape le dernier état retenu par Electron Main.
 * Stratégie dernier-écrit-gagnant (cohérente avec `OrdersService`). En
 * navigateur pur, le bus est inerte (une seule fenêtre).
 *
 * Découplage feature ↔ shell : chaque feature enregistre un « ouvreur » pour
 * son type de conteneur (`registerOpener`) ; l'explorateur ne connaît que des
 * données. Même principe que `TabStateRegistry` pour le détachement.
 */
@Injectable({ providedIn: 'root' })
export class RecentRecordsService {
  private readonly sync = inject(WindowSyncService);

  private readonly recordsSignal = signal<readonly RecentRecord[]>([]);
  /** Fiches récentes, de la plus récente à la plus ancienne. */
  readonly records = this.recordsSignal.asReadonly();

  private readonly openers = new Map<TabType, (recordId: string) => void>();

  constructor() {
    // Rattrapage de l'historique déjà constitué par les autres fenêtres.
    void this.sync.getState(RECENT_RECORDS_SYNC_TOPIC).then((data) => {
      // Ne pas écraser une fiche déjà consignée localement entre-temps.
      if (this.recordsSignal().length === 0) {
        this.applySyncedState(data);
      }
    });
    const unsubscribe = this.sync.onTopic(RECENT_RECORDS_SYNC_TOPIC, (data) =>
      this.applySyncedState(data)
    );
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  /** Une feature déclare comment (ré)ouvrir une fiche de ce type de conteneur. */
  registerOpener(containerType: TabType, open: (recordId: string) => void): void {
    this.openers.set(containerType, open);
  }

  /**
   * Enregistre une fiche ouverte : placée en tête, dédoublonnée par clé (une
   * réouverture la remonte), liste bornée à `MAX_RECENT_RECORDS`. Diffusée aux
   * autres fenêtres.
   */
  add(record: RecentRecord): void {
    this.recordsSignal.update((list) =>
      [record, ...list.filter((r) => r.key !== record.key)].slice(0, MAX_RECENT_RECORDS)
    );
    this.sync.publish(RECENT_RECORDS_SYNC_TOPIC, this.recordsSignal());
  }

  /** Réouvre une fiche via l'ouvreur de son conteneur (no-op si non enregistré). */
  open(record: RecentRecord): void {
    this.openers.get(record.containerType)?.(record.recordId);
  }

  /** Vide l'historique (ex. déconnexion) et le propage aux autres fenêtres. */
  clear(): void {
    this.recordsSignal.set([]);
    this.sync.publish(RECENT_RECORDS_SYNC_TOPIC, []);
  }

  /** Applique un historique reçu du bus après validation (donnée non fiable). */
  private applySyncedState(data: unknown): void {
    const parsed = parseSyncedRecords(data);
    if (parsed) {
      this.recordsSignal.set(parsed);
    }
  }
}

/** Valide un historique reçu par IPC (non fiable) : ne garde que des entrées
 *  bien formées, sans doublon de clé, dans la limite `MAX_RECENT_RECORDS`. */
function parseSyncedRecords(data: unknown): readonly RecentRecord[] | null {
  if (!Array.isArray(data)) {
    return null;
  }
  const result: RecentRecord[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const v = entry as Record<string, unknown>;
    if (
      typeof v['key'] === 'string' &&
      typeof v['title'] === 'string' &&
      typeof v['icon'] === 'string' &&
      typeof v['containerType'] === 'string' &&
      typeof v['recordId'] === 'string' &&
      !seen.has(v['key'])
    ) {
      seen.add(v['key']);
      result.push({
        key: v['key'],
        title: v['title'],
        icon: v['icon'] as IconName,
        containerType: v['containerType'],
        recordId: v['recordId']
      });
    }
  }
  return result.slice(0, MAX_RECENT_RECORDS);
}
