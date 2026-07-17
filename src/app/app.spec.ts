import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { AuthService } from './core/auth/auth.service';
import { DesktopApi, SyncEvent } from './core/electron/desktop-api';

interface DesktopApiMock {
  readonly api: DesktopApi;
  emitSyncEvent(event: SyncEvent): void;
}

/** Simule l'API preload pour piloter la session sans Electron. */
function installDesktopApiMock(): DesktopApiMock {
  const syncListeners: Array<(event: SyncEvent) => void> = [];
  const mock: DesktopApiMock = {
    emitSyncEvent: (event) => syncListeners.forEach((listener) => listener(event)),
    api: {
      app: {
        getVersion: () => Promise.resolve('0.0.0-test'),
        getPlatform: () => Promise.resolve('win32')
      },
      windows: {
        getContext: () => Promise.resolve(null),
        minimize: () => Promise.resolve(),
        toggleMaximize: () => Promise.resolve(false),
        isMaximized: () => Promise.resolve(false),
        close: () => Promise.resolve(),
        detachTab: () => Promise.resolve({ ok: false, error: 'test' }),
        onMaximizedChanged: () => () => {}
      },
      sync: {
        publish: () => Promise.resolve({ ok: true }),
        getState: () => Promise.resolve(null),
        onEvent: (listener) => {
          syncListeners.push(listener);
          return () => {};
        }
      }
    }
  };
  window.desktopAPI = mock.api;
  return mock;
}

describe('App', () => {
  let mock: DesktopApiMock;

  beforeEach(async () => {
    mock = installDesktopApiMock();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
  });

  afterEach(() => {
    delete window.desktopAPI;
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('affiche l’écran de connexion tant qu’aucune session n’est établie', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-login-page')).toBeTruthy();
    expect(compiled.querySelector('app-shell')).toBeNull();
  });

  it('affiche le shell une fois la session établie (ex. via une autre fenêtre)', async () => {
    TestBed.inject(AuthService);
    mock.emitSyncEvent({
      topic: 'auth/state',
      data: {
        authenticated: true,
        session: {
          accessToken: 'access-1',
          accessTokenExpiresAtUtc: '2026-07-17T13:00:00Z',
          refreshToken: 'refresh-1',
          refreshTokenExpiresAtUtc: '2026-07-24T12:00:00Z',
          user: { id: 'u-1', email: 'user@test.fr', displayName: 'Utilisateur Test' }
        }
      },
      sourceWindowId: 'win-b'
    });

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-shell')).toBeTruthy();
    expect(compiled.querySelector('app-title-bar')).toBeTruthy();
    expect(compiled.querySelector('app-status-bar')).toBeTruthy();
    expect(compiled.querySelector('app-login-page')).toBeNull();
  });
});
