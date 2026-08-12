import { WorkspaceTab } from '../../shared/models/workspace';

/** Contrats de l'API exposée par `electron/preload.cjs` via contextBridge. */

export type WindowMode = 'main' | 'detached-tab' | 'secondary-workspace';

export interface WindowContext {
  readonly windowId: string;
  readonly mode: WindowMode;
  /** Donnée reçue par IPC : non fiable, à revalider avant usage. */
  readonly initialTab?: unknown;
}

export interface DetachTabRequest {
  readonly tab: WorkspaceTab;
}

export type DetachTabResult =
  | { readonly ok: true; readonly windowId: string }
  | { readonly ok: false; readonly error: string };

/** Événement du bus de synchronisation inter-fenêtres (données non fiables). */
export interface SyncEvent {
  readonly topic: string;
  readonly data: unknown;
  readonly sourceWindowId: string;
}

export type PublishResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export interface DesktopApi {
  readonly app: {
    getVersion(): Promise<string>;
    getPlatform(): Promise<string>;
    /** Quitte l'application entière, à distinguer de `windows.close()`. */
    quit(): Promise<void>;
  };
  readonly windows: {
    getContext(): Promise<WindowContext | null>;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    isMaximized(): Promise<boolean>;
    close(): Promise<void>;
    detachTab(request: DetachTabRequest): Promise<DetachTabResult>;
    onMaximizedChanged(listener: (maximized: boolean) => void): () => void;
  };
  readonly sync: {
    publish(topic: string, data: unknown): Promise<PublishResult>;
    getState(topic: string): Promise<unknown>;
    onEvent(listener: (event: SyncEvent) => void): () => void;
  };
}

declare global {
  interface Window {
    /** Absent en navigateur pur (`ng serve` sans Electron). */
    desktopAPI?: DesktopApi;
  }
}
