/** Corps de `POST /api/Invoices/generate`. */
export interface GenerateInvoicesRequestDto {
  readonly year: number;
  readonly month: number;
}

/**
 * Réponse de `POST /api/Invoices/generate` : corps du 202 (génération
 * démarrée) ET du 409 (une génération est déjà en cours pour la période ;
 * `jobId` identifie alors le run existant, dont on reprend le suivi).
 */
export interface GenerateInvoicesResponseDto {
  readonly jobId: string;
  readonly message: string;
}

/**
 * Payload de l'événement hub `InvoiceGenerationProgressChanged`
 * (camelCase, enum `status` en nombre — convention System.Text.Json de Ref.Api).
 */
export interface InvoiceGenerationProgressDto {
  readonly jobId: string;
  /** 0 Started, 1 Running, 2 Completed, 3 Failed, 4 Cancelled. */
  readonly status: number;
  readonly processed: number;
  readonly total: number;
  readonly message: string | null;
  readonly timestampUtc: string;
}
