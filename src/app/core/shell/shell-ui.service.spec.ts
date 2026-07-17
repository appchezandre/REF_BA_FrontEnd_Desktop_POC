import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ShellUiService } from './shell-ui.service';

describe('ShellUiService', () => {
  let ui: ShellUiService;

  beforeEach(() => {
    ui = TestBed.inject(ShellUiService);
  });

  it('démarre sur l’explorateur, side bar visible', () => {
    expect(ui.activityView()).toBe('explorer');
    expect(ui.sidebarVisible()).toBe(true);
  });

  it('selectActivity bascule la visibilité si la vue est déjà active', () => {
    ui.selectActivity('explorer');
    expect(ui.sidebarVisible()).toBe(false);
    ui.selectActivity('explorer');
    expect(ui.sidebarVisible()).toBe(true);
  });

  it('selectActivity change de vue et affiche la side bar', () => {
    ui.toggleSidebar(); // masquée
    expect(ui.sidebarVisible()).toBe(false);
    ui.selectActivity('search');
    expect(ui.activityView()).toBe('search');
    expect(ui.sidebarVisible()).toBe(true);
  });

  it('revealSearch ouvre la recherche même side bar masquée', () => {
    ui.toggleSidebar();
    ui.revealSearch();
    expect(ui.activityView()).toBe('search');
    expect(ui.sidebarVisible()).toBe(true);
  });
});
