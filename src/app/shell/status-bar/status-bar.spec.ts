import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatusBar } from './status-bar';
import { AuthService } from '../../core/auth/auth.service';
import { AuthUser } from '../../core/auth/auth-session';
import { ShellUiService } from '../../core/shell/shell-ui.service';

/** Doublure d'AuthService : pile pilotable, sans HTTP ni bus inter-fenêtres. */
class AuthServiceStub {
  readonly user = signal<AuthUser | null>(null);
  readonly previousUser = signal<AuthUser | null>(null);
  readonly sessionCount = signal(0);
  logoutCount = 0;

  logout(): Promise<void> {
    this.logoutCount += 1;
    return Promise.resolve();
  }
}

const ALICE: AuthUser = { id: 'u-1', email: 'alice@test.fr', displayName: 'Alice' };
const BOB: AuthUser = { id: 'u-2', email: 'bob@test.fr', displayName: 'Bob' };

describe('StatusBar — utilisateur actif et pile de sessions', () => {
  let fixture: ComponentFixture<StatusBar>;
  let auth: AuthServiceStub;
  let shellUi: ShellUiService;

  function buttons(): HTMLButtonElement[] {
    const host = fixture.nativeElement as HTMLElement;
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.status-button'));
  }

  function buttonByText(text: string): HTMLButtonElement {
    const button = buttons().find((b) => b.textContent?.includes(text));
    expect(button).toBeTruthy();
    return button!;
  }

  beforeEach(() => {
    auth = new AuthServiceStub();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: auth }]
    });
    shellUi = TestBed.inject(ShellUiService);
    fixture = TestBed.createComponent(StatusBar);
    fixture.detectChanges();
  });

  it('n’affiche aucune action de session sans utilisateur connecté', () => {
    expect(buttons()).toHaveLength(0);
  });

  it('affiche l’utilisateur actif sans badge quand la pile ne contient qu’une session', () => {
    auth.user.set(ALICE);
    auth.sessionCount.set(1);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Alice');
    expect(host.querySelector('.status-stack-badge')).toBeNull();
    expect(buttonByText('Se déconnecter').textContent?.trim()).toBe('Se déconnecter');
  });

  it('affiche le badge de pile et le retour annoncé vers l’utilisateur précédent', () => {
    auth.user.set(BOB);
    auth.previousUser.set(ALICE);
    auth.sessionCount.set(2);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const badge = host.querySelector<HTMLElement>('.status-stack-badge');
    expect(badge?.textContent?.trim()).toBe('+1');
    expect(badge?.title).toBe('Reviendra à Alice');
    expect(buttonByText('Se déconnecter').textContent).toContain('revient à Alice');
  });

  it('ouvre le dialog « Changer d’utilisateur » via ShellUiService', () => {
    auth.user.set(ALICE);
    auth.sessionCount.set(1);
    fixture.detectChanges();

    expect(shellUi.userSwitchDialogVisible()).toBe(false);
    buttonByText("Changer d'utilisateur").click();
    expect(shellUi.userSwitchDialogVisible()).toBe(true);
  });

  it('déclenche la déconnexion (dépilement) au clic', () => {
    auth.user.set(BOB);
    auth.previousUser.set(ALICE);
    auth.sessionCount.set(2);
    fixture.detectChanges();

    buttonByText('Se déconnecter').click();
    expect(auth.logoutCount).toBe(1);
  });
});
