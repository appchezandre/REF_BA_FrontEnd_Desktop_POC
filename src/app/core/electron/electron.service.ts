import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import {
  DesktopApi,
  DetachTabRequest,
  DetachTabResult,
  PublishResult,
  SyncEvent,
  WindowContext
} from './desktop-api';

/**
 * Frontière unique entre Angular et l'API preload.
 * Toutes les méthodes se dégradent proprement en navigateur pur.
 */
@Injectable({ providedIn: 'root' })
export class ElectronService {
  private readonly api: DesktopApi | undefined =
    typeof window !== 'undefined' ? window.desktopAPI : undefined;

  readonly isElectron = this.api !== undefined;

  private readonly maximizedSignal = signal(false);
  private readonly versionSignal = signal<string | null>(null);
  private readonly platformSignal = signal<string | null>(null);

  readonly maximized = this.maximizedSignal.asReadonly();
  readonly version = this.versionSignal.asReadonly();
  readonly platform = this.platformSignal.asReadonly();

  constructor() {
    const api = this.api;
    if (!api) {
      return;
    }
    void api.app.getVersion().then((version) => this.versionSignal.set(version));
    void api.app.getPlatform().then((platform) => this.platformSignal.set(platform));
    void api.windows.isMaximized().then((maximized) => this.maximizedSignal.set(maximized));

    const unsubscribe = api.windows.onMaximizedChanged((maximized) =>
      this.maximizedSignal.set(maximized)
    );
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  getContext(): Promise<WindowContext | null> {
    return this.api ? this.api.windows.getContext() : Promise.resolve(null);
  }

  async minimize(): Promise<void> {
    await this.api?.windows.minimize();
  }

  async toggleMaximize(): Promise<void> {
    await this.api?.windows.toggleMaximize();
  }

  async closeWindow(): Promise<void> {
    await this.api?.windows.close();
  }

  /**
   * Quitte l'application entière (toutes les fenêtres). Inconditionnel : aucune
   * garde de modifications non enregistrées, contrairement à
   * `WindowCloseService.requestExit()`.
   */
  async quitApp(): Promise<void> {
    await this.api?.app.quit();
  }

  detachTab(request: DetachTabRequest): Promise<DetachTabResult> {
    if (!this.api) {
      return Promise.resolve({ ok: false, error: 'not-electron' });
    }
    return this.api.windows.detachTab(request);
  }

  publishSync(topic: string, data: unknown): Promise<PublishResult> {
    if (!this.api) {
      return Promise.resolve({ ok: false, error: 'not-electron' });
    }
    return this.api.sync.publish(topic, data);
  }

  getSyncState(topic: string): Promise<unknown> {
    return this.api ? this.api.sync.getState(topic) : Promise.resolve(null);
  }

  onSyncEvent(listener: (event: SyncEvent) => void): () => void {
    return this.api ? this.api.sync.onEvent(listener) : () => {};
  }
}
