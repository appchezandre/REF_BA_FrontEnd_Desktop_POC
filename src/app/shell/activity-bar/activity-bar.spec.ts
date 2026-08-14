import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivityBar } from './activity-bar';
import { AuthService } from '../../core/auth/auth.service';
import { AuthSession, AuthUser } from '../../core/auth/auth-session';
import { ShellUiService } from '../../core/shell/shell-ui.service';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { UsersScreenRegistry } from '../../features/users/store/users-screen.registry';

/** Session minimale : seule l'identité est lue par la barre d'activité. */
function sessionFor(user: AuthUser): AuthSession {
  return {
    accessToken: 'token',
    accessTokenExpiresAtUtc: '2099-01-01T00:00:00Z',
    refreshToken: 'refresh',
    refreshTokenExpiresAtUtc: '2099-01-01T00:00:00Z',
    user
  };
}

/** Doublure d'AuthService : évite tout HTTP et tout bus inter-fenêtres. */
class AuthServiceStub {
  readonly sessionSignal = signal<AuthSession | null>(null);
  readonly user = signal<AuthUser | null>(null);
}

@Component({
  imports: [ActivityBar],
  template: `<app-activity-bar [active]="'explorer'" [sidebarVisible]="true" />`
})
class Host {}

describe('ActivityBar — bouton Compte', () => {
  let fixture: ComponentFixture<Host>;
  let auth: AuthServiceStub;
  let workspace: WorkspaceStore;
  let registry: UsersScreenRegistry;

  function accountButton(): HTMLButtonElement {
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Compte"]');
    expect(button).toBeTruthy();
    return button!;
  }

  /** Premier onglet Utilisateurs de la fenêtre, s'il existe. */
  function userTabId(): string | undefined {
    return workspace
      .groups()
      .flatMap((g) => g.tabs)
      .find((t) => t.type === 'user-list')?.id;
  }

  /**
   * Attend la fin de l'ouverture : le handler charge le registre en import
   * dynamique, l'onglet n'existe donc pas au retour du clic.
   */
  async function waitFor(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 50 && !condition(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(condition()).toBe(true);
  }

  beforeEach(() => {
    auth = new AuthServiceStub();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth }
      ]
    });
    workspace = TestBed.inject(WorkspaceStore);
    registry = TestBed.inject(UsersScreenRegistry);
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('ouvre la fiche de l’utilisateur connecté dans le conteneur Utilisateurs', async () => {
    auth.user.set({ id: '7', email: 'a@b.c', displayName: 'Alice' });
    fixture.detectChanges();

    accountButton().click();
    await waitFor(() => userTabId() !== undefined);

    // On atterrit sur la fiche du compte connecté, pas sur la liste.
    const screen = registry.forTab(userTabId()!);
    expect(screen.detailKeys()).toEqual(['7']);
    expect(screen.activeView()).toBe('7');
  });

  it('réutilise le conteneur Utilisateurs déjà ouvert', async () => {
    auth.user.set({ id: '7', email: 'a@b.c', displayName: 'Alice' });
    fixture.detectChanges();
    workspace.openTab({ type: 'user-list', title: 'Utilisateurs' });
    const existing = userTabId()!;

    accountButton().click();
    await waitFor(() => registry.forTab(existing).activeView() === '7');

    const tabs = workspace
      .groups()
      .flatMap((g) => g.tabs)
      .filter((t) => t.type === 'user-list');
    expect(tabs).toHaveLength(1);
  });

  it('est désactivé quand l’identité du compte est indisponible', () => {
    auth.user.set({ id: '', email: '', displayName: '' });
    fixture.detectChanges();

    expect(accountButton().disabled).toBe(true);
  });

  it('reste au singulier (libellé « Compte »)', () => {
    expect(accountButton().title).toBe('Compte');
  });

  it('utilise la session pour dériver l’identité', async () => {
    // Garde-fou : la doublure doit rester alignée sur l'API d'AuthService lue
    // par le composant (`user()` dérivé de la session).
    const session = sessionFor({ id: '9', email: 'x@y.z', displayName: 'Bob' });
    auth.sessionSignal.set(session);
    auth.user.set(session.user);
    fixture.detectChanges();

    accountButton().click();
    await waitFor(() => userTabId() !== undefined);

    expect(registry.forTab(userTabId()!).activeView()).toBe('9');
  });
});

describe('ActivityBar — item Traitements en cours', () => {
  let fixture: ComponentFixture<Host>;
  let shellUi: ShellUiService;

  function jobsButton(): HTMLButtonElement {
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector<HTMLButtonElement>(
      'button[title="Traitements en cours"]'
    );
    expect(button).toBeTruthy();
    return button!;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: new AuthServiceStub() }
      ]
    });
    shellUi = TestBed.inject(ShellUiService);
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('est rendu dans la barre avec sa roue dentée', () => {
    const button = jobsButton();
    expect(button.querySelector('svg')).toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('Traitements en cours');
  });

  it('affiche la pastille et enrichit le libellé quand un traitement est actif', () => {
    expect(jobsButton().querySelector('.activity-badge')).toBeNull();

    shellUi.setJobActivity(true);
    fixture.detectChanges();

    expect(jobsButton().querySelector('.activity-badge')).toBeTruthy();
    expect(jobsButton().getAttribute('aria-label')).toBe(
      'Traitements en cours — un traitement est actif'
    );
  });
});
