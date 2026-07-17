import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { ActivityView } from '../../core/shell/shell-ui.service';

export type { ActivityView };

interface ActivityItem {
  readonly id: ActivityView;
  readonly label: string;
}

/** Barre d'activité verticale (style VSCode) : sélection du panneau latéral. */
@Component({
  selector: 'app-activity-bar',
  templateUrl: './activity-bar.html',
  styleUrl: './activity-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityBar {
  private readonly store = inject(WorkspaceStore);

  readonly active = input.required<ActivityView>();
  readonly sidebarVisible = input.required<boolean>();
  readonly selected = output<ActivityView>();

  protected readonly items: readonly ActivityItem[] = [
    { id: 'explorer', label: 'Explorateur' },
    { id: 'search', label: 'Rechercher' }
  ];

  protected isActive(id: ActivityView): boolean {
    return this.active() === id && this.sidebarVisible();
  }

  protected openSettings(): void {
    this.store.openTab({ type: 'settings', title: 'Paramètres' });
  }
}
