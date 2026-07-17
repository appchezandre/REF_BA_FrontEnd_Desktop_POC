import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthResponseDto, LoginRequestDto, RefreshRequestDto } from './auth.dto';

/**
 * Appels HTTP bruts vers `/api/auth/*` de Ref.Api. Ces endpoints sont
 * anonymes : l'intercepteur d'auth les exclut (pas de Bearer, pas de
 * tentative de refresh sur 401 — évite toute boucle).
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  login(request: LoginRequestDto): Promise<AuthResponseDto> {
    return firstValueFrom(
      this.http.post<AuthResponseDto>(`${this.baseUrl}/api/auth/login`, request)
    );
  }

  refresh(request: RefreshRequestDto): Promise<AuthResponseDto> {
    return firstValueFrom(
      this.http.post<AuthResponseDto>(`${this.baseUrl}/api/auth/refresh`, request)
    );
  }

  /** Révoque le refresh token côté serveur (204, idempotent). */
  async revoke(request: RefreshRequestDto): Promise<void> {
    await firstValueFrom(this.http.post<void>(`${this.baseUrl}/api/auth/revoke`, request));
  }
}
