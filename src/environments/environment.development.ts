/**
 * Environnement de développement (`ng serve`, `npm run electron:dev`).
 * Ref.Api en dev écoute sur http://localhost:5064 (profil « http ») et
 * https://localhost:3000 ; le HTTP évite les erreurs de certificat dev
 * dans Electron. CORS côté API autorise déjà http://localhost:4200.
 */
export const environment = {
  production: false,
  /** URL de base de l'API métier Ref.Api, sans slash final. */
  apiBaseUrl: 'http://localhost:5064'
};
