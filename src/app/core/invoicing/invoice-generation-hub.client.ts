import { Injectable } from '@angular/core';
import type { HubConnection } from '@microsoft/signalr';
import { environment } from '../../../environments/environment';

/** Méthode serveur -> client du hub `InvoiceGenerationHub` de Ref.Api. */
const PROGRESS_METHOD = 'InvoiceGenerationProgressChanged';

/** Méthodes client -> serveur d'abonnement au groupe d'un job. */
const SUBSCRIBE_METHOD = 'SubscribeToJob';
const UNSUBSCRIBE_METHOD = 'UnsubscribeFromJob';

type SignalRModule = typeof import('@microsoft/signalr');

export type InvoiceGenerationHubStatus = 'connected' | 'disconnected';

export interface InvoiceGenerationHubHandlers {
  /** Événement de progression reçu du serveur : payload NON FIABLE, à valider. */
  readonly onProgress: (payload: unknown) => void;
  /** Changement de connectivité (informative : pas de repli HTTP possible). */
  readonly onStatusChange: (status: InvoiceGenerationHubStatus) => void;
}

/**
 * Enveloppe minimale du hub SignalR `/hubs/invoice-generation`. Même patron
 * que `MaintenanceHubClient` (import dynamique de `@microsoft/signalr` pour
 * rester hors du bundle initial, reconnexion automatique, handlers en
 * callbacks pour la testabilité), avec une différence : le serveur diffuse
 * par groupe `invoice-job-{jobId}` — il faut invoquer `SubscribeToJob` pour
 * recevoir, et les groupes étant perdus à chaque reconnexion, l'abonnement
 * courant est ré-invoqué dans `onreconnected`.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceGenerationHubClient {
  private signalr: SignalRModule | null = null;
  private connection: HubConnection | null = null;
  private handlers: InvoiceGenerationHubHandlers | null = null;
  /** Job dont le groupe doit être rejoint (et rejoint à chaque reconnexion). */
  private currentJobId: string | null = null;

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
  async start(handlers?: InvoiceGenerationHubHandlers): Promise<boolean> {
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
      // Chunk indisponible : le suivi temps réel est perdu, le POST de
      // lancement reste possible — l'UI affichera « en attente de nouvelles ».
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
      // API injoignable, CORS refusé ou transport bloqué : l'appelant
      // retentera un démarrage au prochain lancement.
      return false;
    }
  }

  /**
   * Rejoint le groupe SignalR du job : obligatoire pour recevoir sa
   * progression. Mémorisé pour être rejoué à chaque reconnexion.
   * Retourne vrai si l'invocation a abouti.
   */
  async subscribeToJob(jobId: string): Promise<boolean> {
    this.currentJobId = jobId;
    if (!this.isConnected || !this.connection) {
      return false;
    }
    try {
      await this.connection.invoke(SUBSCRIBE_METHOD, jobId);
      return true;
    } catch {
      // Connexion perdue entre-temps : `onreconnected` rejouera l'abonnement.
      return false;
    }
  }

  /** Quitte le groupe du job (best-effort : plus rien n'est attendu). */
  async unsubscribeFromJob(jobId: string): Promise<void> {
    if (this.currentJobId === jobId) {
      this.currentJobId = null;
    }
    if (!this.isConnected || !this.connection) {
      return;
    }
    try {
      await this.connection.invoke(UNSUBSCRIBE_METHOD, jobId);
    } catch {
      // Sans effet : le serveur nettoie les groupes à la déconnexion.
    }
  }

  async stop(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.handlers = null;
    this.currentJobId = null;
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
    handlers: InvoiceGenerationHubHandlers
  ): HubConnection {
    const connection = new signalr.HubConnectionBuilder()
      .withUrl(`${environment.apiBaseUrl}/hubs/invoice-generation`)
      .withAutomaticReconnect()
      // Suivi non critique : on évite de polluer la console du renderer
      // quand l'API est arrêtée.
      .configureLogging(signalr.LogLevel.Error)
      .build();

    connection.on(PROGRESS_METHOD, (payload: unknown) =>
      handlers.onProgress(payload)
    );
    connection.onreconnected(async () => {
      // Les groupes SignalR sont perdus à chaque reconnexion : sans ce
      // réabonnement, plus aucun événement n'arriverait.
      if (this.currentJobId !== null) {
        try {
          await connection.invoke(SUBSCRIBE_METHOD, this.currentJobId);
        } catch {
          // Nouvelle coupure immédiate : le prochain onreconnected réessaiera.
        }
      }
      handlers.onStatusChange('connected');
    });
    connection.onreconnecting(() => handlers.onStatusChange('disconnected'));
    connection.onclose(() => handlers.onStatusChange('disconnected'));
    return connection;
  }
}
