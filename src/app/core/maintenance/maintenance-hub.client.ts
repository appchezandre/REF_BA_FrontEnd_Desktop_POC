import { Injectable } from '@angular/core';
import type { HubConnection } from '@microsoft/signalr';
import { environment } from '../../../environments/environment';

/** Méthode serveur -> client du hub `MaintenanceHub` de Ref.Api. */
const NOTIFICATION_METHOD = 'MaintenanceStateChanged';

type SignalRModule = typeof import('@microsoft/signalr');

export type MaintenanceHubStatus = 'connected' | 'disconnected';

export interface MaintenanceHubHandlers {
  /** Notification reçue du serveur : payload NON FIABLE, à valider. */
  readonly onNotification: (payload: unknown) => void;
  /** Changement de connectivité : arme ou désarme le repli par sondage. */
  readonly onStatusChange: (status: MaintenanceHubStatus) => void;
}

/**
 * Enveloppe minimale du hub SignalR `/hubs/maintenance` : le hub est
 * unidirectionnel (aucune méthode appelable par le client) et anonyme, donc
 * aucun token ne circule ici.
 *
 * `@microsoft/signalr` est chargé en import dynamique : le hub n'est pas
 * nécessaire au premier rendu et la bibliothèque reste hors du bundle initial.
 *
 * Le service de maintenance ne dépend que de cette façade, ce qui permet de le
 * tester sans réseau. La reconnexion automatique de SignalR couvre les
 * coupures courtes ; au-delà, `onStatusChange('disconnected')` laisse
 * l'appelant prendre le relais par sondage HTTP.
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceHubClient {
  private signalr: SignalRModule | null = null;
  private connection: HubConnection | null = null;
  private handlers: MaintenanceHubHandlers | null = null;

  get isConnected(): boolean {
    return (
      this.signalr !== null &&
      this.connection !== null &&
      this.connection.state === this.signalr.HubConnectionState.Connected
    );
  }

  /**
   * Démarre (ou redémarre après un échec) la connexion. Idempotent : sans
   * effet si une connexion est déjà établie ou en cours. Les gestionnaires
   * fournis au premier appel sont réutilisés par les suivants.
   * Retourne vrai si la connexion est établie.
   */
  async start(handlers?: MaintenanceHubHandlers): Promise<boolean> {
    if (handlers) {
      this.handlers = handlers;
    }
    if (!this.handlers) {
      return false;
    }

    let signalr: SignalRModule;
    try {
      signalr = this.signalr ??= await import('@microsoft/signalr');
    } catch {
      // Chunk indisponible : le repli par sondage HTTP suffit à connaître
      // l'état de maintenance, seul le temps réel est perdu.
      return false;
    }

    const { Connected, Disconnected } = signalr.HubConnectionState;
    if (this.connection && this.connection.state !== Disconnected) {
      return this.connection.state === Connected;
    }

    this.connection ??= this.build(signalr, this.handlers);
    try {
      await this.connection.start();
      return true;
    } catch {
      // API injoignable, CORS refusé ou transport bloqué : l'appelant se
      // rabat sur le sondage HTTP et retentera un démarrage plus tard.
      return false;
    }
  }

  async stop(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.handlers = null;
    if (!connection) {
      return;
    }
    try {
      await connection.stop();
    } catch {
      // Arrêt best-effort : la fenêtre se ferme, rien à récupérer.
    }
  }

  private build(
    signalr: SignalRModule,
    handlers: MaintenanceHubHandlers
  ): HubConnection {
    const connection = new signalr.HubConnectionBuilder()
      .withUrl(`${environment.apiBaseUrl}/hubs/maintenance`)
      .withAutomaticReconnect()
      // Le hub est facultatif au bon fonctionnement (repli HTTP) : on évite de
      // polluer la console du renderer quand l'API est arrêtée.
      .configureLogging(signalr.LogLevel.Error)
      .build();

    connection.on(NOTIFICATION_METHOD, (payload: unknown) =>
      handlers.onNotification(payload)
    );
    connection.onreconnected(() => handlers.onStatusChange('connected'));
    // Dès la perte de connexion (sans attendre l'abandon des tentatives de
    // reconnexion), le sondage prend le relais : l'état de maintenance doit
    // être connu au plus vite.
    connection.onreconnecting(() => handlers.onStatusChange('disconnected'));
    connection.onclose(() => handlers.onStatusChange('disconnected'));
    return connection;
  }
}
