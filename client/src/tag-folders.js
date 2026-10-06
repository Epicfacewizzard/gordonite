// Tags remain the source of truth. Intermediate folders need no saved tag of their own.
export function folderLabel(name) {
  // Numbered vault folders keep their familiar presentation, with tag IDs/paths unchanged.
  return /^\d{2}-/.test(name) ? name.replaceAll('-', ' ').replace(/\b[a-z]+/g, (word) => word === 'css' ? 'CSS' : word[0].toUpperCase() + word.slice(1)) : name;
}
export function folderPathLabel(path) { return path.split('/').map(folderLabel).join(' / '); }
export function tagFolders(tags) {
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
  const sorted = (nodes) => [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name)).map((n) => ({ ...n, children: sorted(n.children) }));
  return sorted(roots);
}
