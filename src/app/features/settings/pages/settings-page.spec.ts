import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaintenanceService } from '../../../core/maintenance/maintenance.service';
import { SettingsPage } from './settings-page';

describe('SettingsPage — déclencheur de maintenance', () => {
  let fixture: ComponentFixture<SettingsPage>;
  let startMaintenance: ReturnType<typeof vi.fn>;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function button(): HTMLButtonElement {
    const found = element().querySelector<HTMLButtonElement>('.settings-button-danger');
    if (!found) {
      throw new Error('Bouton de passage en maintenance absent.');
    }
    return found;
  }

  function setInput(selector: string, value: string): void {
    const input = element().querySelector<HTMLInputElement>(selector);
    if (!input) {
      throw new Error(`Champ ${selector} absent.`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  beforeEach(async () => {
    startMaintenance = vi.fn(() => Promise.resolve({ ok: true }));
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [{ provide: MaintenanceService, useValue: { startMaintenance } }]
    }).compileComponents();
    fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
  });

  it('avertit des conséquences avant toute action', () => {
    const warning = element().querySelector('.settings-warning');
    expect(warning?.textContent).toContain('tous les utilisateurs');
    // Le sursis accordé aux autres fait partie de ce que l'opérateur doit
    // savoir avant de basculer, autant que le gel qui suit…
    expect(warning?.textContent).toContain('deux minutes');
    expect(warning?.textContent).toContain('figées');
    // …et surtout qu'il n'en bénéficie pas lui-même.
    expect(warning?.textContent).toContain('figée immédiatement');
  });

  it('utilise le délai par défaut sans saisie', async () => {
    button().click();
    await fixture.whenStable();

    expect(startMaintenance).toHaveBeenCalledWith(5, null);
  });

  it('transmet le délai et le message saisis', async () => {
    setInput('input[type="number"]', '20');
    setInput('input[type="text"]', '  Migration de la base.  ');
    await fixture.whenStable();

    button().click();
    await fixture.whenStable();

    expect(startMaintenance).toHaveBeenCalledWith(20, 'Migration de la base.');
  });

  it('retombe sur le délai par défaut si la saisie est invalide', async () => {
    setInput('input[type="number"]', '0');
    await fixture.whenStable();

    button().click();
    await fixture.whenStable();

    expect(startMaintenance).toHaveBeenCalledWith(5, null);
  });

  it('affiche l’erreur renvoyée par l’API', async () => {
    startMaintenance.mockResolvedValue({ ok: false, error: 'Erreur serveur.' });

    button().click();
    await fixture.whenStable();

    const error = element().querySelector('.settings-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('Erreur serveur.');
  });
});
