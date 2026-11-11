// Plain-name mentions on this device (see docs/LINKS.md): the matcher for the people the phone knows about, built from
// the same people list the People page uses (which has an offline copy). Until that list has arrived there is no
// matcher and names stay plain text; the screens that use it re-draw when it comes.
import { useEffect, useState } from 'preact/hooks';
import { loadPeople, peopleState, subscribePeople } from './people-data.js';
import { buildMentionMatcher } from '../../shared/mentions.js';
import { linkTitle, wikiLinks } from '../../shared/wiki-links.js';

let built = { signature: null, matcher: null, people: [] };

/** The people as { id, title, aliases }, and the matcher over them; null until the list has loaded. The same object while nobody changed. */
export function currentMentions() {
  const state = peopleState();
  if (!state.loaded) return null;
  const people = state.people.filter((p) => p.title).map((p) => ({ id: p.noteId, title: p.title, aliases: p.profile?.aliases ?? [] }));
  const signature = JSON.stringify(people);
  if (signature !== built.signature) built = { signature, matcher: buildMentionMatcher(people), people };
  return built;
}

/** { people, matcher } (or null while the people list is loading), re-read whenever the people list changes. */
export function useMentions() {
  const [, again] = useState(0);
  useEffect(() => {
    const stop = subscribePeople(() => again((n) => n + 1));
    if (!peopleState().loaded) loadPeople();
    return stop;
  }, []);
  return currentMentions();
}

/** Just the matcher (null until the people list has loaded): what drawing a note's text needs. */
export const useMentionMatcher = () => useMentions()?.matcher ?? null;

/** The ids of the people a text names, by plain name or [[link]] (a link names a title or an "Also called" name), in order of appearance. */
export function peopleInText(text, mentions) {
  if (!mentions) return [];
  const hits = mentions.matcher(text).map((m) => ({ at: m.from, id: m.id }));
  for (const link of wikiLinks(text)) {
    const name = linkTitle(link.target).toLowerCase();
    const person = mentions.people.find((p) => p.title.toLowerCase() === name) ?? mentions.people.find((p) => p.aliases.some((a) => a.toLowerCase() === name));
    if (person) hits.push({ at: link.from, id: person.id });
  }
  return [...new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.id))];
}
