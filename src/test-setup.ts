/**
 * Mise en place commune des tests unitaires (Vitest).
 *
 * Combleuses d'API du DOM absentes de l'environnement de test mais toujours
 * présentes dans Chromium (donc dans le renderer Electron). Sans elles, un test
 * qui monte le shell échoue sur une erreur non gérée alors que le code est
 * correct en production.
 */

// Utilisé par `EditorGroupPane.scrollActiveIntoView` (bande d'onglets).
Element.prototype.scrollIntoView ??= function scrollIntoView(): void {
  // Pas de disposition calculée en test : aucun défilement à simuler.
};

// Utilisé par `EditorGroupPane.scrollTabs` (chevrons de défilement).
Element.prototype.scrollBy ??= function scrollBy(): void {
  /* idem */
};
