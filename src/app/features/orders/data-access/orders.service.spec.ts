import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { OrdersService } from './orders.service';
import { Order } from '../models/order';
import { DesktopApi, SyncEvent } from '../../../core/electron/desktop-api';

const N1 = 'CMD-2026-0101';

interface DesktopApiMock {
  readonly api: DesktopApi;
  readonly published: Array<{ topic: string; data: unknown }>;
  emitSyncEvent(event: SyncEvent): void;
  retained: unknown;
}

/** Simule l'API preload pour tester la frontière Electron sans Electron. */
function installDesktopApiMock(): DesktopApiMock {
  const published: Array<{ topic: string; data: unknown }> = [];
  const syncListeners: Array<(event: SyncEvent) => void> = [];
  const mock: DesktopApiMock = {
    published,
    retained: null,
    emitSyncEvent: (event) => syncListeners.forEach((listener) => listener(event)),
    api: {
      app: {
        getVersion: () => Promise.resolve('0.0.0-test'),
        getPlatform: () => Promise.resolve('win32'),
        quit: () => Promise.resolve()
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
        publish: (topic, data) => {
          published.push({ topic, data });
          return Promise.resolve({ ok: true });
        },
        getState: () => Promise.resolve(mock.retained),
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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('OrdersService (synchronisation inter-fenêtres)', () => {
  let mock: DesktopApiMock;

  beforeEach(() => {
    mock = installDesktopApiMock();
  });

  afterEach(() => {
    delete window.desktopAPI;
  });

  it('publie l’état complet sur le bus après une modification', () => {
    const service = TestBed.inject(OrdersService);
    service.updateOrder(N1, {
      customer: 'Client modifié',
      date: '2026-07-13',
      status: 'confirmed',
      notes: ''
    });
    expect(mock.published).toHaveLength(1);
    expect(mock.published[0].topic).toBe('orders/state');
    const data = mock.published[0].data as readonly Order[];
    expect(data.find((o) => o.orderNumber === N1)?.customer).toBe('Client modifié');
  });

  it('applique un événement valide reçu d’une autre fenêtre', () => {
    const service = TestBed.inject(OrdersService);
    const updated = service
      .orders()
      .map((o) => (o.orderNumber === N1 ? { ...o, customer: 'Depuis fenêtre B' } : o));
    mock.emitSyncEvent({ topic: 'orders/state', data: updated, sourceWindowId: 'win-b' });
    expect(service.getOrder(N1)?.customer).toBe('Depuis fenêtre B');
    // La réception ne republie pas (pas de boucle infinie).
    expect(mock.published).toHaveLength(0);
  });

  it('ignore un événement invalide sans corrompre l’état', () => {
    const service = TestBed.inject(OrdersService);
    const before = service.orders();
    mock.emitSyncEvent({
      topic: 'orders/state',
      data: [{ orderNumber: '', hostile: true }],
      sourceWindowId: 'win-b'
    });
    expect(service.orders()).toBe(before);
  });

  it('rattrape l’état retenu par le main à l’ouverture de la fenêtre', async () => {
    const retained: Order[] = [
      {
        orderNumber: 'CMD-RETENUE',
        customer: 'État antérieur',
        date: '2026-07-10',
        status: 'invoiced',
        total: 42,
        notes: ''
      }
    ];
    mock.retained = retained;
    const service = TestBed.inject(OrdersService);
    await flushMicrotasks();
    expect(service.orders()).toEqual(retained);
  });
});
