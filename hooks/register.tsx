import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Card, CornerStyle, Detail, Failure, TitleMode } from '../types'

const PANE = 'session-kanban'
const TITLE = 'Sessions board'
const POLL_MS = 30_000
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
// Archived sessions pile up forever; the Archived column only needs the recent tail.
const ARCHIVED_SHOWN = 12
const CARDS_PER_COLUMN = 30
const MIN_COLUMN_WIDTH = 24
const RAIL_WIDTH = 4
// get_session is one call per session; the first load spreads them over a few refreshes.
const DETAILS_PER_REFRESH = 40
const DEFAULT_COUNT = 25
const COUNT_OPTIONS = ['25', '50', '100', 'all']
// "All" asks for more than anyone has; the halving in fetchList trims it to what fits.
const ALL_LIMIT = 1000
// A plain Button draws its label this far in; text beside it is indented to match.
const BUTTON_INSET = 'xs'

// Bump a tag when its type's fields change: it declines what an earlier version
// stored, which outlives a reload.
const cards = atom({ plugin: 'session-kanban', key: 'cards' } as const, [], { shape: 'cards-4' })
const details = atom({ plugin: 'session-kanban', key: 'details' } as const, {}, { shape: 'details-1' })
const filter = atom({ plugin: 'session-kanban', key: 'filter' } as const, 'all')
const isThisWeek = atom({ plugin: 'session-kanban', key: 'isThisWeek' } as const, false)
const isRoutinesShown = atom({ plugin: 'session-kanban', key: 'isRoutinesShown' } as const, false)
const isArchivedOpen = atom({ plugin: 'session-kanban', key: 'isArchivedOpen' } as const, false)
const isProgressOpen = atom({ plugin: 'session-kanban', key: 'isProgressOpen' } as const, false)
const isSettingsOpen = atom({ plugin: 'session-kanban', key: 'isSettingsOpen' } as const, false)
const loadCount = atom({ plugin: 'session-kanban', key: 'loadCount' } as const, String(DEFAULT_COUNT))
const titleMode = atom({ plugin: 'session-kanban', key: 'titleMode' } as const, 'ellipsis' as TitleMode)
const cornerStyle = atom({ plugin: 'session-kanban', key: 'cornerStyle' } as const, 'square' as CornerStyle)
const fetchedAt = atom({ plugin: 'session-kanban', key: 'fetchedAt' } as const, 0)
const failure = atom({ plugin: 'session-kanban', key: 'failure' } as const, null as Failure | null)

// `tint` is an 8-digit hex at ~10% alpha so one value reads as a pale wash on
// both light and dark themes; theme keys have no translucent variant.
type Column = { key: string; title: string; color: string; tint: string; pick: (card: Card, now: number) => boolean }

const PROGRESS: Column = {
  key: 'progress',
  title: 'In progress',
  color: 'success',
  tint: '#22c55e1a',
  pick: card => !card.isArchived && card.isRunning,
}
const MIDDLE: Column[] = [
  {
    key: 'today',
    title: 'Today',
    color: 'suggestion',
    tint: '#3b82f61a',
    pick: (card, now) => !card.isArchived && !card.isRunning && now - card.lastActivityAt < DAY_MS,
  },
  {
    key: 'earlier',
    title: 'Earlier',
    color: 'warning',
    tint: '#f59e0b1a',
    pick: (card, now) => !card.isArchived && !card.isRunning && now - card.lastActivityAt >= DAY_MS,
  },
]
const ARCHIVED: Column = { key: 'archived', title: 'Archived', color: 'inactive', tint: '#9ca3af1a', pick: card => card.isArchived }
// Lifts a card off its column's wash: lighter on dark themes, whiter on light.
const CARD_FILL = '#ffffff0f'
// A borderless card shows the pointer by lifting its fill instead of its border.
const CARD_HOVER_FILL = '#ffffff17'
// A pale red wash behind the problem banner, in the same alpha as the columns.
const ERROR_FILL = '#ef44441a'
// One step above the card's fill, so an action reads as a control on it.
const ACTION_FILL = '#ffffff1a'

