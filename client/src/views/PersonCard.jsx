import { useBacklinks, Backlinks } from './Backlinks.jsx';
import { usePeople } from './PersonProfile.jsx';
import { PersonTasks } from './PersonTasks.jsx';
import { formatDateLabel } from '../../../shared/dates.js';

// "Who is this again?": the card at the top of a person's page. How and when you met, the last time they were written
// about (the newest note that mentions them, with the line that does), what to remember, and what is open with them.
// Under it, everything written about them. Everything is read from what already exists; nothing is stored for the card.
export function PersonCard({ noteId, name, today, revision }) {
  const people = usePeople();
  const profile = people.profileOf(noteId);
  const state = useBacklinks(revision > 0 ? noteId : null, revision);
  const newest = state?.backlinks?.[0] ?? null;
  const met = [profile.howMet, profile.metWhen].filter(Boolean).join(' · ');
  const rows = [
    met && ['Met', met, 'met'],
    newest && ['Last time', `${formatDateLabel(newest.date, today)}${newest.lines[0] ? `: ${newest.lines[0]}` : ''}`, 'last'],
    profile.remember.length > 0 && ['Remember', profile.remember.join(' · '), 'remember'],
  ].filter(Boolean);
  return (
    <>
      <div class="person-who" data-testid="person-card">
        <dl class="person-who-facts">
          {rows.map(([label, value, key]) => (
            <div key={key} data-testid={`person-card-${key}`}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {rows.length === 0 && state && people.loaded && <p class="muted small">Nothing about {name || 'them'} yet. Write their name in a note and it shows up here.</p>}
        <PersonTasks noteId={noteId} today={today} />
      </div>
      {state && <Backlinks noteId={noteId} title={name} person today={today} revision={revision} state={state} />}
    </>
  );
}
