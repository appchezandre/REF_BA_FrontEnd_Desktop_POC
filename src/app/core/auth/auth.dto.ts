/**
 * Contrats HTTP de l'API d'authentification Ref.Api (`/api/auth/*`).
 * Casing JSON : camelCase (sérialisation ASP.NET Core par défaut).
 */

export interface LoginRequestDto {
  readonly email: string;
  readonly password: string;
}

/** Corps commun aux endpoints `refresh` et `revoke`. */
export interface RefreshRequestDto {
  readonly refreshToken: string;
}

/**
 * Réponse de `login` et `refresh`. Le refresh token est une valeur opaque
 * avec rotation : chaque refresh invalide l'ancien, toujours remplacer les
 * deux tokens. Les dates sont des ISO 8601 UTC.
 */
export interface AuthResponseDto {
  readonly accessToken: string;
  readonly accessTokenExpiresAtUtc: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAtUtc: string;
}
