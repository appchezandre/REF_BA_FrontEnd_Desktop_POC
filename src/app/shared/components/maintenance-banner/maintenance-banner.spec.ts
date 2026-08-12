import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { MaintenanceBanner } from './maintenance-banner';

describe('MaintenanceBanner', () => {
  let fixture: ComponentFixture<MaintenanceBanner>;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function countdown(): string {
    return element().querySelector('.maintenance-banner-countdown')?.textContent?.trim() ?? '';
  }

  function banner(): HTMLElement {
    const found = element().querySelector<HTMLElement>('.maintenance-banner');
    if (!found) {
      throw new Error('Bandeau absent.');
    }
    return found;
  }

  /** Simule une touche sur la poignée de déplacement. */
  async function pressOnHandle(
    key: string,
    modifiers: { shiftKey?: boolean } = {}
  ): Promise<void> {
    element()
      .querySelector<HTMLButtonElement>('.maintenance-banner-handle')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
    await fixture.whenStable();
  }

  async function setRemaining(seconds: number): Promise<void> {
    fixture.componentRef.setInput('remainingSeconds', seconds);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MaintenanceBanner] })
      .compileComponents();
    fixture = TestBed.createComponent(MaintenanceBanner);
    fixture.componentRef.setInput('message', 'Migration de la base.');
    fixture.componentRef.setInput('remainingSeconds', 120);
    await fixture.whenStable();
  });

  it('annonce la consigne et le message du serveur', () => {
    const banner = element().querySelector('.maintenance-banner');
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(element().textContent).toContain('enregistrez votre travail');
    expect(element().textContent).toContain('Migration de la base.');
  });

  it('formate le décompte en m:ss', async () => {
    expect(countdown()).toBe('2:00');

    await setRemaining(119);
    expect(countdown()).toBe('1:59');

    await setRemaining(65);
    expect(countdown()).toBe('1:05');

    await setRemaining(9);
    expect(countdown()).toBe('0:09');
  });

  it('ne descend pas sous zéro', async () => {
    await setRemaining(-5);
    expect(countdown()).toBe('0:00');
  });

  it('soustrait le décompte aux lecteurs d’écran', () => {
    // `role="alert"` annonce le bandeau une fois ; un décompte relu chaque
    // seconde serait inexploitable.
    const timer = element().querySelector('.maintenance-banner-countdown');
    expect(timer?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ne bloque pas l’interface', () => {
    // Pas de dialogue modal : l'application reste utilisable pendant le sursis.
    expect(element().querySelector('[role="dialog"]')).toBeNull();
    expect(element().querySelector('[role="alertdialog"]')).toBeNull();
    // La couche d'accueil couvre la fenêtre mais laisse passer le pointeur ;
    // seul le bandeau l'intercepte.
    const layer = element().querySelector('.maintenance-banner-layer');
    expect(getComputedStyle(layer as Element).pointerEvents).toBe('none');
    expect(getComputedStyle(banner()).pointerEvents).toBe('auto');
    // Aucune action métier : la seule commande est la poignée de déplacement.
    const buttons = element().querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].classList.contains('maintenance-banner-handle')).toBe(true);
  });

  describe('déplacement', () => {
    it('est centré au départ et déplaçable', () => {
      expect(banner().getAttribute('cdkdragboundary')).toBe('.maintenance-banner-layer');
      // Décalage nul : le centrage vient de la couche d'accueil, jamais d'une
      // transformation propre — le CDK pilote `transform`.
      expect(banner().style.transform).toContain('translate3d(0px, 0px');
    });

    it('se déplace aux flèches du clavier', async () => {
      await pressOnHandle('ArrowRight');
      expect(banner().style.transform).toContain('16px');

      await pressOnHandle('ArrowDown');
      expect(banner().style.transform).toContain('16px, 16px');
    });

    it('accélère le pas avec Maj', async () => {
      await pressOnHandle('ArrowRight', { shiftKey: true });
      expect(banner().style.transform).toContain('48px');
    });

    it('recentre avec la touche Origine', async () => {
      await pressOnHandle('ArrowRight', { shiftKey: true });
      expect(banner().style.transform).toContain('48px');

      await pressOnHandle('Home');
      expect(banner().style.transform).not.toContain('48px');
    });

    it('ignore les autres touches', async () => {
      await pressOnHandle('Enter');
      expect(banner().style.transform).toContain('translate3d(0px, 0px');
    });
  });
});
