import { atom, read, update } from 'claude-code'
import type { Atom, EngineInterface, Register, RenderElement, ResolveInput } from 'claude-code'

import type {
  Activity,
  ActivityMetric,
  Card,
  CornerStyle,
  Detail,
  Failure,
  HourCounts,
  LayoutMode,
  SettingsPlace,
  TitleMode,
  TurnStatus,
} from '../types'

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
const activity = atom({ plugin: 'session-kanban', key: 'activity' } as const, {}, { shape: 'activity-2' })
const statuses = atom({ plugin: 'session-kanban', key: 'statuses' } as const, {}, { shape: 'statuses-1' })
const activityMetric = atom({ plugin: 'session-kanban', key: 'activityMetric' } as const, 'entries' as ActivityMetric)
const filter = atom({ plugin: 'session-kanban', key: 'filter' } as const, 'all')
const isThisWeek = atom({ plugin: 'session-kanban', key: 'isThisWeek' } as const, false)
const isRoutinesShown = atom({ plugin: 'session-kanban', key: 'isRoutinesShown' } as const, false)
const isArchivedOpen = atom({ plugin: 'session-kanban', key: 'isArchivedOpen' } as const, false)
// The cards whose archived sub-sessions someone chose to see, by card id.
const archivedShownIn = atom({ plugin: 'session-kanban', key: 'archivedShownIn' } as const, {} as Record<string, boolean>)
// Only the sections someone opened or closed by hand; the rest follow their default.
const openSections = atom({ plugin: 'session-kanban', key: 'openSections' } as const, {} as Record<string, boolean>)
const isSettingsOpen = atom({ plugin: 'session-kanban', key: 'isSettingsOpen' } as const, false)
const settingsPlace = atom({ plugin: 'session-kanban', key: 'settingsPlace' } as const, 'pane' as SettingsPlace)
// The first day of the week, as Date.getDay(): Monday unless picked otherwise.
const weekStart = atom({ plugin: 'session-kanban', key: 'weekStart' } as const, 1)
const commandKeys = atom({ plugin: 'session-kanban', key: 'commandKeys' } as const, [] as string[])
const isCommandBarShown = atom({ plugin: 'session-kanban', key: 'isCommandBarShown' } as const, false)
const commandDraft = atom({ plugin: 'session-kanban', key: 'commandDraft' } as const, null as string[] | null)
// How many command fields Settings shows, at least past the last filled one.
const commandFieldCount = atom({ plugin: 'session-kanban', key: 'commandFieldCount' } as const, 3)
const loadCount = atom({ plugin: 'session-kanban', key: 'loadCount' } as const, String(DEFAULT_COUNT))
const titleMode = atom({ plugin: 'session-kanban', key: 'titleMode' } as const, 'ellipsis' as TitleMode)
const cornerStyle = atom({ plugin: 'session-kanban', key: 'cornerStyle' } as const, 'square' as CornerStyle)
const isOpenInSubs = atom({ plugin: 'session-kanban', key: 'isOpenInSubs' } as const, false)
const layoutMode = atom({ plugin: 'session-kanban', key: 'layoutMode' } as const, 'stacked' as LayoutMode)
const query = atom({ plugin: 'session-kanban', key: 'query' } as const, '')
const fetchedAt = atom({ plugin: 'session-kanban', key: 'fetchedAt' } as const, 0)
const failure = atom({ plugin: 'session-kanban', key: 'failure' } as const, null as Failure | null)

// Plugin state lives for one session, so the board's choices are also kept in
// the plugin's store, under their atom's key, and a new session starts with them.
// The loader lists the atoms a module reads and writes from each update call, so
// every setting is named at its own call rather than looped over.
function save<T>($: EngineInterface, setting: Atom<T>) {
  return (value: T) => $.store.set(setting.ref.key, value).catch(() => undefined)
}

// A value of another type than the atom's (an older or hand-edited store) is passed over.
async function saved<T>($: EngineInterface, setting: Atom<T>): Promise<T | undefined> {
  const value = await $.store.get(setting.ref.key).catch(() => undefined)

  return value !== null && typeof value === typeof setting.initial ? (value as T) : undefined
}

async function restoreSettings($: EngineInterface) {
  await saved($, filter).then(value => update($, filter, current => value ?? current))
  await saved($, isThisWeek).then(value => update($, isThisWeek, current => value ?? current))
  await saved($, isRoutinesShown).then(value => update($, isRoutinesShown, current => value ?? current))
  await saved($, isArchivedOpen).then(value => update($, isArchivedOpen, current => value ?? current))
  await saved($, archivedShownIn).then(value => update($, archivedShownIn, current => value ?? current))
  await saved($, openSections).then(value => update($, openSections, current => value ?? current))
  await saved($, loadCount).then(value => update($, loadCount, current => value ?? current))
  await saved($, titleMode).then(value => update($, titleMode, current => value ?? current))
  await saved($, cornerStyle).then(value => update($, cornerStyle, current => value ?? current))
  await saved($, isOpenInSubs).then(value => update($, isOpenInSubs, current => value ?? current))
  await saved($, layoutMode).then(value => update($, layoutMode, current => value ?? current))
  await saved($, activityMetric).then(value => update($, activityMetric, current => value ?? current))
  await saved($, settingsPlace).then(value => update($, settingsPlace, current => value ?? current))
  await saved($, weekStart).then(value => update($, weekStart, current => value ?? current))
  await saved($, isCommandBarShown).then(value => update($, isCommandBarShown, current => value ?? current))
  await saved($, commandKeys).then(value =>
    update($, commandKeys, current => (Array.isArray(value) ? value.map(text => (typeof text === 'string' ? text : '')) : current)),
  )
}

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
// Full-size geometric triangles: the small ▸ ▾ drew at half the text's height.
// FE0E keeps ▶ a text glyph where macOS would draw it as an emoji.
const STACKED_CLOSED = '▶︎'
const STACKED_OPEN = '▼'

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
  const recent = await fetchArchived($, limit)
  const byId = new Map(active.list.map(card => [card.id, card]))
  if ('list' in recent) for (const card of recent.list) if (!byId.has(card.id)) byId.set(card.id, card)
  const current = await currentSession($)
  if (current) byId.set(current.id, current)
  for (const id of await backgroundBusy($)) {
    const card = byId.get(id)
    if (card && !card.isRunning && !card.isArchived) byId.set(id, { ...card, isRunning: true })
  }

  return { list: [...byId.values()] }
}

