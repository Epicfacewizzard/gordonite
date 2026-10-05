# Checklist for the Galaxy S24 (Chrome)

Automated tests cover the logic and desktop Chrome with touch emulation. **None of this has been run on a
phone.** Until you have gone through this list, do not treat mobile editing as validated. Tick each box, and
note the keyboard in use (Samsung Keyboard or Gboard) and the Chrome version.

Use the real address you will use every day (ideally the HTTPS one).

## Writing

- [ ] Open `daily-jots`. Tap the empty area of today's entry: **the keyboard opens** and a caret appears.
- [ ] Type a few sentences with autocorrect and predictions on. Accepting a suggestion, autocorrecting a word
      and swipe typing do not duplicate, drop or reorder text, and the caret stays where expected.
- [ ] While a word is underlined (composing), pause for 2-3 seconds. Nothing jumps; the word is not committed
      twice. (Autosave runs in the background during this.)
- [ ] Type long enough to fill the screen. **The line you are typing stays visible above the toolbar** and does
      not hide behind the keyboard, including at the bottom of a long note.
- [ ] Rotate to landscape and back with the keyboard open: caret and toolbar are still visible.
- [ ] Type an emoji (including one with skin tone), then Backspace: the whole emoji disappears, no broken
      characters, no error banner. Same for accented letters and, if you use one, another language.
- [ ] Paste text copied from a web page and from another app: only bold/italic/lists/headings survive.
- [ ] Select a word (double tap), drag the handles, apply **Bold** from the toolbar: the selection stays, the
      keyboard stays open, you can type straight afterwards.
- [ ] Undo / redo buttons and any keyboard undo gesture behave; undo after a pause removes only the last chunk.

## Tasks

- [ ] Put the caret in the middle of a line, tap the **task** button: the text, bold, and caret position are
      unchanged; keyboard stays open; you can keep typing at the caret.
- [ ] Tap **Undo once**: the line is plain text again, exactly as before. Redo returns the task.
- [ ] Press Enter in a task: a new, unchecked task. Enter on an empty task: back to plain text.
- [ ] On an empty line, tap Backspace at the start of a bullet/task: the bullet/task goes, the text stays.
- [ ] Tap a checkbox with the keyboard open: it ticks in place, **the keyboard stays open**, undo reverses it.
- [ ] Tap a checkbox on an *older* note: it ticks, nothing jumps.

## Saving and recovery

- [ ] Write, watch the badge go *Pending on phone* → *Saved on server*.
- [ ] Turn on **airplane mode** (or leave the VPN) and keep writing: badge says *Pending on phone · offline*.
      Close Chrome completely (swipe away from recents), reopen the address: **your text is there** with a
      pending badge. Reconnect: it becomes *Saved on server* without any action, and the note is not duplicated.
- [ ] Same, but lock the phone for a few minutes with an unsaved note, then unlock.
- [ ] Edit the same note on another device, then edit on the phone without refreshing: a **Conflict** panel
      appears, the phone text stays on screen, and each of the three buttons does what it says. The other
      version is in ⋯ → History.
- [ ] Check ⋯ → History after a few minutes of writing, and restore an old version.
- [ ] Delete a note → Trash → Restore.

## Layout and touch

- [ ] Toolbar buttons and checkboxes are easy to hit with a thumb; nothing is clipped at the 360 px width,
      including with Samsung's gesture navigation bar and with "display size" set larger.
- [ ] Tap another day's note: the keyboard opens there and the caret lands where you tapped.
- [ ] Leave the phone on the stream past midnight with the keyboard closed: the new day's entry appears.
      Do it again while typing: nothing moves, a "Start today's note" banner appears.
- [ ] Dark mode follows the phone setting.

## Things to tell me if they fail

Which keyboard, what you typed or tapped, and what happened. Screenshots help. The likely suspects are
(a) caret/selection handling around Android composition, (b) the keyboard-resize behaviour
(`interactive-widget=resizes-content` plus a visual-viewport fallback), and (c) whether tapping a read-only note
brings the keyboard up in one tap (Chrome may require an extra tap).
