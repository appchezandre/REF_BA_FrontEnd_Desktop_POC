/**
 * Contrats de `/api/Maintenance` et du hub `/hubs/maintenance` de Ref.Api
 * (record C# `MaintenanceNotification` sérialisé en camelCase).
 *
 * Cette forme est aussi celle publiée sur le bus inter-fenêtres : une seule
 * garde de type (`parseMaintenanceNotification`) couvre donc les trois sources
 * non fiables (HTTP, SignalR, IPC).
 */
export interface MaintenanceNotificationDto {
  readonly isUnderMaintenance: boolean;
  readonly delayMinutes: number;
  readonly message: string;
  readonly timestampUtc: string;
}

/** Corps de `POST /api/Maintenance/start` (les deux champs sont optionnels). */
export interface StartMaintenanceRequestDto {
  readonly delayMinutes?: number;
  readonly message?: string;
}
