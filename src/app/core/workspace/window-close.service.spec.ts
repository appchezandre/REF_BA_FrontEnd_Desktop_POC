import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { WindowCloseService } from './window-close.service';
import { WorkspaceStore } from './workspace-store';
import { ElectronService } from '../electron/electron.service';

describe('WindowCloseService', () => {
  const dirty = signal(false);
  let closeWindow: ReturnType<typeof vi.fn>;
  let service: WindowCloseService;

  beforeEach(() => {
    dirty.set(false);
    closeWindow = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        WindowCloseService,
        { provide: WorkspaceStore, useValue: { hasUnsavedChanges: dirty } },
        { provide: ElectronService, useValue: { closeWindow } }
      ]
    });
    service = TestBed.inject(WindowCloseService);
  });

  it('ferme directement quand tout est enregistré', () => {
    service.requestExit();
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(service.pending()).toBe(false);
  });

  it('demande confirmation quand des modifications sont en attente', () => {
    dirty.set(true);
    service.requestExit();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(service.pending()).toBe(true);
  });

  it('confirmExit ferme la fenêtre et lève l’attente', () => {
    dirty.set(true);
    service.requestExit();
    service.confirmExit();
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(service.pending()).toBe(false);
  });

  it('cancelExit annule sans fermer', () => {
    dirty.set(true);
    service.requestExit();
    service.cancelExit();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(service.pending()).toBe(false);
  });
});
