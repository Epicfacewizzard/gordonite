# Personal CRM preview

Interactive personal CRM concept for Gordonite. Branch: `codex/personal-crm-preview`. This is a preview for discussion and future implementation, not an integrated CRM feature or a deployment.

Open `personal-crm.html` directly in Chrome or Edge. The HTML is self-contained, with Gordonite 0.8.1's existing stylesheet embedded plus scoped CRM styling. No server, installation, account, remote fonts or other assets are needed.

## Try it

- Select one of six fictional people; search names, interests and context.
- Filter friends, family, school or work; select due follow-ups or suggested catch-ups.
- Log a conversation with its date and channel, optionally planning the next follow-up.
- Edit person notes, profile fields, birthday and optional keep-in-touch cadence.
- Plan, complete or postpone a follow-up. Completing one does not update last contact; only logging an interaction does.
- Expand About this concept & backup to copy or restore JSON, or reset the fictional demo.

The footer navigation explains that other app screens are outside this static concept. Light and dark themes follow the browser/system. All content is fictional; no personal notes or contacts were imported, and no messages are sent.

## Intended implementation

Gordonite already represents people as ordinary person notes. Preserve that as the source of truth rather than adding a separate contact database.

The useful additions would be conversation history; normal dated tasks linked to people as follow-ups; optional catch-up suggestions; birthdays and context; and backlinks from journal entries, meeting notes, projects and files.

This preview supports one pending follow-up per person. Replacing it is stated in the form. Completed follow-ups are removed here, whereas a production implementation should retain them through the existing task history. Contact import, notifications, calendar connections, linked notes, automatic messaging and server sync are not implemented.

## Data and recovery

Data is stored only in this browser under `gordonite-personal-crm-concept-v1`, separate from Gordonite and the habit experiment. Keep this file at the same path and use the same browser profile to retain that browser copy. Moving the file, changing browsers or clearing site data may make it unavailable.

Copy the JSON from Show backup into a plain text .json file before clearing browser data or moving the file. Restore by pasting the saved JSON and confirming replacement. Invalid backups do not replace data. Reset fictional demo also requires confirmation.

Storage errors produce a visible warning and keep edits in the tab. Unreadable stored data is not overwritten. Another tab's changes pause saving in this tab and request a reload or backup. There is no transactional multi-user storage. Limits: 200 people, 2,000 conversations per person and a 5 MB pasted backup.

## Verification

With repository dependencies available, run:

```sh
node design/personal-crm-preview/verify-crm.mjs
```

The verifier uses an installed Chrome and an isolated Playwright browser context, without contacting Gordonite. Passed checks cover search and group/status filters; follow-up completion without last-contact changes; conversation logging; date and partial follow-up validation; persistence after reload; notes and profile editing; new people; birthday validation including leap day; escaped user text; JSON backup/restore; invalid backup preservation; demo reset; visible storage failure; 320/390px phone layouts; and dark mode. No page errors or HTTP requests were observed. Generated screenshots are ignored and contain fictional data.

## Repository scope

Based on 0.8.1 at `2aa20c3`, matching the stylesheet used to create the concept. The branch version is `0.8.2-crm-preview.1` to follow the repository's versioning rule. Only preview artifacts, documentation and version identifiers are changed; the normal client UI, data schema, network configuration and Docker tag are unchanged. The habit-tracker beta remains on its own branch. Nothing has been deployed.
