import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';

type PanelView = 'problems' | 'output' | 'terminal';

interface PanelTab {
  readonly id: PanelView;
  readonly label: string;
}

/**
 * Panneau inférieur (style VSCode) : Problèmes / Sortie / Terminal.
 * Contenus de démonstration en attendant les intégrations réelles.
 */
@Component({
  selector: 'app-panel',
  templateUrl: './panel.html',
  styleUrl: './panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Panel {
  readonly closed = output<void>();

  protected readonly activeView = signal<PanelView>('problems');

  protected readonly tabs: readonly PanelTab[] = [
    { id: 'problems', label: 'Problèmes' },
    { id: 'output', label: 'Sortie' },
    { id: 'terminal', label: 'Terminal' }
  ];

  protected readonly outputLines: readonly string[] = [
    '[Info] Démarrage du shell Desktop App',
    '[Info] Contexte de fenêtre chargé',
    '[Info] Workspace initialisé — 1 groupe d’éditeurs',
    '[Info] En attente de la connexion à l’API métier…'
  ];
}