// The app counts a session as running only while it takes a turn, not while
// shells or agents it sent to the background still run. The script reads those
// from each live session's own records and prints "<session id> <count>".
async function backgroundBusy($: EngineInterface): Promise<string[]> {
  const ran = await $.process.run(['/bin/sh', `${$.plugin.root}/hooks/background-tasks.sh`]).catch(() => null)
  if (!ran || ran.exitCode !== 0) return []
  return ran.stdout
    .split('\n')
    .map(line => line.split(' ')[0] ?? '')
    .filter(id => id.startsWith('local_'))
}

// The timeline on each card: the last week, in bars of three hours.
const ACTIVITY_BIN_MS = 3 * 60 * 60 * 1000
const ACTIVITY_BINS = WEEK_MS / ACTIVITY_BIN_MS
const ACTIVITY_BAR_WIDTH = 6
const ACTIVITY_HEIGHT = 16

const HOUR_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}$/
// An Svg without a width takes its markup's own, up to the slot: wider than any
// slot, it fills it, and preserveAspectRatio="none" stretches the drawing across.
const STRETCH_WIDTH = 4000
const STATUS_CATEGORIES: readonly TurnStatus['category'][] = ['blocked', 'review_ready']

// The session list says only when a session was last active; the app's own
// record of each session says what its last turn left waiting, and its
// transcript says when it worked and how many tokens it used. The script reads
// both on this Mac; with the timelines hidden it skips the transcripts.
async function learnActivity($: EngineInterface, list: Card[], now: number) {
  const since = now - WEEK_MS
  const ids = list.filter(card => !card.isArchived && (card.isRunning || card.lastActivityAt >= since)).map(card => card.id)
  const isMeasured = (await read($, activityMetric)) !== 'hidden'
  const ran =
    ids.length === 0
      ? null
      : await $.process
          .run(
            ['/bin/sh', `${$.plugin.root}/hooks/activity.sh`, new Date(since).toISOString().slice(0, 13), isMeasured ? 'all' : 'status'],
            { stdin: `${ids.join('\n')}\n` },
          )
          .catch(() => null)
  if (ids.length > 0 && (!ran || ran.exitCode !== 0)) return
  const learned: Activity = {}
  const waiting: Record<string, TurnStatus> = {}
  for (const line of ran?.stdout.split('\n') ?? []) {
    const [kind, id, ...rest] = line.trim().split(' ')
    if (!id?.startsWith('local_')) continue
    if (kind === 'hours') {
      const hours: Record<string, HourCounts> = {}
      for (const pair of rest) {
        const [hour, counts] = pair.split('=')
        const [entries = 0, tokens = 0, output = 0] = (counts ?? '').split(',').map(Number)
        if (hour && HOUR_KEY.test(hour) && entries > 0) hours[hour] = [entries, tokens || 0, output || 0]
      }
      if (Object.keys(hours).length > 0) learned[id] = hours
    }
    const category = STATUS_CATEGORIES.find(known => known === rest[0])
    if (kind === 'status' && category) waiting[id] = { category, needsAction: unescapeJson(rest.slice(1).join(' ')) }
  }
  await update($, activity, () => learned)
  await update($, statuses, () => waiting)
}

// The script hands the needs-action line over as it is written in the record.
function unescapeJson(text: string): string {
  try {
    const value: unknown = JSON.parse(`"${text}"`)
    return typeof value === 'string' ? value : text
  } catch {
    return text
  }
}

// Indexed as Date.getDay(), Sunday first; the heatmap starts its rows at the
// chosen first day of the week.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function measureOf(counts: HourCounts, metric: ActivityMetric): number {
  return metric === 'tokens' ? counts[1] : counts[0]
}

// A sub-session's span on its parent's timeline, from its start to its last
// activity, or to now while it runs.
type Lifespan = { start: number; end: number; color: string }

const LIFESPAN_HEIGHT = 3
const LIFESPAN_GAP = 2
// More rows than this would outgrow the card; the most recent are kept.
const LIFESPANS_SHOWN = 12
const RUNNING_COLOR = '#22c55e'
const ARCHIVED_COLOR = '#9ca3af'

// One card's drawing on one time axis, the last week: a bar per three hours,
// as tall as its share of the card's busiest bar, then a row per sub-session's
// lifespan, with a tick at each local midnight across both. Null when there is
// nothing to draw.
function cardSvg(input: {
  hours: Record<string, HourCounts> | undefined
  metric: ActivityMetric
  lifespans: Lifespan[]
  now: number
  color: string
}): { source: string; alt: string; height: number } | null {
  const { metric, lifespans, now, color } = input
  const start = now - WEEK_MS
  const bins = Array.from({ length: ACTIVITY_BINS }, (): HourCounts => [0, 0, 0])
  for (const [hour, counts] of Object.entries(input.hours ?? {})) {
    const index = Math.floor((Date.parse(`${hour}:00:00Z`) - start) / ACTIVITY_BIN_MS)
    const bin = bins[index]
    if (bin) bins[index] = [bin[0] + counts[0], bin[1] + counts[1], bin[2] + counts[2]]
  }
  const peak = Math.max(...bins.map(bin => measureOf(bin, metric)))
  const shown = lifespans.filter(span => span.end >= start).slice(0, LIFESPANS_SHOWN)
  if (peak === 0 && shown.length === 0) return null
  const width = ACTIVITY_BINS * ACTIVITY_BAR_WIDTH
  const toX = (at: number) => Math.max(0, ((at - start) / ACTIVITY_BIN_MS) * ACTIVITY_BAR_WIDTH)
  const timelineHeight = peak > 0 ? ACTIVITY_HEIGHT : 0
  const spansTop = timelineHeight > 0 ? timelineHeight + LIFESPAN_GAP + 1 : 0
  const height = shown.length > 0 ? spansTop + shown.length * (LIFESPAN_HEIGHT + LIFESPAN_GAP) - LIFESPAN_GAP : timelineHeight

  let busySpans = 0
  const bars = bins.flatMap((bin, index) => {
    const value = measureOf(bin, metric)
    if (value === 0 || peak === 0) return []
    busySpans++
    const barHeight = Math.max(2, Math.round((value / peak) * (ACTIVITY_HEIGHT - 2)))
    return [`<rect x="${index * ACTIVITY_BAR_WIDTH}" y="${ACTIVITY_HEIGHT - barHeight}" width="${ACTIVITY_BAR_WIDTH - 1}" height="${barHeight}"/>`]
  })
  const rows = shown.map((span, index) => {
    const y = spansTop + index * (LIFESPAN_HEIGHT + LIFESPAN_GAP)
    const x = toX(span.start)
    const spanWidth = Math.max(2, toX(span.end) - x)

    return `<rect x="${x.toFixed(1)}" y="${y}" width="${spanWidth.toFixed(1)}" height="${LIFESPAN_HEIGHT}" fill="${span.color}"/>`
  })
  const ticks: string[] = []
  const midnight = new Date(start)
  midnight.setHours(24, 0, 0, 0)
  for (let at = midnight.getTime(); at < now; at = new Date(at).setDate(new Date(at).getDate() + 1)) {
    const x = toX(at).toFixed(1)
    ticks.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"/>`)
  }
  const baseline = timelineHeight > 0 ? `<rect y="${ACTIVITY_HEIGHT - 1}" width="${width}" height="1" fill="${color}" opacity="0.25"/>` : ''
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${STRETCH_WIDTH}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">` +
    `${baseline}<g stroke="${color}" stroke-width="1" opacity="0.35">${ticks.join('')}</g>` +
    `<g fill="${color}">${bars.join('')}</g>${rows.join('')}</svg>`
  const measured = metric === 'tokens' ? 'tokens' : 'activity'
  const alt = [
    peak > 0 ? `${measured === 'tokens' ? 'Tokens' : 'Activity'} over the last 7 days: busy in ${busySpans} of ${ACTIVITY_BINS} three-hour spans` : '',
    shown.length > 0 ? `${shown.length} sub-session${shown.length === 1 ? '' : 's'} on the same days` : '',
  ]
    .filter(Boolean)
    .join('; ')

  return { source, alt, height }
}

