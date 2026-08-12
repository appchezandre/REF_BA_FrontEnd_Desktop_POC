import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  MaintenanceNotificationDto,
  StartMaintenanceRequestDto
} from './maintenance.dto';

/** Préfixe des endpoints de maintenance (utilisé aussi par l'intercepteur). */
export const MAINTENANCE_ENDPOINT_PREFIX = '/api/maintenance';

/**
 * Appels HTTP bruts vers `/api/Maintenance` de Ref.Api. Ces endpoints sont
 * anonymes côté serveur : ils fonctionnent sans session, ce qui est nécessaire
 * puisque la maintenance doit aussi s'appliquer à l'écran de connexion et
 * survivre à la déconnexion forcée.
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  /** État courant : source autoritaire au démarrage et en repli du hub. */
  getState(): Promise<MaintenanceNotificationDto> {
    return firstValueFrom(
      this.http.get<MaintenanceNotificationDto>(`${this.baseUrl}/api/Maintenance`)
    );
  }

  start(request: StartMaintenanceRequestDto): Promise<MaintenanceNotificationDto> {
    return firstValueFrom(
      this.http.post<MaintenanceNotificationDto>(
        `${this.baseUrl}/api/Maintenance/start`,
        request
      )
    );
  }

  stop(): Promise<MaintenanceNotificationDto> {
    return firstValueFrom(
      this.http.post<MaintenanceNotificationDto>(
        `${this.baseUrl}/api/Maintenance/stop`,
        {}
      )
    );
  }
}
