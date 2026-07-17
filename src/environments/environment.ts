/**
 * Environnement par défaut (build production, cf. angular.json).
 * L'URL de l'API déployée devra remplacer localhost lors de la mise en place
 * d'un vrai déploiement (aucune infrastructure cible définie à ce jour).
 */
export const environment = {
  production: true,
  /** URL de base de l'API métier Ref.Api, sans slash final. */
  apiBaseUrl: 'http://localhost:5064'
};