const HEATMAP_CELL = 11
const HEATMAP_PITCH = 12
const HEATMAP_LABEL_WIDTH = 28
const HEATMAP_COLOR = '#3b82f6'
const HEATMAP_TEXT = '#8b8b8b'
const HEATMAP_TODAY_TEXT = '#d4d4d4'

// The last 7 days of the whole board as a grid: a row per weekday in the
// week's order from `weekStart` (0 Sunday … 6 Saturday), each the most recent
// such day, today included, and a column per local hour, shaded by the sum
// over the sessions shown; today's name is brighter. The grid stretches to the
// board's width, so its text would stretch too: the day names are a drawing of
// their own, the hours are Text.
function heatmapSvg(
  perHour: Map<number, HourCounts>,
  metric: ActivityMetric,
  now: number,
  weekStart: number,
): { grid: string; days: string; alt: string; height: number } | null {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const rowOf = (weekday: number) => (weekday - weekStart + 7) % 7
  const todayRow = rowOf(today.getDay())
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, (): HourCounts => [0, 0, 0]))
  for (const [at, counts] of perHour) {
    const day = new Date(at)
    day.setHours(0, 0, 0, 0)
    const daysAgo = Math.round((today.getTime() - day.getTime()) / DAY_MS)
    const line = daysAgo >= 0 && daysAgo < 7 ? cells[rowOf(day.getDay())] : undefined
    const hour = new Date(at).getHours()
    const cell = line?.[hour]
    if (line && cell) line[hour] = [cell[0] + counts[0], cell[1] + counts[1], cell[2] + counts[2]]
  }
  const peak = Math.max(...cells.flat().map(cell => measureOf(cell, metric)))
  if (peak === 0) return null
  const width = 24 * HEATMAP_PITCH
  const height = 7 * HEATMAP_PITCH - (HEATMAP_PITCH - HEATMAP_CELL)
  const cellParts: string[] = []
  const dayParts: string[] = []
  let busyHours = 0
  cells.forEach((row, rowIndex) => {
    const y = rowIndex * HEATMAP_PITCH
    const nameColor = rowIndex === todayRow ? HEATMAP_TODAY_TEXT : HEATMAP_TEXT
    dayParts.push(`<text x="0" y="${y + 9}" fill="${nameColor}">${WEEKDAYS[(weekStart + rowIndex) % 7]}</text>`)
    row.forEach((cell, hour) => {
      const value = measureOf(cell, metric)
      if (value > 0) busyHours++
      const opacity = value > 0 ? 0.2 + 0.8 * Math.sqrt(value / peak) : 0.07
      cellParts.push(
        `<rect x="${hour * HEATMAP_PITCH}" y="${y}" width="${HEATMAP_CELL}" height="${HEATMAP_CELL}" fill-opacity="${opacity.toFixed(2)}"/>`,
      )
    })
  })
  const grid =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${STRETCH_WIDTH}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">` +
    `<g fill="${HEATMAP_COLOR}">${cellParts.join('')}</g></svg>`
  const days =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${HEATMAP_LABEL_WIDTH}" height="${height}" viewBox="0 0 ${HEATMAP_LABEL_WIDTH} ${height}">` +
    `<g font-family="-apple-system, system-ui, sans-serif" font-size="9">${dayParts.join('')}</g></svg>`
  const measured = metric === 'tokens' ? 'Tokens' : 'Activity'

  return { grid, days, alt: `${measured} of the sessions shown, by day and hour: busy in ${busyHours} of ${7 * 24} hours in the last 7 days`, height }
}

// How far the archived list may widen: up to this many times the chosen count.
const ARCHIVED_REACH = 8

