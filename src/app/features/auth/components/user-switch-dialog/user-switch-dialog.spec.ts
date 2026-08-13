import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService, LoginResult } from '../../../../core/auth/auth.service';
import { AuthUser } from '../../../../core/auth/auth-session';
import { MaintenanceService } from '../../../../core/maintenance/maintenance.service';
import { UserSwitchDialog } from './user-switch-dialog';

/** Doublure d'AuthService : enregistre les switchUser, résultat pilotable. */
class AuthServiceStub {
  readonly user = signal<AuthUser | null>({
    id: 'u-1',
    email: 'alice@test.fr',
    displayName: 'Alice'
  });
  readonly switchUserCalls: Array<{ email: string; password: string }> = [];
  switchUserResult: LoginResult = { ok: true };

  switchUser(email: string, password: string): Promise<LoginResult> {
    this.switchUserCalls.push({ email, password });
    return Promise.resolve(this.switchUserResult);
  }
}

/** Doublure de MaintenanceService : seule la phase est lue par le dialog. */
class MaintenanceServiceStub {
  readonly maintenanceActive = signal(false);
  underMaintenance = (): boolean => this.maintenanceActive();
}

@Component({
  imports: [UserSwitchDialog],
  template: `<app-user-switch-dialog (closed)="closedCount = closedCount + 1" />`
})
class Host {
  closedCount = 0;
}

describe('UserSwitchDialog', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let auth: AuthServiceStub;
  let maintenance: MaintenanceServiceStub;

  function element<T extends HTMLElement>(selector: string): T {
    const found = (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
    expect(found).toBeTruthy();
    return found!;
  }

  async function fillAndSubmit(email: string, password: string): Promise<void> {
    const emailInput = element<HTMLInputElement>('input[type="email"]');
    emailInput.value = email;
    emailInput.dispatchEvent(new Event('input'));
    const passwordInput = element<HTMLInputElement>('input[type="password"]');
    passwordInput.value = password;
    passwordInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    element<HTMLButtonElement>('button[type="submit"]').click();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    auth = new AuthServiceStub();
    maintenance = new MaintenanceServiceStub();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: MaintenanceService, useValue: maintenance }
      ]
    });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('annonce que l’utilisateur actuel restera connecté', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Alice restera connecté');
  });

  it('place le focus initial sur le champ e-mail', () => {
    expect(document.activeElement).toBe(element<HTMLInputElement>('input[type="email"]'));
  });

  it('empile la nouvelle session et se ferme au succès', async () => {
    await fillAndSubmit('bob@test.fr', 'secret');

    expect(auth.switchUserCalls).toEqual([{ email: 'bob@test.fr', password: 'secret' }]);
    expect(host.closedCount).toBe(1);
  });

  it('affiche l’erreur sans se fermer quand la connexion échoue', async () => {
    auth.switchUserResult = { ok: false, error: 'Identifiants invalides.' };
    await fillAndSubmit('bob@test.fr', 'mauvais');
    fixture.detectChanges();

    expect(host.closedCount).toBe(0);
    expect(element<HTMLElement>('.login-error').textContent).toContain(
      'Identifiants invalides.'
    );
  });

  it('refuse toute connexion pendant une maintenance', async () => {
    maintenance.maintenanceActive.set(true);
    await fillAndSubmit('bob@test.fr', 'secret');

    expect(auth.switchUserCalls).toHaveLength(0);
    expect(host.closedCount).toBe(0);
  });

  it('se ferme sur Annuler sans changer de session', async () => {
    element<HTMLButtonElement>('.login-cancel').click();
    expect(host.closedCount).toBe(1);
    expect(auth.switchUserCalls).toHaveLength(0);
  });

  it('se ferme sur Échap', () => {
    const input = element<HTMLInputElement>('input[type="email"]');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.closedCount).toBe(1);
  });

  it('se ferme au clic sur l’arrière-plan, pas au clic dans le dialog', () => {
    element<HTMLElement>('.switch-dialog').click();
    expect(host.closedCount).toBe(0);

    element<HTMLElement>('.switch-backdrop').click();
    expect(host.closedCount).toBe(1);
  });
});