type RawSession = {
  sessionId: string
  title?: string
  branch?: string
  link?: string
  startedBy?: string
  // get_session's spelling of startedBy; `detached` once moved to the top level.
  parentSessionId?: string
  detached?: boolean
  isRunning?: boolean
  isArchived?: boolean
  pinned?: boolean
  lastActivityAt?: string
  group?: { id: string; name: string } | null
}

function toCard(raw: RawSession): Card {
  return {
    id: raw.sessionId,
    title: raw.title || raw.sessionId,
    groupId: raw.group?.id ?? null,
    groupName: raw.group?.name ?? null,
    branch: raw.branch ?? null,
    link: raw.link ?? null,
    parentId: raw.startedBy ?? (raw.detached ? null : (raw.parentSessionId ?? null)),
    isRunning: raw.isRunning === true,
    isArchived: raw.isArchived === true,
    isPinned: raw.pinned === true,
    isCurrent: false,
    lastActivityAt: raw.lastActivityAt ? Date.parse(raw.lastActivityAt) : 0,
  }
}

function age(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function shortDate(ms: number): string {
  const at = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(at.getDate())}.${two(at.getMonth() + 1)}.${two(at.getFullYear() % 100)}`
}

function textOf(result: { content: { type: string }[]; isError: boolean }): string {
  const block = result.content.find(one => one.type === 'text')
  return block && 'text' in block && typeof block.text === 'string' ? block.text : ''
}

// Fewer than this and halving stops; the tool's own default (20) is asked instead.
const MIN_LIMIT = 10

// The tool answers a reply too large to pass back (about 600 characters a
// session, over roughly 100,000 in all) with plain "Error: ..." text and isError
// false, so a reply counts only when it is a JSON array, and the limit is halved
// until one fits.
async function fetchList(
  $: EngineInterface,
  base: Record<string, unknown>,
  limit: number,
): Promise<{ list: Card[] } | { problem: string }> {
  let problem = 'list_sessions returned no text'
  for (let ask: number | null = limit; ; ask = ask !== null && ask / 2 >= MIN_LIMIT ? Math.floor(ask / 2) : null) {
    try {
      const result = await $.mcp.call('ccd_session_mgmt', 'list_sessions', ask === null ? base : { ...base, limit: ask })
      const text = textOf(result)
      if (!result.isError && text.trimStart().startsWith('[')) return { list: (JSON.parse(text) as RawSession[]).map(toCard) }
      problem = text || problem
    } catch (thrown) {
      problem = String(thrown)
    }
    if (ask === null) return { problem: problem.slice(0, 500) }
  }
}

// The app's own session tool is the only source of the sidebar's sessions and
// groups; the engine has no session list of its own. Active sessions are asked
// apart from archived ones, which outnumber them and would crowd them out.
async function listSessions($: EngineInterface): Promise<{ list: Card[] } | { problem: string }> {
  const chosen = await read($, loadCount)
  const limit = chosen === 'all' ? ALL_LIMIT : Number(chosen) || DEFAULT_COUNT
  const active = await fetchList($, {}, limit)
  if ('problem' in active) return active
  const recent = await fetchList($, { include_archived: true }, limit)
  const byId = new Map(active.list.map(card => [card.id, card]))
  if ('list' in recent) for (const card of recent.list) if (!byId.has(card.id)) byId.set(card.id, card)
  const current = await currentSession($)
  if (current) byId.set(current.id, current)

  return { list: [...byId.values()] }
}

// list_sessions leaves out the session that asks, which is the one this board
// runs in; get_session answers for it as "self".
async function currentSession($: EngineInterface): Promise<Card | null> {
  try {
    const text = textOf(await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: 'self' }))
    if (!text.trimStart().startsWith('{')) return null
    const raw = JSON.parse(text) as RawSession

    return typeof raw.sessionId === 'string' ? { ...toCard(raw), isCurrent: true } : null
  } catch {
    return null
  }
}

// list_sessions does not say which sessions a routine started; get_session's
// scheduledTaskId does, so each session is looked up once, newest first.
async function learnDetails($: EngineInterface, list: Card[]) {
  const known = await read($, details)
  const unknown = list
    .filter(card => !(card.id in known))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .slice(0, DETAILS_PER_REFRESH)
  if (unknown.length === 0) return
  const learned: Record<string, Detail> = {}
  for (const card of unknown) {
    try {
      const text = textOf(await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: card.id }))
      if (!text.trimStart().startsWith('{')) continue
      const raw = JSON.parse(text) as { scheduledTaskId?: string | null; createdAt?: string }
      learned[card.id] = {
        isRoutine: typeof raw.scheduledTaskId === 'string' && raw.scheduledTaskId !== '',
        createdAt: raw.createdAt ? Date.parse(raw.createdAt) : card.lastActivityAt,
      }
    } catch {
      // Left unknown; the next refresh asks again.
    }
  }
  await update($, details, current => ({ ...current, ...learned }))
}

// After the Mac wakes or the app reconnects, its tools are briefly not
// connected; those failures pass on their own and are retried quietly.
const OFFLINE_PATTERN = /no connected MCP tool|not connected|disconnected|connection closed|ECONNRESET|ECONNREFUSED|timed out/i
// Retry sooner than the 30 s poll after a failure, then fall back to it.
const RETRY_STEPS_MS = [5_000, 15_000, POLL_MS]
// A connection still lost after this long is shown as a problem, not a blip.
const OFFLINE_GRACE_MS = 3 * 60_000

let retryTimer: ReturnType<EngineInterface['clock']['after']> | null = null

async function refresh($: EngineInterface) {
  retryTimer?.cancel()
  retryTimer = null
  const outcome = await listSessions($)
  const at = await $.clock.now()
  if ('list' in outcome) {
    await update($, cards, () => outcome.list)
    await update($, failure, () => null)
    // Only a successful load moves this, so a failure can say how old the cards are.
    await update($, fetchedAt, () => at)
    await learnDetails($, outcome.list)
    return
  }
  const kind: Failure['kind'] = OFFLINE_PATTERN.test(outcome.problem) ? 'offline' : 'error'
  const next = await update($, failure, previous => ({
    kind,
    message: outcome.problem,
    since: previous?.since ?? at,
    attempts: (previous?.attempts ?? 0) + 1,
  }))
  const step = RETRY_STEPS_MS[Math.min((next?.attempts ?? 1) - 1, RETRY_STEPS_MS.length - 1)] ?? POLL_MS
  retryTimer = $.clock.after(step, () => void refresh($))
}

async function openCard($: EngineInterface, card: Card) {
  if (!card.link) {
    $.ui.toast(`No app link for "${card.title}"`)
    return
  }
  const ran = await $.process.run(['open', card.link])
  if (ran.exitCode !== 0) $.ui.toast(`Could not open "${card.title}": ${ran.stderr.trim()}`)
}

// Called inside the press itself: auto mode's classifier lets an app tool call
// through only when it answers the person's own input, and a timer's call does
// not. The tool may hold its reply until the person answers the app's own
// approval card; time a `$` call is in flight does not count against the press.
async function act(
  $: EngineInterface,
  server: string,
  tool: string,
  args: Record<string, unknown>,
  what: string,
  ask: string,
) {
  try {
    const result = await $.mcp.call(server, tool, args)
    const text = textOf(result).slice(0, 300)
    if (result.isError || /^error/i.test(text)) $.ui.toast(`${what}: ${text || 'failed'}`)
  } catch (thrown) {
    // Auto mode's classifier refuses a mod's call even from a click: it wants a
    // request the person made. So the request is put in the prompt box for the
    // person to send, never sent for them.
    if (/classifier/i.test(String(thrown))) {
      const filled = await $.prompt.fill({ text: ask })
      $.ui.toast(
        filled.isFilled
          ? `${what}: auto mode needs you to ask. The request is in the prompt box; press Enter to send it.`
          : `${what}: auto mode blocks board actions. Ask Claude "${ask}", or switch this session to the Default permission mode.`,
      )
    } else {
      $.ui.toast(`${what}: ${String(thrown)}`)
    }
  }
  later($, () => refresh($))
}

// A press hook has a 10 s budget, and a refresh makes dozens of lookups, so it
// runs from a timer, outside the press.
function later($: EngineInterface, work: () => Promise<unknown>) {
  $.clock.after(0, () => void work())
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'kanban',
      description: 'Show your Code-tab sessions as a Kanban board in a pane',
    })
    void refresh($)
    $.clock.every(POLL_MS, () => void refresh($))
    void $.ui.open({ id: PANE, title: TITLE })

    return started
  })

  on('command.run', { command: 'kanban' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    later($, () => refresh($))

    return { text: 'Sessions board opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, cards)
    const known = await read($, details)
    const chosen = await read($, filter)
    const weekOnly = await read($, isThisWeek)
    const routinesShown = await read($, isRoutinesShown)
    const archivedOpen = await read($, isArchivedOpen)
    const progressOpen = await read($, isProgressOpen)
    const settingsOpen = await read($, isSettingsOpen)
    const isMultiline = (await read($, titleMode)) === 'multiline'
    // The desktop rounds every bordered Box, so a square card is one with no
    // border at all; a terminal keeps its border, having no fill to show a card by.
    const isSquare = (await read($, cornerStyle)) === 'square' && e.surface !== 'terminal'
    const problem = await read($, failure)
    const lastFetch = await read($, fetchedAt)
    const now = await $.clock.now()

    const groups = new Map<string, string>()
    for (const card of all) if (card.groupId && card.groupName) groups.set(card.groupId, card.groupName)
    const options = [
      { value: 'all', label: 'All sections' },
      ...[...groups].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
      { value: 'ungrouped', label: 'Ungrouped' },
    ]
    const selected = options.some(option => option.value === chosen) ? chosen : 'all'

    const isVisible = (card: Card) =>
      (selected === 'all' || (selected === 'ungrouped' ? card.groupId === null : card.groupId === selected)) &&
      (!weekOnly || card.isRunning || now - card.lastActivityAt < WEEK_MS) &&
      (routinesShown || known[card.id]?.isRoutine !== true)
    const visibleIds = new Set(all.filter(isVisible).map(card => card.id))
    // A sub-session rides inside its parent's card while that card is on the
    // board, its own sub-sessions under it; with the parent filtered out it
    // stands as a card of its own. A card is in progress while any session
    // beneath it runs, at any depth and whether or not the filters show it. Its
    // footer then drops Archive, which the app refuses while a side session works.
    const descendantsOf = new Map<string, Card[]>()
    for (const card of all) {
      if (card.parentId) descendantsOf.set(card.parentId, [...(descendantsOf.get(card.parentId) ?? []), card])
    }
    const isBusy = (card: Card, seen: Set<string>): boolean =>
      card.isRunning ||
      (descendantsOf.get(card.id) ?? []).some(child => !seen.has(child.id) && isBusy(child, seen.add(child.id)))
    const topLevel = all
      .filter(card => isVisible(card) && !(card.parentId && visibleIds.has(card.parentId)))
      .map(card => (!card.isRunning && !card.isArchived && isBusy(card, new Set([card.id])) ? { ...card, isRunning: true } : card))
    const cardsIn = (column: Column) =>
      topLevel
        .filter(card => column.pick(card, now))
        .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.lastActivityAt - a.lastActivityAt)

    // A terminal cannot blend alpha hex, so there a column keeps a coloured border instead.
    const isPainted = e.surface !== 'terminal'
    const columnLook = (column: Column) => ({
      backgroundColor: isPainted ? column.tint : undefined,
      borderStyle: isPainted ? undefined : 'round',
      borderColor: isPainted ? undefined : column.color,
    })
    // Multiline titles are plain Text (a Button never wraps), so nothing is inset.
    const inset = isMultiline ? 0 : BUTTON_INSET
    // The session this board runs in takes its column's own hue, a step stronger than the column.
    const currentFill = (column: Column) => `${column.tint.slice(0, 7)}40`

    // Only desktop and vscode draw a Select; elsewhere a setting is shown, not picked.
    const canPick = e.surface === 'desktop' || e.surface === 'vscode'
    let filterControl = <Text dimColor>Section: {options.find(option => option.value === selected)?.label}</Text>
    let titleControl = <Text dimColor>Titles: {isMultiline ? 'multiline' : 'one line'}</Text>
    let cornerControl = <Text dimColor>Corners: {isSquare ? 'square' : 'rounded'}</Text>
    const countChoice = COUNT_OPTIONS.includes(await read($, loadCount)) ? await read($, loadCount) : String(DEFAULT_COUNT)
    const countLabel = (value: string) => (value === 'all' ? 'All' : value)
    let countControl = <Text dimColor>Load: {countLabel(countChoice)}</Text>
    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const { Select } = $.ui.resolve(e)
      countControl = (
        <Select
          key="count"
          label="Load"
          options={COUNT_OPTIONS.map(value => ({ value, label: countLabel(value) }))}
          value={countChoice}
          onSelect={value => {
            void update($, loadCount, () => value)
            later($, () => refresh($))
          }}
        />
      )
      filterControl = (
        <Select
          key="filter"
          label="Section"
          options={options}
          value={selected}
          onSelect={value => update($, filter, () => value)}
        />
      )
      titleControl = (
        <Select
          key="title-mode"
          label="Titles"
          options={[
            { value: 'ellipsis', label: 'One line (…)' },
            { value: 'multiline', label: 'Multiline' },
          ]}
          value={isMultiline ? 'multiline' : 'ellipsis'}
          onSelect={value => update($, titleMode, () => (value === 'multiline' ? 'multiline' : 'ellipsis'))}
        />
      )
      cornerControl = (
        <Select
          key="corners"
          label="Corners"
          options={[
            { value: 'square', label: 'Square' },
            { value: 'rounded', label: 'Rounded' },
          ]}
          value={isSquare ? 'square' : 'rounded'}
          onSelect={value => update($, cornerStyle, () => (value === 'rounded' ? 'rounded' : 'square'))}
        />
      )
    }

    const icon = (key: string, glyph: string, onPress: () => unknown, isDim = true) => (
      <Button key={key} plain dimColor={isDim} onPress={onPress}>
        {glyph}
      </Button>
    )

    // A filled Button carries the app's own padding, so a plain one sits on a
    // tinted Box instead, which keeps the text's height.
    const action = (key: string, label: string, onPress: () => unknown) => (
      <Box key={`frame-${key}`} backgroundColor={isPainted ? ACTION_FILL : undefined}>
        {icon(key, label, onPress)}
      </Box>
    )

    // A Box border is whole and counted in cells; an Svg is sized in pixels,
    // so the pinned mark is a 3px bar drawn tall and clipped by the card.
    const pinBar = (column: Column) => {
      if (e.surface === 'terminal') return null
      const { Svg } = $.ui.resolve(e)
      const color = column.tint.slice(0, 7)

      return (
        <Box position="absolute" top={0} left={0}>
          <Svg
            alt="Pinned"
            width={3}
            height={2000}
            source={`<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2000" viewBox="0 0 3 2000" preserveAspectRatio="none"><rect width="3" height="2000" fill="${color}"/></svg>`}
          />
        </Box>
      )
    }

    const titleOf = (card: Card, isDim = false) =>
      isMultiline ? (
        <Text wrap="wrap" dimColor={isDim}>
          {card.title}
        </Text>
      ) : (
        <Button key={card.id} plain dimColor={isDim} onPress={() => later($, () => openCard($, card))}>
          {card.title}
        </Button>
      )

    // Lucide's arrow-right as a glyph: a Button takes only text, and an Svg cannot be pressed.
    const openIcon = (card: Card) => icon(`open-${card.id}`, '→', () => later($, () => openCard($, card)))

    const childrenBelow = (id: string) =>
      [...(descendantsOf.get(id) ?? [])].sort(
        (a, b) => Number(a.isArchived) - Number(b.isArchived) || b.lastActivityAt - a.lastActivityAt,
      )
    // Every session beneath a card, at any depth; `seen` guards a parent loop.
    const familyOf = (id: string, seen: Set<string>): Card[] =>
      childrenBelow(id).flatMap(child =>
        seen.has(child.id) ? [] : [child, ...familyOf(child.id, seen.add(child.id))],
      )
    // Archived sub-sessions follow the Archived column: listed only while it is open.
    const isListed = (sub: Card) => archivedOpen || !sub.isArchived

    // A sub-session's own sub-sessions sit under it, one indent deeper.
    const subTree = (sub: Card, seen: Set<string>, column: Column): RenderElement => {
      const marker = sub.isArchived ? '✓' : sub.isRunning ? '●' : '○'
      const color = sub.isArchived ? 'inactive' : sub.isRunning ? 'success' : 'subtle'
      const below = childrenBelow(sub.id).filter(child => isListed(child) && !seen.has(child.id))
      for (const child of below) seen.add(child.id)

      return (
        <Box key={`sub-${sub.id}`} flexDirection="column">
          <Box
            flexDirection="row"
            gap="xs"
            alignItems="flex-start"
            backgroundColor={isPainted && sub.isCurrent ? currentFill(column) : undefined}
          >
            <Text color={color}>{marker}</Text>
            {/* The spacer before the arrow lines every level's arrows up at the card's right edge. */}
            <Box flexDirection="column" flexShrink={1} minWidth={0}>
              {titleOf(sub, sub.isArchived)}
            </Box>
            <Box flexGrow={1} />
            {openIcon(sub)}
          </Box>
          {below.length > 0 && (
            <Box flexDirection="column" paddingLeft={2}>
              {below.map(child => subTree(child, seen, column))}
            </Box>
          )}
        </Box>
      )
    }

    const footerOf = (card: Card) => {
      const named = `the session "${card.title}" (${card.id})`
      const pinVerb = card.isPinned ? 'Unpin' : 'Pin'
      const left = card.isArchived
        ? [
            action(`delete-${card.id}`, 'Delete', () =>
              act(
                $,
                'ccd_session_mgmt',
                'delete_session',
                { session_ids: [card.id], reason: 'Deleted from the Sessions board' },
                'Delete',
                `Delete ${named}.`,
              ),
            ),
          ]
        : [
            action(`pin-${card.id}`, pinVerb, () =>
              act($, 'ccd_sidebar', 'set_pinned', { session_id: card.id, pinned: !card.isPinned }, pinVerb, `${pinVerb} ${named}.`),
            ),
          ]
      const right = card.isArchived
        ? [
            action(`unarchive-${card.id}`, 'Unarchive', () =>
              act($, 'ccd_session_mgmt', 'unarchive_session', { session_id: card.id }, 'Unarchive', `Unarchive ${named}.`),
            ),
          ]
        : card.isRunning
          ? []
          : [
              action(`archive-${card.id}`, 'Archive', () =>
                act(
                  $,
                  'ccd_session_mgmt',
                  'archive_session',
                  { session_id: card.id, reason: 'Archived from the Sessions board' },
                  'Archive',
                  `Archive ${named}.`,
                ),
              ),
            ]

      return (
        <Box key={`foot-${card.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" marginTop="sm">
          <Box flexDirection="row" gap="xs">{left}</Box>
          <Box flexDirection="row" gap="xs">{right}</Box>
        </Box>
      )
    }

    const cardBox = (card: Card, column: Column) => {
      const detail = known[card.id]
      // A routine's runs share one title, so its run date tells them apart.
      const tag = detail?.isRoutine ? shortDate(detail.createdAt) : card.groupName
      const subs = familyOf(card.id, new Set([card.id]))
      const doneCount = subs.filter(sub => sub.isArchived).length
      const firstLevel = childrenBelow(card.id).filter(isListed)
      const seen = new Set([card.id, ...firstLevel.map(sub => sub.id)])

      return (
        <Box
          key={`card-${card.id}`}
          flexDirection="column"
          {...(isSquare
            ? { paddingY: 'sm' as const, hover: { backgroundColor: card.isCurrent ? currentFill(column) : CARD_HOVER_FILL } }
            : { borderStyle: 'single', borderDimColor: true, hover: { borderColor: column.color, borderDimColor: false } })}
          backgroundColor={isPainted ? (card.isCurrent ? currentFill(column) : CARD_FILL) : undefined}
          paddingX={1}
          overflow="hidden"
        >
          {card.isPinned && pinBar(column)}
          {/* The spacer, not the title, takes the slack, so the open arrow sits right after the title. */}
          <Box flexDirection="row" alignItems="flex-start" gap="xs">
            <Box flexDirection="column" flexShrink={1} minWidth={0}>
              {titleOf(card)}
            </Box>
            {openIcon(card)}
            <Box flexGrow={1} />
            {tag && (
              <Box flexShrink={0} paddingTop="xs">
                <Text color={column.color} size="caption" mono>
                  {tag}
                </Text>
              </Box>
            )}
          </Box>
          <Box paddingLeft={inset} flexDirection="row" gap="xs">
            {card.isCurrent && (
              <Box flexShrink={0}>
                <Text color={column.color} bold size="caption">
                  this session
                </Text>
              </Box>
            )}
            <Text dimColor size="caption" wrap={isMultiline ? 'wrap' : 'truncate-end'}>
              {age(now - card.lastActivityAt)} ago{card.branch ? ` · ${card.branch}` : ''}
            </Text>
          </Box>
          {subs.length > 0 && (
            <Box flexDirection="column" marginTop="xs" paddingLeft={inset}>
              <Text dimColor size="caption">
                Sub-sessions: {subs.length}
                {doneCount > 0 ? ` (${doneCount} archived)` : ''}
              </Text>
              {firstLevel.map(sub => subTree(sub, seen, column))}
            </Box>
          )}
          {footerOf(card)}
        </Box>
      )
    }

    const arrow = (column: Column, key: string, glyph: string, onPress: () => unknown) => (
      // A Button draws its children at its own size, so the heavy glyphs carry the weight.
      <Button key={key} plain onPress={onPress}>
        <Text color={column.color} bold>
          {glyph}
        </Text>
      </Button>
    )

    const fullColumn = (column: Column, collapse?: () => unknown) => {
      const inColumn = cardsIn(column)
      const cap = column === ARCHIVED ? ARCHIVED_SHOWN : CARDS_PER_COLUMN

      return (
        <Box
          key={`col-${column.key}`}
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          width={0}
          minWidth={MIN_COLUMN_WIDTH}
          gap="xs"
          padding={1}
          {...columnLook(column)}
        >
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text bold color={column.color}>
              {column.title} <Text dimColor>{inColumn.length}</Text>
            </Text>
            {collapse && arrow(column, `collapse-${column.key}`, column === ARCHIVED ? '❯' : '❮', collapse)}
          </Box>
          {inColumn.length === 0 && <Text dimColor>—</Text>}
          {inColumn.slice(0, cap).map(card => cardBox(card, column))}
          {inColumn.length > cap && <Text dimColor>+{inColumn.length - cap} more</Text>}
        </Box>
      )
    }

    const rail = (column: Column, glyph: string, count: number | null, expand: () => unknown) => (
      <Box
        key={`rail-${column.key}`}
        flexDirection="column"
        alignItems="center"
        flexShrink={0}
        width={RAIL_WIDTH}
        paddingY={1}
        gap="xs"
        {...columnLook(column)}
      >
        {arrow(column, `expand-${column.key}`, glyph, expand)}
        {count !== null && (
          <Text dimColor size="caption">
            {count}
          </Text>
        )}
      </Box>
    )

    const progressCount = cardsIn(PROGRESS).length
    const archivedCount = cardsIn(ARCHIVED).length

    // A brief disconnect is a quiet note beside the count; an error, or a
    // disconnect that outlasts the grace period, also gets the banner below.
    const isSerious = problem !== null && (problem.kind === 'error' || now - problem.since >= OFFLINE_GRACE_MS)
    const dataAge = lastFetch ? `showing data from ${age(now - lastFetch)} ago` : 'no data yet'
    const statusNote =
      problem === null ? (
        <Text dimColor>
          {topLevel.length} sessions{lastFetch ? ` · updated ${age(now - lastFetch)} ago` : ' · loading…'}
        </Text>
      ) : (
        <Text color={isSerious ? 'error' : 'warning'}>
          {problem.kind === 'offline' ? "Can't reach the app right now · retrying" : 'Refresh failed'} · {dataAge}
        </Text>
      )

    return (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap" flexShrink={1}>
            {filterControl}
            {countControl}
            <Button
              key="week"
              label="This week"
              variant={weekOnly ? 'primary' : 'secondary'}
              onPress={() => update($, isThisWeek, isOn => !isOn)}
            />
            <Button
              key="routines"
              label="Show routines"
              variant={routinesShown ? 'primary' : 'secondary'}
              onPress={() => update($, isRoutinesShown, isOn => !isOn)}
            />
            <Button key="refresh" label="Refresh" onPress={() => later($, () => refresh($))} />
            {statusNote}
          </Box>
          {/* A word, not a glyph: a Button draws its text at one fixed size. */}
          <Button
            key="settings"
            label="Settings"
            variant={settingsOpen ? 'primary' : 'secondary'}
            onPress={() => update($, isSettingsOpen, isOn => !isOn)}
          />
        </Box>
        {settingsOpen && (
          <Box flexDirection="row" gap="sm" alignItems="center" justifyContent="flex-end" flexWrap="wrap">
            {titleControl}
            {cornerControl}
            {!canPick && <Text dimColor>(change it on the desktop app)</Text>}
          </Box>
        )}
        {isSerious && problem && (
          <Box flexDirection="column" paddingX={1} paddingY="xs" backgroundColor={isPainted ? ERROR_FILL : undefined}>
            <Text color="error" bold>
              {problem.kind === 'offline' ? "The board can't reach the app's session list" : 'The app could not list your sessions'}
            </Text>
            <Text wrap="wrap">
              {problem.kind === 'offline'
                ? `It has been out of reach for ${age(now - problem.since)}. The board keeps retrying every 30 seconds; press Refresh to try now. If this lasts, restart the Claude app.`
                : 'Press Refresh to try again. If it keeps failing, the details below help when reporting it.'}
            </Text>
            <Text dimColor size="caption" wrap="wrap">
              {problem.message}
            </Text>
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" gap="sm" alignItems="stretch">
          {progressCount > 0
            ? fullColumn(PROGRESS)
            : progressOpen
              ? fullColumn(PROGRESS, () => update($, isProgressOpen, () => false))
              : rail(PROGRESS, '❯', null, () => update($, isProgressOpen, () => true))}
          {MIDDLE.map(column => fullColumn(column))}
          {archivedOpen
            ? fullColumn(ARCHIVED, () => update($, isArchivedOpen, () => false))
            : rail(ARCHIVED, '❮', archivedCount, () => update($, isArchivedOpen, () => true))}
        </Box>
      </Box>
    )
  })
}
