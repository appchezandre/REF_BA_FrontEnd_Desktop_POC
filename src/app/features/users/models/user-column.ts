/**
 * Description des colonnes de la table Utilisateurs : identité, libellé et
 * options de présentation. L'ordre et la visibilité effectifs sont pilotés
 * par l'instance d'écran (UsersScreenStore), pas ici.
 */

/** Identifiant stable d'une colonne de données déplaçable / masquable. */
export type UserColumnId = 'id' | 'name' | 'email' | 'status' | 'createdAt' | 'updatedAt';

export interface UserColumnDef {
  readonly id: UserColumnId;
  readonly label: string;
  /** Alignement à droite + chiffres tabulaires (colonnes numériques). */
  readonly numeric?: boolean;
  /** Police à chasse fixe (identifiants). */
  readonly mono?: boolean;
  /** Largeur par défaut en pixels (point de départ ; l'utilisateur peut
   *  redimensionner, l'override vivant dans l'instance d'écran). */
  readonly width: number;
}

/** Définition de chaque colonne (les colonnes structurelles état/actions
 *  restent en dehors de ce registre : ni déplaçables ni masquables). */
export const USER_COLUMN_DEFS: Record<UserColumnId, UserColumnDef> = {
  id: { id: 'id', label: 'Id', numeric: true, mono: true, width: 70 },
  name: { id: 'name', label: 'Nom', width: 200 },
  email: { id: 'email', label: 'E-mail', mono: true, width: 240 },
  status: { id: 'status', label: 'Statut', width: 110 },
  createdAt: { id: 'createdAt', label: 'Créé le', width: 130 },
  updatedAt: { id: 'updatedAt', label: 'Modifié le', width: 130 }
};

/** Ordre d'affichage par défaut des colonnes. */
export const DEFAULT_USER_COLUMNS: readonly UserColumnId[] = [
  'id',
  'name',
  'email',
  'status',
  'createdAt',
  'updatedAt'
];

export function isUserColumnId(value: unknown): value is UserColumnId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(USER_COLUMN_DEFS, value);
}
