import {
  EditorGroup,
  GroupLayout,
  SplitDirection,
  WorkspaceLayout
} from '../../shared/models/workspace';

/**
 * Fonctions pures de manipulation de l'arbre de layout.
 * Toutes préservent les références des sous-arbres non modifiés (OnPush).
 */

export function groupLeaf(group: EditorGroup): GroupLayout {
  return { kind: 'group', group };
}

/** Feuilles de l'arbre, de gauche à droite (parcours en profondeur). */
export function collectGroups(layout: WorkspaceLayout): readonly EditorGroup[] {
  if (layout.kind === 'group') {
    return [layout.group];
  }
  return [...collectGroups(layout.first), ...collectGroups(layout.second)];
}

/** Applique une transformation à chaque groupe (feuille) de l'arbre. */
export function mapGroups(
  layout: WorkspaceLayout,
  transform: (group: EditorGroup) => EditorGroup
): WorkspaceLayout {
  if (layout.kind === 'group') {
    const next = transform(layout.group);
    return next === layout.group ? layout : { ...layout, group: next };
  }
  const first = mapGroups(layout.first, transform);
  const second = mapGroups(layout.second, transform);
  if (first === layout.first && second === layout.second) {
    return layout;
  }
  return { ...layout, first, second };
}

/**
 * Remplace la feuille `groupId` par un nœud split (à parts égales) contenant
 * cette feuille et `newLeaf`. `newLeafFirst` place la nouvelle feuille en
 * premier enfant (dock à gauche / en haut) ou en second (droite / bas).
 */
export function splitGroup(
  layout: WorkspaceLayout,
  groupId: string,
  direction: SplitDirection,
  newLeaf: GroupLayout,
  splitId: string,
  newLeafFirst = false
): WorkspaceLayout {
  if (layout.kind === 'group') {
    if (layout.group.id !== groupId) {
      return layout;
    }
    return {
      kind: 'split',
      id: splitId,
      direction,
      ratio: 0.5,
      first: newLeafFirst ? newLeaf : layout,
      second: newLeafFirst ? layout : newLeaf
    };
  }
  const first = splitGroup(layout.first, groupId, direction, newLeaf, splitId, newLeafFirst);
  const second = splitGroup(layout.second, groupId, direction, newLeaf, splitId, newLeafFirst);
  if (first === layout.first && second === layout.second) {
    return layout;
  }
  return { ...layout, first, second };
}

/**
 * Retire la feuille `groupId` de l'arbre : son nœud split parent est remplacé
 * par le frère, qui occupe alors tout l'espace du split disparu.
 * Retourne `null` si le layout entier était cette feuille.
 */
export function removeGroup(
  layout: WorkspaceLayout,
  groupId: string
): WorkspaceLayout | null {
  if (layout.kind === 'group') {
    return layout.group.id === groupId ? null : layout;
  }
  const first = removeGroup(layout.first, groupId);
  if (first === null) {
    return layout.second;
  }
  const second = removeGroup(layout.second, groupId);
  if (second === null) {
    return layout.first;
  }
  if (first === layout.first && second === layout.second) {
    return layout;
  }
  return { ...layout, first, second };
}

/** Met à jour le ratio d'un nœud split (déjà borné par l'appelant). */
export function setSplitRatio(
  layout: WorkspaceLayout,
  splitId: string,
  ratio: number
): WorkspaceLayout {
  if (layout.kind === 'group') {
    return layout;
  }
  if (layout.id === splitId) {
    return { ...layout, ratio };
  }
  const first = setSplitRatio(layout.first, splitId, ratio);
  const second = setSplitRatio(layout.second, splitId, ratio);
  if (first === layout.first && second === layout.second) {
    return layout;
  }
  return { ...layout, first, second };
}
