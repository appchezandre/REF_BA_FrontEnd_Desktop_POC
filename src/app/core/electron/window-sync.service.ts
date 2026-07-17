import { DestroyRef, Injectable, inject } from '@angular/core';
import { ElectronService } from './electron.service';

/**
 * Bus de synchronisation inter-fenêtres. Les Signals Angular n'étant jamais
 * partagés entre fenêtres, chaque fenêtre publie ses changements par sujet ;
 * Electron Main retient le dernier état (rattrapage des fenêtres ouvertes
 * après coup) et rediffuse aux autres fenêtres.
 *
 * Les données reçues sont NON FIABLES : chaque abonné doit valider le
 * payload (`unknown`) avant de l'appliquer. En navigateur pur, le bus est
 * inerte (une seule fenêtre).
 */
@Injectable({ providedIn: 'root' })
export class WindowSyncService {
  private readonly electron = inject(ElectronService);
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

  constructor() {
    if (!this.electron.isElectron) {
      return;
    }
    const unsubscribe = this.electron.onSyncEvent((event) => {
      if (typeof event?.topic !== 'string') {
        return;
      }
      const topicListeners = this.listeners.get(event.topic);
      if (!topicListeners) {
        return;
      }
      for (const listener of topicListeners) {
        listener(event.data);
      }
    });
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  /** Publie l'état d'un sujet vers les autres fenêtres (fire-and-forget). */
  publish(topic: string, data: unknown): void {
    void this.electron.publishSync(topic, data);
  }

  /** Dernier état publié pour un sujet (null si aucun ou hors Electron). */
  getState(topic: string): Promise<unknown> {
    return this.electron.getSyncState(topic);
  }

  /** S'abonne aux publications des AUTRES fenêtres pour un sujet. */
  onTopic(topic: string, listener: (data: unknown) => void): () => void {
    let topicListeners = this.listeners.get(topic);
    if (!topicListeners) {
      topicListeners = new Set();
      this.listeners.set(topic, topicListeners);
    }
    topicListeners.add(listener);
    return () => {
      topicListeners.delete(listener);
    };
  }
}
