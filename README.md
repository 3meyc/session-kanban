# Session Kanban

A Claude Code mod that shows your desktop-app sessions as a Kanban board in a pane beside the chat, instead of the sidebar's tree.

- **Columns by status:** In progress, Today, Earlier, Archived, each on a pale tint of its colour.
- **Background work counts as running:** a session whose background shells or agents are still at work stays in In progress with a green dot, though the app shows it as idle once its turn ends.
- **Collapsible sections:** every section collapses to a thin rail (or a bar in the stacked layout) with its count. In progress starts collapsed when nothing is running, Archived starts collapsed, and Today and Earlier start open.
- **Cards:** a `#` button that copies the session id, the title with an open arrow (`→`), the sidebar section as a tag, time since last activity and branch underneath (selectable, so the branch can be copied), and a footer with Pin/Unpin and Archive, or Delete and Unarchive on archived cards.
- **Pinned sessions** sort to the top of their column and carry a thin coloured bar on the left.
- **The session you are in** (the one the board runs in) is filled in a stronger shade of its column, as a card or as a sub-session line.
- **Sub-sessions** (sessions Claude started from another, or forks) are listed inside their parent's card as a task list; archived ones show only while the Archived column is open, and the sub-sessions of a hidden one move up a level, so a running one is never hidden.
- **Toolbar:** a search box (title, branch or section), filter by sidebar section, how many sessions to load (25, 50, 100, All; archived sessions are looked further back, up to eight times that, when archived sub-sessions crowd them out), This week, Show routines (routine runs are tagged with their run date), Refresh.
- **Settings:** layout (stacked in one column with In progress on top, the default, or status columns side by side); titles on one line or multiline; square or rounded cards.
- **Finished toasts:** when a session stops running, the board shows a toast naming it.

The board refreshes every 30 seconds.

## Requirements

- The **Claude desktop app** (Code tab). The board reads the app's own session list, so it shows nothing in a plain terminal session.
- **macOS** to open a session from a card: it uses the `open` command with the session's app link.

## Install

At the prompt of a terminal session:

```
/plugin install session-kanban --marketplace 3meyc/session-kanban
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install session-kanban --marketplace 3meyc/session-kanban
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `3meyc/session-kanban`, then **Add plugin**.

## Use

The pane opens when a session starts. `/kanban` toggles it: it closes the board when it is showing, and opens it (or brings it forward from behind another tab) otherwise.

```
/kanban
```

The app's toolbar takes no buttons from mods, so the command is the toggle.

## Limits

- **Auto mode refuses the card actions.** Its safety check only lets through actions you asked for in chat, so Pin, Archive and Unarchive are refused there. The board then puts the request in the prompt box for you to send, or tells you what to ask. In the Default permission mode the app shows its own approval card instead. Delete always asks for approval first.
- **Brief disconnects:** after the Mac wakes, the app's tools take a moment to reconnect. The board keeps the last cards, says how old they are, and retries after 5, 15 and 30 seconds; only a disconnect lasting over 3 minutes, or any other error, shows a red banner with the details.
- **No "needs input" status:** the app's session list does not report whether a session is waiting for you.
- **No split view from the board:** the app shows a session beside another only if that session started it, so the board only switches to a session. To split, right-click a session in the sidebar and choose Open in → Split view.
- **Finished toasts have no Open button:** toasts carry text only.
- **Background work is read from local files:** the board looks at each live session's own records under `~/.claude` (with `/bin/sh`, `grep` and `awk`), so it sees background shells and agents of sessions on this Mac only, not of remote or cloud sessions.
- **Routines** are recognised by looking each session up once; on a first load an older routine run can show for a minute until its lookup returns.
- **Icons are Unicode characters:** buttons take only text, so icon sets such as Lucide cannot be used on them.

## Develop

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

To run a working copy in a session, start it with `claude --plugin-dir <this folder>`.
