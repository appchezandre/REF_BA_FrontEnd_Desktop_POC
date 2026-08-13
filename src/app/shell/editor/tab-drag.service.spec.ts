import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabDragService, computeZone } from './tab-drag.service';

/** Rect de référence : 1000×600 à l'origine → centre (500, 300). */
const RECT = {
  left: 0,
  top: 0,
  width: 1000,
  height: 600,
  right: 1000,
  bottom: 600,
  x: 0,
  y: 0,
  toJSON: () => ({})
} as DOMRect;

describe('computeZone', () => {
  it('pastille centre : boîte de 40 px autour du centre', () => {
    expect(computeZone(RECT, 500, 300)).toBe('center');
    expect(computeZone(RECT, 520, 320)).toBe('center'); // coin de la pastille
  });

  it('pastilles latérales à ±44 px du centre (demi-côté 20 px)', () => {
    expect(computeZone(RECT, 500 - 44, 300)).toBe('left');
    expect(computeZone(RECT, 500 + 44, 300)).toBe('right');
    expect(computeZone(RECT, 500, 300 - 44)).toBe('top');
    expect(computeZone(RECT, 500, 300 + 44)).toBe('bottom');
    // Bords extrêmes des pastilles (±44 ± 20).
    expect(computeZone(RECT, 500 - 64, 300)).toBe('left');
    expect(computeZone(RECT, 500 + 64, 300)).toBe('right');
  });

  it('hors pastilles et hors bandes de bord : centre', () => {
    // x = 435 : entre la pastille gauche (436..464 exclu à gauche de 436)
    // et la bande gauche (< 200) ; y au centre.
    expect(computeZone(RECT, 435, 300)).toBe('center');
    expect(computeZone(RECT, 500, 380)).toBe('center');
  });

  it('bandes de proximité des bords (20 %)', () => {
    expect(computeZone(RECT, 100, 300)).toBe('left'); // rx = 0.1
    expect(computeZone(RECT, 950, 300)).toBe('right'); // rx = 0.95
    expect(computeZone(RECT, 500, 50)).toBe('top'); // ry ≈ 0.083
    expect(computeZone(RECT, 500, 580)).toBe('bottom'); // ry ≈ 0.97
  });

  it('la pastille a priorité sur la bande de bord', () => {
    // Rect bas (60 px) : la pastille centre (cy ± 20) chevauche la bande
    // haute (ry < 0.2 → y < 12). En (500, 11) : pastille centre ET bande
    // haute — la pastille doit gagner.
    const short = { ...RECT, height: 60, bottom: 60 } as DOMRect;
    expect(computeZone(short, 500, 11)).toBe('center');
  });

  it('suppressEdges : toujours centre, y compris sur pastilles et bandes', () => {
    expect(computeZone(RECT, 500 - 44, 300, true)).toBe('center');
    expect(computeZone(RECT, 500, 300 + 44, true)).toBe('center');
    expect(computeZone(RECT, 100, 300, true)).toBe('center');
    expect(computeZone(RECT, 500, 580, true)).toBe('center');
    expect(computeZone(RECT, 500, 300, true)).toBe('center');
  });
});

describe('TabDragService', () => {
  let service: TabDragService;
  let section: HTMLElement;
  let content: HTMLElement;
  let strip: HTMLElement;
  let handle: HTMLElement;
  let outside: HTMLElement;

  beforeEach(() => {
    service = new TabDragService();

    section = document.createElement('section');
    section.dataset['dockGroup'] = 'g1';
    strip = document.createElement('div');
    strip.className = 'tab-strip';
    content = document.createElement('div');
    content.className = 'editor-content';
    section.append(strip, content);

    handle = document.createElement('div');
    handle.className = 'split-handle';
    outside = document.createElement('div');
    outside.className = 'shell-panel';

    document.body.append(section, handle, outside);

    // jsdom : ni layout ni elementFromPoint — on stubbe les deux.
    section.getBoundingClientRect = () => RECT;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function stubHit(element: Element | null): void {
    document.elementFromPoint = vi.fn().mockReturnValue(element);
  }

  it('ignore les mouvements quand aucun drag n’est en cours', () => {
    stubHit(content);
    service.updateFromPointer(500, 300);
    expect(service.target()).toBeNull();
  });

  it('pose la cible (groupe + zone) au-dessus d’un groupe', () => {
    service.start('tab-1', 'g0', false);
    stubHit(content);
    service.updateFromPointer(950, 300);
    expect(service.target()).toEqual({ groupId: 'g1', zone: 'right', edgeGuides: true });
  });

  it('efface la cible au-dessus d’une bande d’onglets ou hors de tout groupe', () => {
    service.start('tab-1', 'g0', false);
    stubHit(content);
    service.updateFromPointer(500, 300);
    expect(service.target()).not.toBeNull();

    stubHit(strip);
    service.updateFromPointer(500, 20);
    expect(service.target()).toBeNull();

    stubHit(content);
    service.updateFromPointer(500, 300);
    stubHit(outside);
    service.updateFromPointer(500, 700);
    expect(service.target()).toBeNull();
  });

  it('conserve la cible précédente en traversant une poignée de redimensionnement', () => {
    service.start('tab-1', 'g0', false);
    stubHit(content);
    service.updateFromPointer(500, 580);
    const before = service.target();
    expect(before?.zone).toBe('bottom');

    stubHit(handle);
    service.updateFromPointer(500, 599);
    expect(service.target()).toBe(before);
  });

  it('reste sans cible si le drag commence au-dessus d’une poignée', () => {
    service.start('tab-1', 'g0', false);
    stubHit(handle);
    service.updateFromPointer(500, 599);
    expect(service.target()).toBeNull();
  });

  it('onglet unique sur son propre groupe : zone centre, guides de bord masqués', () => {
    service.start('tab-1', 'g1', true);
    stubHit(content);
    service.updateFromPointer(950, 300); // bande droite → dégradée en centre
    expect(service.target()).toEqual({ groupId: 'g1', zone: 'center', edgeGuides: false });
  });

  it('onglet unique sur un AUTRE groupe : zones de bord actives', () => {
    service.start('tab-1', 'g0', true);
    stubHit(content);
    service.updateFromPointer(950, 300);
    expect(service.target()).toEqual({ groupId: 'g1', zone: 'right', edgeGuides: true });
  });

  it('groupe multi-onglets sur lui-même : zones de bord actives', () => {
    service.start('tab-1', 'g1', false);
    stubHit(content);
    service.updateFromPointer(100, 300);
    expect(service.target()).toEqual({ groupId: 'g1', zone: 'left', edgeGuides: true });
  });

  it('clear réinitialise le contexte de drag (source et onglet unique)', () => {
    service.start('tab-1', 'g1', true);
    service.clear();
    expect(service.dragging()).toBeNull();
    expect(service.target()).toBeNull();
    // Un nouveau drag depuis un autre groupe ne doit pas hériter du contexte.
    service.start('tab-2', 'g0', false);
    stubHit(content);
    service.updateFromPointer(950, 300);
    expect(service.target()?.zone).toBe('right');
  });
});
