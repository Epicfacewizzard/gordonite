// Tags remain the source of truth. Intermediate folders need no saved tag of their own.
export function folderLabel(name) {
  // Numbered vault folders keep their familiar presentation, with tag IDs/paths unchanged.
  return /^\d{2}-/.test(name) ? name.replaceAll('-', ' ').replace(/\b[a-z]+/g, (word) => word === 'css' ? 'CSS' : word[0].toUpperCase() + word.slice(1)) : name;
}
export function folderPathLabel(path) { return path.split('/').map(folderLabel).join(' / '); }
// `order` is the saved manual order, {parentPath: [childName, ...]} with '' for the top level. Children named in it
// come first in that order; the rest follow alphabetically.
export function tagFolders(tags, order = {}) {
  const roots = new Map();
  for (const tag of tags) {
    let children = roots;
    let path = '';
    for (const name of tag.path.split('/')) {
      path = path ? `${path}/${name}` : name;
      if (!children.has(name)) children.set(name, { name, path, children: new Map() });
      children = children.get(name).children;
    }
  }
  const sorted = (nodes, parent) => {
    const saved = Array.isArray(order[parent]) ? order[parent] : [];
    const rank = (n) => { const i = saved.indexOf(n.name); return i < 0 ? Infinity : i; };
    return [...nodes.values()]
      .sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name))
      .map((n) => ({ ...n, children: sorted(n.children, n.path) }));
  };
  return sorted(roots, '');
}
// Where `from` would end up if dropped at `target` ('into' | 'before' | 'after') in this tree, or null if that is
// not a valid or useful move. `into` is the new parent path ('' = top level), `order` the names inside it.
export function planMove(folders, from, target, position) {
  const find = (nodes, parent, path) => {
    for (const n of nodes) {
      if (n.path === path) return { node: n, parent, siblings: nodes };
      const hit = find(n.children, n.path, path);
      if (hit) return hit;
    }
    return null;
  };
  const leaf = from.split('/').at(-1);
  if (target === '') {
    const names = folders.map((n) => n.name).filter((n) => n !== leaf);
    return { into: '', order: [...names, leaf] };
  }
  if (target === from || target.startsWith(`${from}/`)) return null;
  const hit = find(folders, '', target);
  if (!hit) return null;
  if (position === 'into') {
    const names = hit.node.children.map((n) => n.name).filter((n) => n !== leaf);
    return { into: target, order: [...names, leaf] };
  }
  const names = hit.siblings.map((n) => n.name).filter((n) => n !== leaf);
  const at = names.indexOf(hit.node.name) + (position === 'after' ? 1 : 0);
  names.splice(at, 0, leaf);
  return { into: hit.parent, order: names };
}