// The archived list mixes active and archived sessions, newest first, and a
// parent that starts many sub-sessions fills it with them: those ride inside
// their parent's card, so the Archived column stayed empty. The list has no
// offset, so it is asked again twice as long until it holds `limit` archived
// sessions that stand as cards of their own, or ends, or stops growing.
async function fetchArchived($: EngineInterface, limit: number): Promise<{ list: Card[] } | { problem: string }> {
  let outcome = await fetchList($, { include_archived: true }, limit)
  for (let ask = limit * 2; 'list' in outcome && ask <= limit * ARCHIVED_REACH; ask *= 2) {
    const ids = new Set(outcome.list.map(card => card.id))
    const ownCards = outcome.list.filter(card => card.isArchived && !(card.parentId && ids.has(card.parentId)))
    if (ownCards.length >= limit || outcome.list.length < ask / 2) break
    const wider = await fetchList($, { include_archived: true }, ask)
    if (!('list' in wider) || wider.list.length <= outcome.list.length) break
    outcome = wider
  }

  return outcome
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
let pollTimer: ReturnType<EngineInterface['clock']['every']> | null = null
// Whether the session is a sub-session is known only from the first list, so
// the board opens itself then, and survives a slow or offline start.
let isAutoOpenPending = false

function startPolling($: EngineInterface) {
  pollTimer ??= $.clock.every(POLL_MS, () => void refresh($))
}

// The board opens by itself in root sessions, and in sub-sessions only when
// Settings say so: a sub-session's parent shows it already, so by default it
// stays closed there and polls only once /kanban opens it.
async function settleAutoOpen($: EngineInterface, list: Card[]) {
  isAutoOpenPending = false
  if (list.find(card => card.isCurrent)?.parentId && !(await read($, isOpenInSubs))) {
    pollTimer?.cancel()
    pollTimer = null
    return
  }
  void $.ui.open({ id: PANE, title: TITLE })
}

async function refresh($: EngineInterface) {
  retryTimer?.cancel()
  retryTimer = null
  const outcome = await listSessions($)
  const at = await $.clock.now()
  if ('list' in outcome) {
    const previous = await read($, cards)
    // Stored cards outlive a reload; ones older than a few polls would announce
    // sessions that finished long ago, so only a recent load is compared.
    if (at - (await read($, fetchedAt)) <= FINISH_WINDOW_MS) announceFinished($, previous, outcome.list)
    await update($, cards, () => outcome.list)
    if (isAutoOpenPending) await settleAutoOpen($, outcome.list)
    await update($, failure, () => null)
    // Only a successful load moves this, so a failure can say how old the cards are.
    await update($, fetchedAt, () => at)
    await learnDetails($, outcome.list)
    await learnActivity($, outcome.list, at)
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

// A few polls, so one failed refresh between two loads still counts as recent.
const FINISH_WINDOW_MS = 3 * POLL_MS
const FINISH_TOAST_MS = 10_000

// The app reports no "needs input" state; a session that stops running is the
// nearest sign that it wants you. The board's own session and sessions that
// stopped by being archived are left out.
function announceFinished($: EngineInterface, previous: Card[], list: Card[]) {
  const wasRunning = new Set(previous.filter(card => card.isRunning).map(card => card.id))
  const finished = list.filter(card => wasRunning.has(card.id) && !card.isRunning && !card.isArchived && !card.isCurrent)
  if (finished.length === 0) return
  const names = finished.map(card => `"${card.title}"`).join(', ')
  $.ui.toast(finished.length === 1 ? `Finished: ${names}` : `${finished.length} sessions finished: ${names}`, {
    timeoutMs: FINISH_TOAST_MS,
  })
}

async function openCard($: EngineInterface, card: Card) {
  if (!card.link) {
    $.ui.toast(`No app link for "${card.title}"`)
    return
  }
  const ran = await $.process.run(['open', card.link])
  if (ran.exitCode !== 0) $.ui.toast(`Could not open "${card.title}": ${ran.stderr.trim()}`)
}

// The surface's clipboard first; a desktop pane may have none a mod can reach,
// so macOS's own pbcopy takes the id then.
async function copyId($: EngineInterface, card: Card) {
  const copied = await $.ui.copy({ text: card.id }).catch(() => ({ isCopied: false }))
  if (!copied.isCopied) {
    const ran = await $.process.run(['pbcopy'], { stdin: card.id }).catch(() => null)
    if (ran?.exitCode !== 0) {
      $.ui.toast(`Could not copy the id of "${card.title}": ${card.id}`)
      return
    }
  }
  $.ui.toast(`Copied ${card.id}`)
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

const SETTINGS_PANE = 'session-kanban-settings'
const SETTINGS_TITLE = 'Board settings'
const COMMAND_KEY_COUNT = 12

// What a command button shows of its command: a slash command's name past its
// plugin prefix (`/session:close-out` → close-out), else the prompt's start.
function commandKeyName(text: string) {
  const slash = /^\/(?:[\w-]+:)?([\w-]+)/.exec(text)
  if (slash?.[1]) return slash[1]

  return text.length > 18 ? `${text.slice(0, 17)}…` : text
}

// Runs a button's command: `/name args` as that slash command, once the
// session is idle. Anything else goes into the prompt box for the person to
// send, since a prompt a mod submits reaches the model as the mod's, not
// theirs, and asks for push or delete are then refused.
async function runCommandKey($: EngineInterface, text: string) {
  const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(text)
  try {
    if (slash?.[1]) {
      await $.command.run({ command: slash[1], args: slash[2] ?? '' })
    } else if (!(await $.prompt.fill({ text })).isFilled) {
      $.ui.toast('Close the open dialog first: the prompt box cannot take the text now.')
    }
  } catch (error) {
    $.ui.toast(`Could not run ${text}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Typing edits a draft, so a half-typed command never shows as a button;
// Apply, or Enter in a field, puts the draft on the band.
async function setCommandDraft($: EngineInterface, index: number, text: string) {
  const keys = await read($, commandKeys)
  await update($, commandDraft, draft => {
    const next = Array.from({ length: COMMAND_KEY_COUNT }, (_, at) => (draft ?? keys)[at] ?? '')
    next[index] = text

    return next
  })
}

async function applyCommandDraft($: EngineInterface) {
  const draft = await read($, commandDraft)
  if (draft === null) return
  await update($, commandKeys, () => draft).then(save($, commandKeys))
  await update($, commandDraft, () => null)
}

type SettingsSection = { key: string; title: string; controls: RenderElement[] }

// A thin line across the slot between two sections: a stretched SVG where
// one is drawn, a dash run on the terminal.
function sectionRule($: EngineInterface, e: ResolveInput<'Pane'>, key: string) {
  if (e.surface === 'terminal') {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{'─'.repeat(24)}</Text>
  }
  const { Svg } = $.ui.resolve(e)
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${STRETCH_WIDTH}" height="1" viewBox="0 0 ${STRETCH_WIDTH} 1" preserveAspectRatio="none"><rect width="${STRETCH_WIDTH}" height="1" fill="#8b8b8b" fill-opacity="0.4"/></svg>`

  return <Svg key={key} source={source} alt="Section separator" height={1} />
}

// Sections stacked, a bold title over each one's controls, a rule between them.
function settingsBody($: EngineInterface, e: ResolveInput<'Pane'>, sections: SettingsSection[], extra?: RenderElement) {
  const { Box, Text } = $.ui.resolve(e)

  return sections.flatMap((section, index) => [
    ...(index > 0 ? [sectionRule($, e, `rule-${section.key}`)] : []),
    <Box key={`section-${section.key}`} flexDirection="column" gap="sm" alignItems="flex-start">
      <Text bold>{section.title}</Text>
      {section.controls}
      {section.key === 'commands' && extra}
    </Box>,
  ])
}

// The board's own settings, drawn in the Settings row or in a pane of their
// own, as `settingsPlace` says. Only desktop and vscode draw a Select; elsewhere
// a setting is shown, not picked.
async function settingsSections($: EngineInterface, e: ResolveInput<'Pane'>): Promise<SettingsSection[]> {
  const { Text } = $.ui.resolve(e)
  const isMultiline = (await read($, titleMode)) === 'multiline'
  const isSquare = (await read($, cornerStyle)) === 'square'
  const isStacked = (await read($, layoutMode)) === 'stacked'
  const opensInSubs = await read($, isOpenInSubs)
  const metric = await read($, activityMetric)
  const place = await read($, settingsPlace)
  const firstWeekday = await read($, weekStart)
  const barShown = await read($, isCommandBarShown)
  const keys = (await read($, commandDraft)) ?? (await read($, commandKeys))
  if (e.surface !== 'desktop' && e.surface !== 'vscode') {
    return [
      {
        key: 'board',
        title: 'Board',
        controls: [
          <Text dimColor>Layout: {isStacked ? 'stacked' : 'columns'}</Text>,
          <Text dimColor>Titles: {isMultiline ? 'multiline' : 'one line'}</Text>,
          <Text dimColor>Corners: {isSquare ? 'square' : 'rounded'}</Text>,
          <Text dimColor>In sub-sessions: {opensInSubs ? 'opens' : 'closed'}</Text>,
        ],
      },
      {
        key: 'timelines',
        title: 'Timelines',
        controls: [
          <Text dimColor>Timelines: {metric === 'entries' ? 'activity' : metric}</Text>,
          <Text dimColor>Week starts on: {WEEKDAY_NAMES[firstWeekday]}</Text>,
        ],
      },
      { key: 'commands', title: 'Command buttons', controls: [<Text dimColor>Command buttons: {barShown ? 'shown' : 'hidden'}</Text>] },
      {
        key: 'place',
        title: 'Settings',
        controls: [
          <Text dimColor>Settings: {place === 'pane' ? 'own pane' : 'board row'}</Text>,
          <Text dimColor>(change them on the desktop app)</Text>,
        ],
      },
    ]
  }
  const { Select, Input, Button } = $.ui.resolve(e)
  const lastFilled = keys.reduce((last, text, index) => (text.trim() === '' ? last : index + 1), 0)
  const fieldCount = Math.min(COMMAND_KEY_COUNT, Math.max(await read($, commandFieldCount), lastFilled))
  const addField =
    barShown && fieldCount < COMMAND_KEY_COUNT ? (
      <Button
        key="command-add"
        label="+ Add command"
        dimColor
        onPress={() => update($, commandFieldCount, () => fieldCount + 1)}
      />
    ) : null
  const keyFields = barShown
    ? Array.from({ length: fieldCount }, (_, index) => (
        <Input
          key={`command-key-${index + 1}`}
          placeholder="/plugin:command or a prompt"
          value={keys[index] ?? ''}
          onInput={(value: string) => void setCommandDraft($, index, value)}
          onSubmit={(value: string) => void setCommandDraft($, index, value).then(() => applyCommandDraft($))}
        />
      ))
    : []

  const boardControls = [
    <Select
      key="layout"
      label="Layout"
      options={[
        { value: 'columns', label: 'Columns' },
        { value: 'stacked', label: 'Stacked' },
      ]}
      value={isStacked ? 'stacked' : 'columns'}
      onSelect={value => update($, layoutMode, () => (value === 'stacked' ? 'stacked' : 'columns')).then(save($, layoutMode))}
    />,
    <Select
      key="title-mode"
      label="Titles"
      options={[
        { value: 'ellipsis', label: 'One line (…)' },
        { value: 'multiline', label: 'Multiline' },
      ]}
      value={isMultiline ? 'multiline' : 'ellipsis'}
      onSelect={value => update($, titleMode, () => (value === 'multiline' ? 'multiline' : 'ellipsis')).then(save($, titleMode))}
    />,
    <Select
      key="corners"
      label="Corners"
      options={[
        { value: 'square', label: 'Square' },
        { value: 'rounded', label: 'Rounded' },
      ]}
      value={isSquare ? 'square' : 'rounded'}
      onSelect={value => update($, cornerStyle, () => (value === 'rounded' ? 'rounded' : 'square')).then(save($, cornerStyle))}
    />,
    <Select
      key="open-in-subs"
      label="In sub-sessions"
      options={[
        { value: 'closed', label: 'Stay closed' },
        { value: 'open', label: 'Open' },
      ]}
      value={opensInSubs ? 'open' : 'closed'}
      onSelect={value => update($, isOpenInSubs, () => value === 'open').then(save($, isOpenInSubs))}
    />,
  ]
  const timelineControls = [
    <Select
      key="activity"
      label="Timelines"
      options={[
        { value: 'entries', label: 'Activity' },
        { value: 'tokens', label: 'Tokens' },
        { value: 'hidden', label: 'Hidden' },
      ]}
      value={metric}
      onSelect={value => {
        const next: ActivityMetric = value === 'tokens' ? 'tokens' : value === 'hidden' ? 'hidden' : 'entries'
        void update($, activityMetric, () => next).then(save($, activityMetric))
        if (metric === 'hidden' && next !== 'hidden') later($, () => refresh($))
      }}
    />,
    <Select
      key="week-start"
      label="Week starts on"
      options={[1, 2, 3, 4, 5, 6, 0].map(day => ({ value: String(day), label: WEEKDAY_NAMES[day] ?? '' }))}
      value={String(firstWeekday)}
      onSelect={value => {
        const day = Number(value)
        if (Number.isInteger(day) && day >= 0 && day <= 6) void update($, weekStart, () => day).then(save($, weekStart))
      }}
    />,
  ]
  const commandControls = [
    <Select
      key="command-bar"
      label="Show functional buttons"
      options={[
        { value: 'hidden', label: 'Hidden' },
        { value: 'shown', label: 'Shown' },
      ]}
      value={barShown ? 'shown' : 'hidden'}
      onSelect={value => update($, isCommandBarShown, () => value === 'shown').then(save($, isCommandBarShown))}
    />,
    ...keyFields,
    ...(addField ? [addField] : []),
  ]
  const placeControls = [
    // The way back: settings in the board's row, as before they had a pane.
    <Select
      key="settings-place"
      label="Settings in"
      options={[
        { value: 'pane', label: 'Own pane' },
        { value: 'row', label: 'Board row' },
      ]}
      value={place}
      onSelect={value => {
        const next: SettingsPlace = value === 'row' ? 'row' : 'pane'
        void update($, settingsPlace, () => next).then(save($, settingsPlace))
        if (next === 'row') {
          void update($, isSettingsOpen, () => true)
          void $.ui.close({ id: SETTINGS_PANE })
        } else {
          void update($, isSettingsOpen, () => false)
          void $.ui.open({ id: SETTINGS_PANE, title: SETTINGS_TITLE, closeOnEscape: true })
        }
      }}
    />,
  ]

  return [
    { key: 'board', title: 'Board', controls: boardControls },
    { key: 'timelines', title: 'Timelines', controls: timelineControls },
    { key: 'commands', title: 'Command buttons', controls: commandControls },
    { key: 'place', title: 'Settings', controls: placeControls },
  ]
}

// Apply keeps the settings open: the Selects take effect at once, and Apply
// puts the typed commands on the band.
async function applyButton($: EngineInterface, e: ResolveInput<'Pane'>) {
  const { Button } = $.ui.resolve(e)
  const isPending = (await read($, commandDraft)) !== null

  return (
    <Button
      key="settings-apply"
      label="Apply"
      variant={isPending ? 'primary' : 'secondary'}
      onPress={() => applyCommandDraft($)}
    />
  )
}

// The Settings button: the row folds open under the toolbar, the pane opens
// as a tab of its own, or closes when it is the one shown.
async function toggleSettings($: EngineInterface) {
  if ((await read($, settingsPlace)) === 'row') {
    await update($, isSettingsOpen, isOn => !isOn)
    return
  }
  const panes = await $.ui.panes().catch(() => [])
  if (panes.some(pane => pane.id === SETTINGS_PANE && pane.isShown)) {
    await $.ui.close({ id: SETTINGS_PANE })
    return
  }
  await $.ui.open({ id: SETTINGS_PANE, title: SETTINGS_TITLE, closeOnEscape: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'kanban',
      description: 'Show your Code-tab sessions as a Kanban board in a pane',
    })
    isAutoOpenPending = true
    await restoreSettings($)
    startPolling($)
    void refresh($)

    return started
  })

  // A toggle, since the app has no toolbar a mod can add a button to. A board
  // behind another tab is brought forward rather than closed.
  on('command.run', { command: 'kanban' }, async $ => {
    const panes = await $.ui.panes().catch(() => [])
    if (panes.some(pane => pane.id === PANE && pane.isShown)) {
      await $.ui.close({ id: PANE })
      return { text: 'Sessions board closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    startPolling($)
    later($, () => refresh($))

    return { text: 'Sessions board opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" gap="sm" padding={1}>
        {settingsBody($, e, await settingsSections($, e))}
        {sectionRule($, e, 'rule-footer')}
        <Box flexDirection="row" gap="sm" alignItems="center">
          {await applyButton($, e)}
          <Text dimColor size="caption">
            Esc closes the pane. Choices are kept for new sessions.
          </Text>
        </Box>
      </Box>
    )
  })

  // The command buttons, in every session while Settings shows them; a survey
  // takes the band over.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isCommandBarShown))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const keys = (await read($, commandKeys)).slice(0, COMMAND_KEY_COUNT)
    const buttons = keys.flatMap((text, index) =>
      text.trim() === ''
        ? []
        : [
            // The desktop draws a native Button that ignores a coloured label, so
            // a button that runs a command sits in a blue-framed, blue-tinted Box,
            // apart from those that only fill the prompt box.
            text.trim().startsWith('/') ? (
              // No padding: the desktop pads a bordered Box by default, which
              // doubled the button's size. Hidden overflow clips the native
              // button's own backdrop, which showed as a second outline.
              <Box
                key={`command-frame-${index + 1}`}
                borderStyle="round"
                borderColor="suggestion"
                backgroundColor="#3b82f633"
                padding={0}
                overflow="hidden"
              >
                <Button
                  key={`command-key-${index + 1}`}
                  label={commandKeyName(text.trim())}
                  onPress={() => later($, () => runCommandKey($, text.trim()))}
                />
              </Box>
            ) : (
              <Button
                key={`command-key-${index + 1}`}
                label={commandKeyName(text.trim())}
                onPress={() => later($, () => runCommandKey($, text.trim()))}
              />
            ),
          ],
    )

    return (
      <Box flexDirection="row" gap="xs" alignItems="center">
        {buttons.length > 0 ? buttons : <Text dimColor>No commands yet.</Text>}
        {buttons.length === 0 && (
          <Button
            key="command-keys-setup"
            label="Set up"
            onPress={() => $.ui.open({ id: SETTINGS_PANE, title: SETTINGS_TITLE, closeOnEscape: true })}
          />
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, cards)
    const known = await read($, details)
    const chosen = await read($, filter)
    const weekOnly = await read($, isThisWeek)
    const routinesShown = await read($, isRoutinesShown)
    const archivedOpen = await read($, isArchivedOpen)
    const shownIn = await read($, archivedShownIn)
    const openedByHand = await read($, openSections)
    const settingsOpen = await read($, isSettingsOpen)
    const isMultiline = (await read($, titleMode)) === 'multiline'
    // The desktop rounds every bordered Box, so a square card is one with no
    // border at all; a terminal keeps its border, having no fill to show a card by.
    const isSquare = (await read($, cornerStyle)) === 'square' && e.surface !== 'terminal'
    const problem = await read($, failure)
    const lastFetch = await read($, fetchedAt)
    const isStacked = (await read($, layoutMode)) === 'stacked'
    const searchText = await read($, query)
    const needle = searchText.trim().toLowerCase()
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
      (routinesShown || known[card.id]?.isRoutine !== true) &&
      (needle === '' || [card.title, card.branch, card.groupName].some(field => field?.toLowerCase().includes(needle)))
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
    // Archived sub-sessions ride inside their parents' cards, often in another
    // column, so Archived names them beside its own count.
    const topLevelIds = new Set(topLevel.map(card => card.id))
    const archivedInside = all.filter(card => card.isArchived && isVisible(card) && !topLevelIds.has(card.id)).length
    const sectionCount = (column: Column, count: number) =>
      column === ARCHIVED && archivedInside > 0
        ? `${count} · ${archivedInside} sub-session${archivedInside === 1 ? '' : 's'}`
        : String(count)

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

    // Only desktop and vscode draw a Select; elsewhere a choice is shown, not picked.
    let filterControl = <Text dimColor>Section: {options.find(option => option.value === selected)?.label}</Text>
    const metric = await read($, activityMetric)
    const activityOf = metric === 'hidden' ? {} : await read($, activity)
    const firstWeekday = await read($, weekStart)
    const waitingOf = await read($, statuses)
    const settingsRow =
      settingsOpen && (await read($, settingsPlace)) === 'row'
        ? settingsBody($, e, await settingsSections($, e), await applyButton($, e))
        : null
    const countChoice = COUNT_OPTIONS.includes(await read($, loadCount)) ? await read($, loadCount) : String(DEFAULT_COUNT)
    const countLabel = (value: string) => (value === 'all' ? 'All' : value)
    let countControl = <Text dimColor>Load: {countLabel(countChoice)}</Text>
    // A surface with no text field still shows what the board is filtered by.
    let searchControl = needle === '' ? null : <Text dimColor>Search: {searchText}</Text>
    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const { Select, Input } = $.ui.resolve(e)
      searchControl = (
        <Input
          key="search"
          placeholder="Search title, branch, section"
          value={searchText}
          onInput={(value: string) => update($, query, () => value)}
          onSubmit={(value: string) => update($, query, () => value)}
        />
      )
      countControl = (
        <Select
          key="count"
          label="Load"
          options={COUNT_OPTIONS.map(value => ({ value, label: countLabel(value) }))}
          value={countChoice}
          onSelect={value => {
            void update($, loadCount, () => value).then(save($, loadCount))
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
          onSelect={value => update($, filter, () => value).then(save($, filter))}
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

    // What a session's last turn left for the person, while it is not running again.
    const waitingFor = (card: Card) => (card.isRunning || card.isArchived ? undefined : waitingOf[card.id])
    // Orange when the session is blocked on you, blue when it is done and ready for review.
    const waitingDot = (card: Card) => {
      const waiting = waitingFor(card)
      if (!waiting) return null

      return (
        <Box key={`needs-${card.id}`} flexShrink={0}>
          <Text color={waiting.category === 'blocked' ? 'warning' : 'suggestion'}>●</Text>
        </Box>
      )
    }

    // The terminal has no Svg; its board goes without timelines.
    const timelineOf = (card: Card, column: Column, subs: Card[]) => {
      if (metric === 'hidden' || e.surface === 'terminal') return null
      const lifespans = subs.flatMap((sub): Lifespan[] => {
        const createdAt = known[sub.id]?.createdAt
        if (createdAt === undefined) return []
        const color = sub.isArchived ? ARCHIVED_COLOR : sub.isRunning ? RUNNING_COLOR : column.tint.slice(0, 7)
        return [{ start: createdAt, end: sub.isRunning ? now : sub.lastActivityAt, color }]
      })
      const drawing = cardSvg({ hours: activityOf[card.id], metric, lifespans, now, color: column.tint.slice(0, 7) })
      if (!drawing) return null
      const { Svg } = $.ui.resolve(e)

      return (
        <Box key={`activity-${card.id}`} paddingLeft={inset} marginTop="xs">
          <Svg alt={drawing.alt} height={drawing.height} source={drawing.source} />
        </Box>
      )
    }

    const heatmap = () => {
      if (metric === 'hidden' || e.surface === 'terminal') return null
      const perHour = new Map<number, HourCounts>()
      for (const card of all.filter(isVisible)) {
        for (const [hour, counts] of Object.entries(activityOf[card.id] ?? {})) {
          const at = Date.parse(`${hour}:00:00Z`)
          const sum = perHour.get(at) ?? [0, 0, 0]
          perHour.set(at, [sum[0] + counts[0], sum[1] + counts[1], sum[2] + counts[2]])
        }
      }
      const drawing = heatmapSvg(perHour, metric, now, firstWeekday)
      if (!drawing) return null
      const { Svg } = $.ui.resolve(e)

      // Hours 00, 06, 12 and 18 start at each quarter of the grid's width. The row
      // is top-aligned: centred, the day names sat half a row below their cells.
      return (
        <Box key="heatmap" flexDirection="row" gap="xs" paddingX={1} alignItems="flex-start">
          <Box flexShrink={0}>
            <Svg alt="Days of the week" width={HEATMAP_LABEL_WIDTH} height={drawing.height} source={drawing.days} />
          </Box>
          <Box flexDirection="column" flexGrow={1} minWidth={0}>
            <Svg alt={drawing.alt} height={drawing.height} source={drawing.grid} />
            <Box flexDirection="row" width="100%">
              {['00', '06', '12', '18'].map(hour => (
                <Box key={`hour-${hour}`} width="25%" flexDirection="row" justifyContent="space-between">
                  <Text dimColor size="caption">
                    {hour}
                  </Text>
                  {/* The last quarter also names where the day ends, at the grid's right edge. */}
                  {hour === '18' && (
                    <Box key="hour-24">
                      <Text dimColor size="caption">
                        24
                      </Text>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          </Box>
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
    // No split-view button: the app splits in only sessions the board's own session started.
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
    // Archived sub-sessions are listed only in a card whose "Show archived" is on.
    // A hidden one hands its own sub-sessions up to the nearest listed ancestor,
    // as the sidebar does, so a running one is never hidden.
    const listedBelow = (id: string, seen: Set<string>, showsArchived: boolean): Card[] =>
      childrenBelow(id)
        .flatMap(child => {
          if (seen.has(child.id)) return []
          seen.add(child.id)
          return showsArchived || !child.isArchived ? [child] : listedBelow(child.id, seen, showsArchived)
        })
        .sort((a, b) => Number(a.isArchived) - Number(b.isArchived) || b.lastActivityAt - a.lastActivityAt)

    // A sub-session's own sub-sessions sit under it, one indent deeper.
    const subTree = (sub: Card, seen: Set<string>, column: Column, showsArchived: boolean): RenderElement => {
      const marker = sub.isArchived ? '✓' : sub.isRunning ? '●' : '○'
      const color = sub.isArchived ? 'inactive' : sub.isRunning ? 'success' : 'subtle'
      const below = listedBelow(sub.id, seen, showsArchived)

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
            {waitingDot(sub)}
            <Box flexGrow={1} />
            {openIcon(sub)}
          </Box>
          {below.length > 0 && (
            <Box flexDirection="column" paddingLeft={2}>
              {below.map(child => subTree(child, seen, column, showsArchived))}
            </Box>
          )}
        </Box>
      )
    }

    const footerOf = (card: Card, archivedBelow: number, showsArchived: boolean) => {
      const named = `the session "${card.title}" (${card.id})`
      const archivedToggle =
        archivedBelow > 0
          ? [
              action(`archived-${card.id}`, showsArchived ? 'Hide archived' : `Show ${archivedBelow} archived`, () =>
                update($, archivedShownIn, current => ({ ...current, [card.id]: !showsArchived })).then(save($, archivedShownIn)),
              ),
            ]
          : []
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
          <Box flexDirection="row" gap="xs">
            {archivedToggle}
            {right}
          </Box>
        </Box>
      )
    }

    const cardBox = (card: Card, column: Column) => {
      const detail = known[card.id]
      // A routine's runs share one title, so its run date tells them apart.
      const tag = detail?.isRoutine ? shortDate(detail.createdAt) : card.groupName
      const subs = familyOf(card.id, new Set([card.id]))
      const doneCount = subs.filter(sub => sub.isArchived).length
      const seen = new Set([card.id])
      const showsArchived = shownIn[card.id] === true
      const firstLevel = listedBelow(card.id, seen, showsArchived)

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
            {/* No gap inside: the title Button's own inset already spaces it from #. */}
            <Box flexDirection="row" alignItems="flex-start" flexShrink={1} minWidth={0}>
              {action(`copy-${card.id}`, '#', () => copyId($, card))}
              <Box flexDirection="column" flexShrink={1} minWidth={0}>
                {titleOf(card)}
              </Box>
            </Box>
            {waitingDot(card)}
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
          <Box paddingLeft={inset}>
            <Text dimColor size="caption" wrap={isMultiline ? 'wrap' : 'truncate-end'}>
              {age(now - card.lastActivityAt)} ago{card.branch ? ` · ${card.branch}` : ''}
            </Text>
          </Box>
          {timelineOf(card, column, showsArchived ? subs : subs.filter(sub => !sub.isArchived))}
          {subs.length > 0 && (
            <Box flexDirection="column" marginTop="xs" paddingLeft={inset}>
              <Text dimColor size="caption">
                Sub-sessions: {subs.length}
                {doneCount > 0 ? ` (${doneCount} archived)` : ''}
              </Text>
              {firstLevel.map(sub => subTree(sub, seen, column, showsArchived))}
            </Box>
          )}
          {footerOf(card, doneCount, showsArchived)}
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
          {...(isStacked ? {} : { flexGrow: 1, flexShrink: 1, width: 0, minWidth: MIN_COLUMN_WIDTH })}
          gap="xs"
          padding={1}
          {...columnLook(column)}
        >
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text bold color={column.color}>
              {column.title} <Text dimColor>{sectionCount(column, inColumn.length)}</Text>
            </Text>
            {collapse &&
              arrow(column, `collapse-${column.key}`, isStacked ? STACKED_OPEN : column === ARCHIVED ? '❯' : '❮', collapse)}
          </Box>
          {inColumn.length === 0 && (
            <Text dimColor>{column === ARCHIVED && archivedInside > 0 ? 'Archived sub-sessions are listed in their parents’ cards.' : '—'}</Text>
          )}
          {inColumn.slice(0, cap).map(card => cardBox(card, column))}
          {inColumn.length > cap && <Text dimColor>+{inColumn.length - cap} more</Text>}
        </Box>
      )
    }

    // Stacked, a collapsed section is a thin bar across the board with its title, not a rail.
    const rail = (column: Column, glyph: string, count: number | null, expand: () => unknown) =>
      isStacked ? (
        <Box
          key={`rail-${column.key}`}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingX={1}
          paddingY="xs"
          {...columnLook(column)}
        >
          <Text bold color={column.color}>
            {column.title} <Text dimColor>{sectionCount(column, count ?? 0)}</Text>
          </Text>
          {arrow(column, `expand-${column.key}`, STACKED_CLOSED, expand)}
        </Box>
      ) : (
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
              {column === ARCHIVED ? count + archivedInside : count}
            </Text>
          )}
        </Box>
      )

    const archivedCount = cardsIn(ARCHIVED).length
    // In progress opens by itself while something runs; Today and Earlier start open.
    const isOpen = (column: Column) => openedByHand[column.key] ?? (column === PROGRESS ? cardsIn(PROGRESS).length > 0 : true)
    const setOpen = (column: Column, isOn: boolean) =>
      update($, openSections, current => ({ ...current, [column.key]: isOn })).then(save($, openSections))
    const section = (column: Column) => {
      const count = cardsIn(column).length

      return isOpen(column)
        ? fullColumn(column, () => setOpen(column, false))
        : rail(column, '❯', column === PROGRESS && count === 0 ? null : count, () => setOpen(column, true))
    }

    // A brief disconnect is a quiet note beside the count; an error, or a
    // disconnect that outlasts the grace period, also gets the banner below.
    const isSerious = problem !== null && (problem.kind === 'error' || now - problem.since >= OFFLINE_GRACE_MS)
    const dataAge = lastFetch ? `showing data from ${age(now - lastFetch)} ago` : 'no data yet'
    const needYou = all.filter(card => isVisible(card) && waitingFor(card)?.category === 'blocked').length
    const statusNote =
      problem === null ? (
        <Text dimColor>
          {topLevel.length} sessions{needYou > 0 ? ` · ${needYou} need${needYou === 1 ? 's' : ''} you` : ''}
          {lastFetch ? ` · updated ${age(now - lastFetch)} ago` : ' · loading…'}
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
            {searchControl}
            {filterControl}
            {countControl}
            <Button
              key="week"
              label="This week"
              variant={weekOnly ? 'primary' : 'secondary'}
              onPress={() => update($, isThisWeek, isOn => !isOn).then(save($, isThisWeek))}
            />
            <Button
              key="routines"
              label="Show routines"
              variant={routinesShown ? 'primary' : 'secondary'}
              onPress={() => update($, isRoutinesShown, isOn => !isOn).then(save($, isRoutinesShown))}
            />
            <Button key="refresh" label="Refresh" onPress={() => later($, () => refresh($))} />
            {statusNote}
          </Box>
          {/* A word, not a glyph: a Button draws its text at one fixed size. */}
          <Button
            key="settings"
            label="Settings"
            variant={settingsRow ? 'primary' : 'secondary'}
            onPress={() => toggleSettings($)}
          />
        </Box>
        {settingsRow && (
          <Box flexDirection="column" gap="sm">
            {settingsRow}
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
        {heatmap()}
        <Box
          flexDirection={isStacked ? 'column' : 'row'}
          flexWrap={isStacked ? undefined : 'wrap'}
          gap="sm"
          alignItems="stretch"
        >
          {[PROGRESS, ...MIDDLE].map(section)}
          {archivedOpen
            ? fullColumn(ARCHIVED, () => update($, isArchivedOpen, () => false).then(save($, isArchivedOpen)))
            : rail(ARCHIVED, '❮', archivedCount, () => update($, isArchivedOpen, () => true).then(save($, isArchivedOpen)))}
        </Box>
      </Box>
    )
  })
}
