import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { MaintenanceOverlay } from './maintenance-overlay';

describe('MaintenanceOverlay', () => {
  let fixture: ComponentFixture<MaintenanceOverlay>;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MaintenanceOverlay] })
      .compileComponents();
    fixture = TestBed.createComponent(MaintenanceOverlay);
    fixture.componentRef.setInput('message', 'Application en maintenance.');
  });

  it('affiche le message du serveur dans un dialogue modal d’alerte', async () => {
    await fixture.whenStable();

    const panel = element().querySelector('[role="alertdialog"]');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    expect(element().textContent).toContain('Application en maintenance.');
  });

  it('affiche la durée estimée quand elle est connue', async () => {
    fixture.componentRef.setInput('delayMinutes', 12);
    await fixture.whenStable();

    expect(element().textContent).toContain('Durée estimée : 12 minutes');
  });

  it('masque la durée estimée quand elle est inconnue', async () => {
    fixture.componentRef.setInput('delayMinutes', 0);
    await fixture.whenStable();

    expect(element().querySelector('.maintenance-delay')).toBeNull();
    expect(element().querySelector('.maintenance-end')).toBeNull();
  });

  it('affiche la fin prévisionnelle : début serveur + durée, en heure locale', async () => {
    fixture.componentRef.setInput('delayMinutes', 45);
    fixture.componentRef.setInput('changedAtUtc', '2026-08-12T09:00:00+00:00');
    await fixture.whenStable();

    // Attendu recalculé avec les mêmes formateurs : le test reste juste quel
    // que soit le fuseau de la machine qui l'exécute.
    const end = new Date(Date.parse('2026-08-12T09:00:00+00:00') + 45 * 60_000);
    const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(end);
    const time = new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(end);

    expect(element().querySelector('.maintenance-end')?.textContent).toContain(
      `Fin prévue : ${date} à ${time}.`
    );
  });

  it('masque la fin prévisionnelle si l’horodatage est inexploitable', async () => {
    fixture.componentRef.setInput('delayMinutes', 10);
    fixture.componentRef.setInput('changedAtUtc', 'pas-une-date');
    await fixture.whenStable();

    // Mieux vaut aucune heure qu'une heure fausse ; la durée reste affichée.
    expect(element().querySelector('.maintenance-delay')).toBeTruthy();
    expect(element().querySelector('.maintenance-end')).toBeNull();
  });

  it('retient le focus quand il sort du voile', async () => {
    // Simule un champ resté monté derrière (formulaire de connexion).
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    try {
      await fixture.whenStable();
      const panel = element().querySelector<HTMLElement>('[role="alertdialog"]');

      outside.focus();
      outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(document.activeElement).toBe(panel);
    } finally {
      outside.remove();
    }
  });

  it('n’offre que la fermeture de l’application par défaut', async () => {
    await fixture.whenStable();

    // Seule issue offerte aux clients ordinaires : le voile ne s'écarte pas,
    // il se lève avec la maintenance.
    const buttons = element().querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe('Fermer l’application');
    expect(element().textContent).toContain('Votre session a été fermée');
  });

  it('émet la demande de fermeture au clic et prend le focus', async () => {
    await fixture.whenStable();
    const close = element().querySelector<HTMLButtonElement>(
      '.maintenance-button-close'
    );
    expect(document.activeElement).toBe(close);

    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));
    close?.click();

    expect(closed).toBe(1);
  });

  it('n’offre à la fenêtre initiatrice que la levée, jamais la fermeture', async () => {
    fixture.componentRef.setInput('canLift', true);
    fixture.componentRef.setInput('canClose', false);
    await fixture.whenStable();

    // Lui proposer de quitter la priverait du seul moyen de remettre
    // l'application en service.
    const buttons = element().querySelectorAll<HTMLButtonElement>('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe('Lever la maintenance');
    expect(buttons[0].disabled).toBe(false);
    // Le focus va bien à la seule action disponible.
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('annonce à la fenêtre initiatrice que sa session est conservée', async () => {
    fixture.componentRef.setInput('canLift', true);
    await fixture.whenStable();

    expect(element().textContent).toContain('votre session est conservée');
    expect(element().textContent).not.toContain('Votre session a été fermée');
  });

  it('désactive la levée pendant une levée en cours', async () => {
    fixture.componentRef.setInput('canLift', true);
    fixture.componentRef.setInput('lifting', true);
    await fixture.whenStable();

    const lift = element().querySelectorAll<HTMLButtonElement>('.maintenance-button')[0];
    expect(lift.disabled).toBe(true);
    expect(lift.textContent?.trim()).toBe('Levée en cours…');
  });

  it('émet la demande de levée au clic', async () => {
    fixture.componentRef.setInput('canLift', true);
    await fixture.whenStable();

    let lifted = 0;
    fixture.componentInstance.lift.subscribe(() => (lifted += 1));
    element().querySelectorAll<HTMLButtonElement>('.maintenance-button')[0].click();

    expect(lifted).toBe(1);
  });

  it('affiche l’erreur d’une levée échouée', async () => {
    fixture.componentRef.setInput('canLift', true);
    fixture.componentRef.setInput('error', 'Impossible de lever la maintenance.');
    await fixture.whenStable();

    const error = element().querySelector('.maintenance-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('Impossible de lever la maintenance.');
  });
});
