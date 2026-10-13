// A guard for lists that load more.
//
// "Load more" can be tapped twice before the first answer arrives. Both taps then ask for the same page and the same
// rows are added twice. Two rules prevent it, and each list keeps its own paging (notes by offset, streams by whole
// days): only one request for the next page runs at a time (each list keeps that flag itself, because it also
// disables its button), and rows are added by id, so a page that overlaps what is already there changes nothing.

/** `list` with the items of `incoming` added at the end, leaving out any whose id is already there (or repeated). */
export function appendUnique(list, incoming, idOf = (item) => item.id) {
  const seen = new Set(list.map(idOf));
  const added = [];
  for (const item of incoming) {
    const id = idOf(item);
    if (seen.has(id)) continue;
    seen.add(id);
    added.push(item);
  }
  return added.length ? [...list, ...added] : list;
}
