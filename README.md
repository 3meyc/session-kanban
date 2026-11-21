# Session Kanban

A Claude Code mod that shows your desktop-app sessions as a Kanban board in a pane beside the chat, instead of the sidebar's tree.

- **Columns by status:** In progress, Today, Earlier, Archived, each on a pale tint of its colour.
- **Background work counts as running:** a session whose background shells or agents are still at work stays in In progress with a green dot, though the app shows it as idle once its turn ends.
- **Collapsible sections:** every section collapses to a thin rail (or a bar in the stacked layout) with its count. In progress starts collapsed when nothing is running, Archived starts collapsed, and Today and Earlier start open.
- **Cards:** a `#` button that copies the session id, the title with an open arrow (`→`), the sidebar section as a tag, time since last activity and branch underneath (selectable, so the branch can be copied), and a footer with Pin/Unpin and Archive, or Delete and Unarchive on archived cards, plus `Show {n} archived` / `Hide archived` when the card has archived sub-sessions.
- **Needs you:** a session whose last turn ended blocked on you gets an orange `●` before its title, and one that finished and waits for review a blue one, on a card or a sub-session line alike. The toolbar counts the blocked ones (`2 need you`).
- **Activity timeline:** under the time and branch, a strip of the last 7 days in bars of three hours, each as tall as how much the session wrote to its transcript then (or, in Settings, how many tokens it used), with a tick at each midnight. It shows the session's own activity; its sub-sessions are listed under it. The strip spans the card's width. Cards with nothing that week have none.
- **Heatmap:** above the sections, the last 7 days of every session shown, as a grid of days by hours across the board's width. Its rows follow the week's order from the first day of the week (Monday unless changed in Settings), each the most recent such day, with today's name brighter.
- **Pinned sessions** sort to the top of their column and carry a thin coloured bar on the left.
- **The session you are in** (the one the board runs in) is filled in a stronger shade of its column, as a card or as a sub-session line.
- **Sub-sessions** (sessions Claude started from another, or forks) are listed inside their parent's card as a task list; archived ones show only after that card's `Show {n} archived` (each card remembers its own choice), and Archived counts them beside its own cards (`Archived 3 · 20 sub-sessions`), and the sub-sessions of a hidden one move up a level, so a running one is never hidden.
- **Toolbar:** a search box (title, branch or section), filter by sidebar section, how many sessions to load (25, 50, 100, All; archived sessions are looked further back, up to eight times that, when archived sub-sessions crowd them out), This week, Show routines (routine runs are tagged with their run date), Refresh.
- **Settings** open in a pane of their own (Esc closes it), or, picked there under Settings in, as a block under the toolbar, in sections with a line between them:
  - **Board:** layout (stacked in one column with In progress on top, the default, or status columns side by side); titles on one line or multiline; square or rounded cards; whether the board opens by itself in sub-sessions (off by default).
  - **Timelines:** what the timelines and heatmap measure (activity, tokens, or hidden); the first day of the week.
  - **Command buttons:** Show functional buttons, and the commands: three fields to start with, and up to twelve with **+ Add command**.
  - **Settings:** where they show.

  A choice in a list takes effect at once. Typed commands wait for **Apply** (or Enter in their field), which keeps the settings open.
- **Command buttons:** with Show functional buttons on in Settings, a row above the prompt holds up to twelve buttons, one for each command Settings gives it. A slash command (`/plugin:command args`) runs as if you typed it, and its button sits in a blue frame. Anything else is put in the prompt box, replacing what is there, for you to send with Enter: a prompt the board sent itself would reach Claude as the board's, not yours, and Claude rightly refuses to push or delete on it. Empty ones are left out, and a button shows its command's name (`close-out`). Slash commands line up on the left and prompts on the right, each in the order Settings lists them. A green **K** at the right end always opens or closes the board, as `/kanban` does. It is there in every session, whether or not the board is open.
- **Choices carry over:** settings, the toolbar's section filter, Load, This week and Show routines, which sections are open, and each card's `Show {n} archived` are saved, so a new session's board starts as you left the last one. The search text is not kept.
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

The pane opens when a root session starts; a sub-session (one Claude started from another, or a fork) leaves it closed and does not refresh it until you open it. `/kanban` toggles it: it closes the board when it or its settings pane is showing, closing the settings pane along with it, and opens it (or brings it forward from behind another tab) otherwise.

```
/kanban
```

The app's toolbar takes no buttons from mods, so the command is the toggle.

## Limits

- **Auto mode refuses the card actions.** Its safety check only lets through actions you asked for in chat, so Pin, Archive and Unarchive are refused there. The board then puts the request in the prompt box for you to send, or tells you what to ask. In the Default permission mode the app shows its own approval card instead. Delete always asks for approval first.
- **Brief disconnects:** after the Mac wakes, the app's tools take a moment to reconnect. The board keeps the last cards, says how old they are, and retries after 5, 15 and 30 seconds; only a disconnect lasting over 3 minutes, or any other error, shows a red banner with the details.
- **No split view from the board:** the app shows a session beside another only if that session started it, so the board only switches to a session. To split, right-click a session in the sidebar and choose Open in → Split view.
- **Command buttons wait their turn:** a slash command pressed while Claude is working runs once the session is idle. A command the session does not know shows a toast instead. In Auto mode, steps a pressed command asks for may be refused like the card actions, since the board, not you, started it.
- **Finished toasts have no Open button:** toasts carry text only.
- **Background work is read from local files:** the board looks at each live session's own records under `~/.claude` (with `/bin/sh`, `grep` and `awk`), so it sees background shells and agents of sessions on this Mac only, not of remote or cloud sessions.
- **Needs you, timelines and the heatmap read the app's private files:** the app's own record of each session (under `~/Library/Application Support/Claude`) holds its summary of the last turn and names its transcript under `~/.claude/projects`. Neither is a published interface, so an app update can leave them empty. Only sessions active in the last 7 days are read, and only on this Mac: other machines and the cloud have none. The terminal draws no SVG, so it shows the dots but no timelines or heatmap.
- **No tooltips or popovers:** the drawings are plain pictures, and a mod has no popover or menu to show details in.
- **Tokens** add up input, cache writes, cache reads and output for each reply, so a long conversation counts its context again on every reply.
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
