import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  GenerateInvoicesRequestDto,
  GenerateInvoicesResponseDto
} from './invoicing.dto';

/**
 * Appels HTTP bruts vers `/api/Invoices` de Ref.Api. Le Bearer est posé par
 * l'intercepteur d'authentification ; le 409 de `generate` (génération déjà
 * en cours pour la période) remonte en `HttpErrorResponse` et est interprété
 * par `InvoiceGenerationService`, pas ici.
 */
@Injectable({ providedIn: 'root' })
export class InvoicingApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  /** Démarre la génération des factures d'une période (202 + jobId). */
  generate(request: GenerateInvoicesRequestDto): Promise<GenerateInvoicesResponseDto> {
    return firstValueFrom(
      this.http.post<GenerateInvoicesResponseDto>(
        `${this.baseUrl}/api/Invoices/generate`,
        request
      )
    );
  }

  /** Demande l'annulation coopérative d'un job (202 ; état final via le hub). */
  cancel(jobId: string): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(
        `${this.baseUrl}/api/Invoices/${encodeURIComponent(jobId)}/cancel`,
        {}
      )
    );
  }
}
