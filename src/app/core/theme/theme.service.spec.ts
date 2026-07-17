import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('démarre en thème sombre par défaut', () => {
    const service = TestBed.inject(ThemeService);
    expect(service.theme()).toBe('dark');
  });

  it('reprend le thème enregistré au démarrage', () => {
    localStorage.setItem('app-theme', 'light');
    const service = TestBed.inject(ThemeService);
    expect(service.theme()).toBe('light');
  });

  it('setTheme change le thème', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('light');
    expect(service.theme()).toBe('light');
  });

  it('expose les cinq thèmes disponibles', () => {
    const service = TestBed.inject(ThemeService);
    expect([...service.available]).toEqual([
      'dark',
      'dark-red',
      'dark-mint',
      'light',
      'light-mint'
    ]);
  });

  it('setTheme accepte les nouveaux thèmes', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('dark-mint');
    expect(service.theme()).toBe('dark-mint');
    service.setTheme('light-mint');
    expect(service.theme()).toBe('light-mint');
  });

  it('setTheme ignore une valeur invalide', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('fluo' as never);
    expect(service.theme()).toBe('dark');
  });

  it('applique data-theme sur la racine et persiste', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('light');
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('app-theme')).toBe('light');
  });
});
