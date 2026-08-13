import { TestBed } from '@angular/core/testing';
import { CDK_DROP_LIST_GROUP } from '@angular/cdk/drag-drop';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTab } from '../../shared/models/workspace';
import { TabContent } from './tab-content';

describe('TabContent — isolation du groupe CDK de l’éditeur', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabContent]
    }).compileComponents();
  });

  it('coupe l’héritage de CDK_DROP_LIST_GROUP pour le contenu métier', async () => {
    const fixture = TestBed.createComponent(TabContent);
    // Type welcome : seul WelcomeView s'instancie (pas de page @defer).
    fixture.componentRef.setInput('tab', createTab({ type: 'welcome', title: 'Bienvenue' }));
    await fixture.whenStable();

    // Tout cdkDropList d'un écran métier doit résoudre null (et non le
    // cdkDropListGroup de l'éditeur) via l'injecteur d'élément.
    expect(fixture.debugElement.injector.get(CDK_DROP_LIST_GROUP, 'absent')).toBeNull();
  });
});
