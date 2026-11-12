# Gordonite design concept 01

Open `gordonite-mockup.html` directly in a modern browser. It is a self-contained design mockup with inline styles, scripts and icons; no installation, internet connection or app server is required.

Direction: warm paper, dark ink, clay-orange accents, serif headings and a calm dashboard. Includes a dark theme, responsive phone navigation, an animated decorative orb, mood selection, task completion particles and a focus timer. Reduced-motion preferences disable decorative animations and transitions.

Try task checkboxes, the moon button, Catch a thought, search (Ctrl/Cmd+K), the navigation, sample note editing and the focus timer. The file and person cards open sample details. File uploads and actual app saving are not implemented. Sample content is fictional; edits and captured notes last only for the current page visit and reset on refresh. No requests are sent to Gordonite.

Validation: browser checks covered task progress, mood selection, theme switching, capture, search, timer controls and horizontal overflow at 390px and 320px. Desktop, dark-theme and phone screenshots were inspected. The formatting toolbar is a browser-native prototype; production integration should use Gordonite's existing Tiptap commands.

This is a separate design reference, not a change to the application or its deployed version. The static sample date is part of the concept. No schema, app data, deployment or network-access configuration changed.

# Workflow prototype 02 (2026-11-11)

`gordonite-workflows-prototype.html` is a clickable sketch of the proposed everyday flows (daily page, capture, task sheet, CSS as a project, meetings from transcripts, AI collaboration, search). Open it in a browser; a guide beside the phone lists seven walkthroughs with what happens in the app today and what is proposed. Content is fictional, nothing is saved and no request is sent to Gordonite. The reasoning is in `docs/REDESIGN-PROPOSAL-2026-11.md`. It is a design reference only: no application code, schema or version changed.

# Write-once prototype 03 (2026-11-11)

`gordonite-write-once-prototype.html` is the second, preferred direction: one thread you write into; names and projects link themselves; person and project pages are assembled from what was written; a one-screen debrief confirms what was noticed. The noticing of new people, tasks, promises and facts is a keyword sketch standing in for an AI. Fictional content, nothing saved, no requests sent. See "Direction 2" in `docs/REDESIGN-PROPOSAL-2026-11.md`.
