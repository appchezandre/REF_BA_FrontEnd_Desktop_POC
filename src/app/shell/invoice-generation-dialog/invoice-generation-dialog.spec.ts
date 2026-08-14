import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InvoiceGenerationCommandResult,
  InvoiceGenerationService
} from '../../core/invoicing/invoice-generation.service';
import { ShellUiService } from '../../core/shell/shell-ui.service';
import { InvoiceGenerationDialog } from './invoice-generation-dialog';

/** Doublure du service : enregistre les lancements, résultat pilotable. */
class ServiceStub {
  readonly launchCalls: Array<{ year: number; month: number }> = [];
  launchResult: InvoiceGenerationCommandResult = { ok: true };

  launch(year: number, month: number): Promise<InvoiceGenerationCommandResult> {
    this.launchCalls.push({ year, month });
    return Promise.resolve(this.launchResult);
  }
}

@Component({
  imports: [InvoiceGenerationDialog],
  template: `<app-invoice-generation-dialog (closed)="closedCount = closedCount + 1" />`
})
class Host {
  closedCount = 0;
}

describe('InvoiceGenerationDialog', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let service: ServiceStub;
  let shellUi: ShellUiService;

  function element<T extends HTMLElement>(selector: string): T {
    const found = (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
    expect(found).toBeTruthy();
    return found!;
  }

  async function create(): Promise<void> {
    service = new ServiceStub();
    TestBed.configureTestingModule({
      providers: [{ provide: InvoiceGenerationService, useValue: service }]
    });
    shellUi = TestBed.inject(ShellUiService);
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
  }

  beforeEach(() => {
    // Date figée pour un pré-remplissage déterministe : août 2026 -> juillet
    // 2026. Seul `Date` est simulé : les timers réels restent nécessaires au
    // rendu (afterNextRender / whenStable).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 7, 14));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pré-remplit la période au mois précédent', async () => {
    await create();

    expect(element<HTMLSelectElement>('select').value).toBe('7');
    expect(element<HTMLInputElement>('input[type="number"]').value).toBe('2026');
  });

  it('bascule sur décembre de l’année précédente en janvier', async () => {
    vi.setSystemTime(new Date(2026, 0, 5));
    await create();

    expect(element<HTMLSelectElement>('select').value).toBe('12');
    expect(element<HTMLInputElement>('input[type="number"]').value).toBe('2025');
  });

  it('désactive le lancement pour une année hors bornes', async () => {
    await create();
    const yearInput = element<HTMLInputElement>('input[type="number"]');
    const submit = element<HTMLButtonElement>('button[type="submit"]');

    yearInput.value = '1999';
    yearInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(submit.disabled).toBe(true);

    // Borne backend : année courante + 1.
    yearInput.value = '2028';
    yearInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(submit.disabled).toBe(true);

    yearInput.value = '2027';
    yearInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(submit.disabled).toBe(false);
  });

  it('lance la période saisie, se ferme et révèle la vue Traitements', async () => {
    await create();

    element<HTMLButtonElement>('button[type="submit"]').click();
    await fixture.whenStable();

    expect(service.launchCalls).toEqual([{ year: 2026, month: 7 }]);
    expect(host.closedCount).toBe(1);
    expect(shellUi.activityView()).toBe('jobs');
    expect(shellUi.sidebarVisible()).toBe(true);
  });

  it('affiche l’erreur sans se fermer quand le lancement échoue', async () => {
    await create();
    service.launchResult = {
      ok: false,
      error: 'Impossible de joindre le serveur.'
    };

    element<HTMLButtonElement>('button[type="submit"]').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.closedCount).toBe(0);
    expect(element<HTMLElement>('.invoice-error').textContent).toContain(
      'Impossible de joindre le serveur.'
    );
    expect(shellUi.activityView()).toBe('explorer');
  });

  it('se ferme sur Annuler et sur Échap sans lancer', async () => {
    await create();

    element<HTMLButtonElement>('.action-secondary').click();
    expect(host.closedCount).toBe(1);

    element<HTMLSelectElement>('select').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(host.closedCount).toBe(2);
    expect(service.launchCalls).toHaveLength(0);
  });

  it('se ferme au clic sur l’arrière-plan, pas au clic dans le dialog', async () => {
    await create();

    element<HTMLElement>('.invoice-dialog').click();
    expect(host.closedCount).toBe(0);

    element<HTMLElement>('.invoice-backdrop').click();
    expect(host.closedCount).toBe(1);
  });
});
