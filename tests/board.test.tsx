import { expect, mock, test, type TestBody } from 'claude-code/testing'

const NOW = Date.parse('2026-11-03T12:00:00Z')

const PANE = {
  plugin: 'session-kanban',
  component: 'Pane',
  requestId: 'session-kanban',
  props: {
    title: 'Sessions board',
    isFocused: false,
    bodyColumns: 140,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SESSIONS = [
  { sessionId: 'local_a', title: 'Logging', branch: 'claude/logging-a1b2c3', isRunning: false, isArchived: false, lastActivityAt: '2026-11-03T11:40:00Z', group: { id: 'g1', name: 'Local tools' }, link: 'claude://x/local_a' },
  { sessionId: 'local_b', title: 'API migration', pinned: true, isRunning: false, isArchived: false, lastActivityAt: '2026-11-03T07:00:00Z', group: { id: 'g2', name: 'Backend' }, link: 'claude://x/local_b' },
  { sessionId: 'local_c', title: 'Old spike', isRunning: false, isArchived: false, lastActivityAt: '2026-10-20T07:00:00Z', group: null, link: 'claude://x/local_c' },
  { sessionId: 'local_d', title: 'Shipped thing', isRunning: false, isArchived: true, lastActivityAt: '2026-11-01T07:00:00Z', group: { id: 'g1', name: 'Local tools' }, link: 'claude://x/local_d' },
  { sessionId: 'local_e', title: 'Logging tests', startedBy: 'local_a', isRunning: false, isArchived: true, lastActivityAt: '2026-11-03T11:00:00Z', group: { id: 'g1', name: 'Local tools' }, link: 'claude://x/local_e' },
  { sessionId: 'local_r', title: 'Nightly report', isRunning: false, isArchived: false, lastActivityAt: '2026-11-03T07:02:00Z', group: null, link: 'claude://x/local_r' },
]

// The session the board runs in: list_sessions never returns it, get_session "self" does.
const CURRENT = { sessionId: 'local_s', title: 'Board work', branch: 'claude/board', isRunning: false, isArchived: false, lastActivityAt: '2026-11-03T11:55:00Z', group: null, link: 'claude://x/local_s' }

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

// The board's settings, in a pane of their own.
const SETTINGS = { ...PANE, requestId: 'session-kanban-settings', props: { ...PANE.props, title: 'Board settings' } } as const

// Picks a setting in the settings pane, as the person does, and closes it.
async function pick($: Engine, key: string, value: string) {
  const pane = await $.ui.mount({ ...SETTINGS, surface: 'desktop' })
  await pane.select({ key, value })
  await pane.unmount()
}

// What the settings pane shows for each key named.
async function shownSettings($: Engine, keys: string[]) {
  const pane = await $.ui.mount({ ...SETTINGS, surface: 'desktop' })
  const values = await Promise.all(keys.map(async key => (await pane.find({ key }))?.props.value))
  await pane.unmount()

  return values
}

// What the engine stamps on a typed /kanban.
const RUN_KANBAN = { command: 'kanban', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 140 } } as const

// `listReply` is a function where a test changes the reply between refreshes.
function engine(on: On, listReply: string | ((args: Record<string, unknown>) => string), current: object = CURRENT) {
  const calls: string[] = []
  const opens: string[] = []
  const clock = mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', (_, e) => {
    calls.push(e.tool)
    const id = String(e.args.session_id ?? '')
    const text =
      e.tool === 'list_sessions'
        ? typeof listReply === 'function' ? listReply(e.args) : listReply
        : e.tool === 'get_session' && id === 'self'
          ? JSON.stringify(current)
          : e.tool === 'get_session'
            ? JSON.stringify({ sessionId: id, createdAt: '2026-11-03T07:01:00Z', scheduledTaskId: id === 'local_r' ? 'nightly-report' : undefined })
          : 'Deleted 1 session.'

    return { value: { content: [{ type: 'text', text }], isError: false } }
  })

  return { calls, clock, opens }
}

test('status columns, rails, routines and sub-sessions', async ($, on) => {
  const { calls, clock } = engine(on, JSON.stringify(SESSIONS))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pick($, 'layout', 'columns')
  // Nothing runs, so In progress is a rail with no title; Archived is a rail with its count.
  expect(await ui.find({ type: 'Text', text: /^In progress/ })).toBeUndefined()
  expect(await ui.find({ key: 'expand-progress' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Archived/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^2$/ }))?.text).toBe('2')

  expect((await ui.find({ key: 'local_a' }))?.text).toBe('Logging')
  expect((await ui.find({ key: 'local_s' }))?.text).toBe('Board work')
  expect(await ui.find({ type: 'Text', text: /this session/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '5m ago · claude/board' })).toBeDefined()
  // The board's own session takes its column's hue; the others keep the plain card fill.
  expect((await ui.find({ key: 'card-local_s' }))?.props.backgroundColor).toBe('#3b82f640')
  expect((await ui.find({ key: 'card-local_a' }))?.props.backgroundColor).toBe('#ffffff0f')
  expect((await ui.find({ type: 'Text', text: /20m ago/ }))?.text).toBe('20m ago · claude/logging-a1b2c3')
  expect(await ui.find({ key: 'pin-local_a' })).toBeDefined()
  expect(await ui.find({ key: 'archive-local_a' })).toBeDefined()
  expect((await ui.find({ key: 'pin-local_b' }))?.text).toBe('Unpin')
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Local tools' })).toBeDefined()
  // The archived sub-session is counted in its parent but listed only on its card's "Show archived".
  expect(await ui.find({ key: 'local_e' })).toBeUndefined()
  expect(await ui.find({ key: 'card-local_e' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Sub-sessions: 1 (1 archived)' })).toBeDefined()

  // The routine run is hidden until asked for, then tagged with its run date.
  expect(await ui.find({ key: 'local_r' })).toBeUndefined()
  await ui.press({ key: 'routines' })
  expect(await ui.find({ key: 'local_r' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '03.11.26' })).toBeDefined()

  // Opening the Archived column leaves a card's archived sub-sessions as they were.
  await ui.press({ key: 'expand-archived' })
  expect(await ui.find({ key: 'local_e' })).toBeUndefined()
  expect((await ui.find({ key: 'archived-local_a' }))?.text).toBe('Show 1 archived')
  await ui.press({ key: 'archived-local_a' })
  expect(await ui.find({ key: 'local_e' })).toBeDefined()
  expect((await ui.find({ key: 'archived-local_a' }))?.text).toBe('Hide archived')
  await ui.press({ key: 'archived-local_a' })
  expect(await ui.find({ key: 'local_e' })).toBeUndefined()
  expect(await ui.find({ key: 'local_d' })).toBeDefined()
  expect(await ui.find({ key: 'unarchive-local_d' })).toBeDefined()
  await ui.press({ key: 'delete-local_d' })
  // The delete runs from a timer, outside the press's budget.
  await clock.advance(1)
  expect(calls).toContain('delete_session')
  await ui.press({ key: 'collapse-archived' })
  expect(await ui.find({ key: 'local_d' })).toBeUndefined()

  await pick($, 'title-mode', 'multiline')
  expect(await ui.find({ key: 'open-local_a' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Logging' })).toBeDefined()
  await pick($, 'title-mode', 'ellipsis')
  await pick($, 'corners', 'rounded')
  expect(await ui.find({ key: 'local_a' })).toBeDefined()

  await ui.press({ key: 'expand-progress' })
  expect(await ui.find({ type: 'Text', text: /^In progress/ })).toBeDefined()

  expect(await ui.find({ key: 'local_c' })).toBeDefined()
  await ui.press({ key: 'week' })
  expect(await ui.find({ key: 'local_c' })).toBeUndefined()

  await ui.select({ key: 'filter', value: 'g1' })
  expect(await ui.find({ key: 'local_b' })).toBeUndefined()
  expect(await ui.find({ key: 'local_a' })).toBeDefined()
  await ui.unmount()

  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const other = await $.ui.mount({ ...PANE, surface })
    expect(await other.find({ key: 'local_a' })).toBeDefined()
    await other.unmount()
  }
})

test('a list too large to pass back is asked again at half the limit', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const limits: unknown[] = []
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'list_sessions') limits.push(e.args.limit)
    const tooBig = e.tool === 'list_sessions' && Number(e.args.limit) > 300
    const active = SESSIONS.filter(one => !one.isArchived)
    const text = tooBig
      ? 'Error: result (110,095 characters) exceeds maximum allowed tokens.'
      : e.tool === 'list_sessions'
        ? JSON.stringify(e.args.include_archived ? SESSIONS : active)
        : '{}'

    return { value: { content: [{ type: 'text', text }], isError: false } }
  })

  await $.command.run(RUN_KANBAN)
  await clock.advance(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'count', value: 'all' })
  await clock.advance(1)

  // 25 by default, then "All": 1000 refused, 500 refused, 250 fits, for each of the two asks.
  expect(limits).toEqual([25, 25, 1000, 500, 250, 1000, 500, 250])
  expect(await ui.find({ key: 'local_a' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /exceeds/ })).toBeUndefined()
  await ui.unmount()
})

test('a card is in progress while a sub-session beneath it runs', async ($, on) => {
  const family = [
    { sessionId: 'local_p', title: 'Parent', isRunning: false, isArchived: false, lastActivityAt: '2026-11-03T11:59:00Z', group: null, link: 'claude://x/local_p' },
    { sessionId: 'local_k', title: 'Child', startedBy: 'local_p', isRunning: false, isArchived: false, lastActivityAt: '2026-11-03T11:59:00Z', group: null, link: 'claude://x/local_k' },
    { sessionId: 'local_g', title: 'Grandchild', startedBy: 'local_k', isRunning: true, isArchived: false, lastActivityAt: '2026-11-03T11:59:00Z', group: null, link: 'claude://x/local_g' },
  ]
  const { clock } = engine(on, JSON.stringify(family))
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Only the grandchild runs, yet the whole family's card counts as in progress.
  expect((await ui.find({ type: 'Text', text: /^In progress/ }))?.text).toBe('In progress 1')
  expect(await ui.find({ key: 'local_k' })).toBeDefined()
  // The grandchild is listed too, under the child, and counted in the parent's tasks.
  expect(await ui.find({ key: 'local_g' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Sub-sessions: 2' })).toBeDefined()
  expect(await ui.find({ key: 'archive-local_p' })).toBeUndefined()
  await ui.unmount()
})

test('sub-sessions of a hidden archived sub-session move up to the card', async ($, on) => {
  const family = [
    { sessionId: 'local_p', title: 'Parent', isRunning: false, isArchived: false, lastActivityAt: '2026-11-03T11:59:00Z', group: null, link: 'claude://x/local_p' },
    { sessionId: 'local_k', title: 'Done child', startedBy: 'local_p', isRunning: false, isArchived: true, lastActivityAt: '2026-11-03T11:58:00Z', group: null, link: 'claude://x/local_k' },
    { sessionId: 'local_g', title: 'Running grandchild', startedBy: 'local_k', isRunning: true, isArchived: false, lastActivityAt: '2026-11-03T11:59:00Z', group: null, link: 'claude://x/local_g' },
  ]
  const { clock } = engine(on, JSON.stringify(family))
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // With archived ones hidden the archived child is gone, but its running child still shows.
  expect(await ui.find({ key: 'local_k' })).toBeUndefined()
  expect(await ui.find({ key: 'local_g' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Sub-sessions: 2 (1 archived)' })).toBeDefined()
  // Shown, the tree is whole again, the grandchild under its own parent.
  await ui.press({ key: 'archived-local_p' })
  expect(await ui.find({ key: 'local_k' })).toBeDefined()
  expect(await ui.find({ key: 'local_g' })).toBeDefined()
  await ui.unmount()
})

test('a session that stops running is announced once', async ($, on) => {
  const running = { sessionId: 'local_w', title: 'Long task', isRunning: true, isArchived: false, lastActivityAt: '2026-11-03T11:59:00Z', group: null, link: 'claude://x/local_w' }
  let reply = [running]
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const { clock } = engine(on, () => JSON.stringify(reply))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1)
  expect(toasts).toEqual([])

  reply = [{ ...running, isRunning: false }]
  await clock.advance(30_000)
  expect(toasts).toEqual(['Finished: "Long task"'])
  // Still stopped on the next poll: no second toast.
  await clock.advance(30_000)
  expect(toasts).toEqual(['Finished: "Long task"'])
})

test('# copies the session id, through pbcopy where the surface has no clipboard', async ($, on) => {
  const toasts: string[] = []
  const piped: string[] = []
  let canCopy = true
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', () => ({ value: canCopy ? { isCopied: true } : { isCopied: false, reason: 'no-clipboard' } }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'pbcopy') piped.push(`${e.argv.join(' ')} < ${e.init?.stdin}`)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const { clock } = engine(on, JSON.stringify(SESSIONS))
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'copy-local_a' })
  expect(toasts).toEqual(['Copied local_a'])
  expect(piped).toEqual([])
  canCopy = false
  await ui.press({ key: 'copy-local_b' })
  expect(piped).toEqual(['pbcopy < local_b'])
  expect(toasts).toEqual(['Copied local_a', 'Copied local_b'])
  await ui.unmount()
})

test('stacked layout keeps the sections, with collapsed ones as titled bars', async ($, on) => {
  const { clock } = engine(on, JSON.stringify(SESSIONS))
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Stacked is the default layout, so nothing is picked in Settings.
  // A collapsed section is a bar that names itself, unlike a rail.
  expect((await ui.find({ type: 'Text', text: /^In progress/ }))?.text).toBe('In progress 0')
  expect((await ui.find({ type: 'Text', text: /^Archived/ }))?.text).toBe('Archived 1 · 1 sub-session')
  expect(await ui.find({ key: 'local_a' })).toBeDefined()
  await ui.press({ key: 'expand-archived' })
  expect(await ui.find({ key: 'local_d' })).toBeDefined()
  await ui.press({ key: 'collapse-archived' })
  expect(await ui.find({ key: 'local_d' })).toBeUndefined()
  // Today starts open and collapses to a bar with its count like any other section.
  await ui.press({ key: 'collapse-today' })
  expect(await ui.find({ key: 'local_a' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Today/ }))?.text).toBe('Today 3')
  await ui.press({ key: 'expand-today' })
  expect(await ui.find({ key: 'local_a' })).toBeDefined()
  await ui.unmount()
})

test('the search box keeps matching cards and a matching sub-session', async ($, on) => {
  const { clock } = engine(on, JSON.stringify(SESSIONS))
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'search', text: 'BACKEND', kind: 'change' })
  // Matched by its section, case aside; the others drop out.
  expect(await ui.find({ key: 'local_b' })).toBeDefined()
  expect(await ui.find({ key: 'local_a' })).toBeUndefined()
  // A branch matches too.
  await ui.input({ key: 'search', text: 'logging-a1', kind: 'change' })
  expect(await ui.find({ key: 'local_a' })).toBeDefined()
  expect(await ui.find({ key: 'local_b' })).toBeUndefined()
  await ui.input({ key: 'search', text: '', kind: 'change' })
  expect(await ui.find({ key: 'local_b' })).toBeDefined()
  await ui.unmount()
})

test('a lost connection keeps the cards, retries soon, and escalates when it lasts', async ($, on) => {
  // What the engine answers while the app's tools reconnect after the Mac wakes.
  const OFFLINE = 'HooksError: session-kanban: $.mcp.call: no connected MCP tool "list_sessions" on a server named "ccd_session_mgmt"'
  let reply = JSON.stringify(SESSIONS)
  const { calls, clock } = engine(on, () => reply)
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'local_a' })).toBeDefined()

  reply = OFFLINE
  await ui.press({ key: 'refresh' })
  await clock.advance(1)
  expect(await ui.find({ key: 'local_a' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Can't reach the app/ }))?.text).toBe(
    "Can't reach the app right now · retrying · showing data from 0m ago",
  )
  expect(await ui.find({ type: 'Text', text: /can't reach the app's session list/ })).toBeUndefined()

  const asked = calls.filter(tool => tool === 'list_sessions').length
  await clock.advance(5_000)
  expect(calls.filter(tool => tool === 'list_sessions').length).toBeGreaterThan(asked)

  await clock.advance(4 * 60_000)
  expect(await ui.find({ type: 'Text', text: /can't reach the app's session list/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: OFFLINE })).toBeDefined()

  reply = JSON.stringify(SESSIONS)
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Text', text: /Can't reach/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /sessions · updated 0m ago/ })).toBeDefined()
  await ui.unmount()
})

test('any other failure shows the banner at once, with its details', async ($, on) => {
  // The app's tool reports some failures as plain text with isError false.
  const { clock } = engine(on, 'Error: permission denied')
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'The app could not list your sessions' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Error: permission denied' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Refresh failed · no data yet/ })).toBeDefined()
  await ui.unmount()
})

test('a session with background tasks still running shows as in progress', async ($, on) => {
  let busy = 'local_a 2\n'
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[0] === '/bin/sh' ? busy : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  const { clock } = engine(on, JSON.stringify(SESSIONS))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^In progress/ }))?.text).toBe('In progress 1')
  expect(await ui.find({ key: 'local_a' })).toBeDefined()
  // When the last task ends the session counts as finished, like any other.
  busy = ''
  await clock.advance(30_000)
  expect((await ui.find({ type: 'Text', text: /^In progress/ }))?.text).toBe('In progress 0')
  expect(toasts).toEqual(['Finished: "Logging"'])
  await ui.unmount()
})

test('/kanban closes a shown board and opens a hidden one', async ($, on) => {
  let shown = true
  const closed: string[] = []
  on('ui.panes', () => ({ value: [{ id: 'session-kanban', title: 'Sessions board', isShown: shown, isFocused: false, isPlaced: true }] }))
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  engine(on, JSON.stringify(SESSIONS))
  expect((await $.command.run(RUN_KANBAN))?.text).toBe('Sessions board closed.')
  expect(closed).toEqual(['session-kanban'])
  // Behind another tab it is brought forward, not closed.
  shown = false
  expect((await $.command.run(RUN_KANBAN))?.text).toBe('Sessions board opened.')
  expect(closed).toEqual(['session-kanban'])
})

test('archived sessions behind many archived sub-sessions still reach the Archived column', async ($, on) => {
  const parent = { sessionId: 'local_p', title: 'Busy parent', isRunning: false, isArchived: false, lastActivityAt: '2026-11-03T11:59:00Z', group: null, link: 'claude://x/local_p' }
  const subs = Array.from({ length: 30 }, (_, i) => ({
    sessionId: `local_sub${i}`, title: `Sub ${i}`, startedBy: 'local_p', isRunning: false, isArchived: true,
    lastActivityAt: new Date(Date.parse('2026-11-03T11:00:00Z') - i * 60_000).toISOString(), group: null, link: `claude://x/local_sub${i}`,
  }))
  const old = { sessionId: 'local_old', title: 'Old archived', isRunning: false, isArchived: true, lastActivityAt: '2026-11-02T07:00:00Z', group: null, link: 'claude://x/local_old' }
  const asked: number[] = []
  const { clock } = engine(on, args => {
    if (args.include_archived !== true) return JSON.stringify([parent])
    asked.push(Number(args.limit))
    return JSON.stringify([parent, ...subs, old].slice(0, Number(args.limit)))
  })
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)

  // 25 rows hold only the parent and its sub-sessions, so the list is asked again wider.
  expect(asked).toEqual([25, 50])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Archived/ }))?.text).toBe('Archived 1 · 30 sub-sessions')
  await ui.press({ key: 'expand-archived' })
  expect(await ui.find({ key: 'local_old' })).toBeDefined()
  await ui.unmount()
})

test('the board opens by itself in a root session only', async ($, on) => {
  const { clock, opens } = engine(on, JSON.stringify(SESSIONS))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1)
  expect(opens).toEqual(['session-kanban'])
})

test('a sub-session neither opens the board nor polls until /kanban', async ($, on) => {
  const sub = { ...CURRENT, startedBy: 'local_a' }
  const { calls, clock, opens } = engine(on, JSON.stringify(SESSIONS), sub)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1)
  expect(opens).toEqual([])
  const listed = calls.filter(tool => tool === 'list_sessions').length
  await clock.advance(60_000)
  expect(calls.filter(tool => tool === 'list_sessions').length).toBe(listed)
  // Asked for, it opens and keeps itself current like anywhere else.
  await $.command.run(RUN_KANBAN)
  expect(opens).toEqual(['session-kanban'])
  await clock.advance(30_000)
  expect(calls.filter(tool => tool === 'list_sessions').length).toBeGreaterThan(listed)
})

// The plugin's store, which outlives a session, as a map a test can preload and read.
function store(on: On, saved: Record<string, unknown> = {}) {
  const stored = new Map<string, unknown>(Object.entries(saved))
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })

  return stored
}

test('with "In sub-sessions: Open" a sub-session opens the board too', async ($, on) => {
  const sub = { ...CURRENT, startedBy: 'local_a' }
  const stored = store(on)
  const { clock, opens } = engine(on, JSON.stringify(SESSIONS), sub)
  expect(await shownSettings($, ['open-in-subs'])).toEqual(['closed'])
  await pick($, 'open-in-subs', 'open')
  // Kept in the store, so it reaches sessions started later.
  expect(stored.get('isOpenInSubs')).toBe(true)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1)
  expect(opens).toEqual(['session-kanban'])
})

test('settings chosen in one session are where the next session starts', async ($, on) => {
  // Saved by an earlier session; a value of the wrong type is passed over.
  const stored = store(on, { layoutMode: 'columns', titleMode: 'multiline', cornerStyle: 'rounded', loadCount: 50, openSections: { today: false } })
  const { clock } = engine(on, JSON.stringify(SESSIONS))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1)

  expect(await shownSettings($, ['layout', 'title-mode', 'corners'])).toEqual(['columns', 'multiline', 'rounded'])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'count' }))?.props.value).toBe('25')
  expect(await ui.find({ key: 'local_a' })).toBeUndefined()
  // What changes now is saved for the session after.
  await ui.press({ key: 'expand-today' })
  await ui.select({ key: 'filter', value: 'g1' })
  expect(stored.get('openSections')).toEqual({ today: true })
  expect(stored.get('filter')).toBe('g1')
  await ui.unmount()
})

// Answers the activity script with `stdout` and notes "<mode> <since> <ids>" per call.
function activityScript(on: On, stdout: () => string) {
  const asked: string[] = []
  on('process.run', (_, e) => {
    const isActivity = String(e.argv[1]).endsWith('/hooks/activity.sh')
    if (isActivity) asked.push(`${e.argv[3]} ${e.argv[2]} ${String(e.init?.stdin).trim().split('\n').join(',')}`)
    return { value: { exitCode: 0, stdout: isActivity ? stdout() : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return asked
}

test('each card with recent transcript entries shows a week of activity, or of tokens', async ($, on) => {
  const asked = activityScript(
    on,
    () =>
      'hours local_a 2026-11-03T10=5,1000,100 2026-11-03T04=2,9000,900 2026-10-20T10=9,1,1\nhours local_c 2026-10-20T10=9,1,1\n' +
      // Last Wednesday counts on the heatmap; the Tuesday a week ago is past its 7 days.
      'hours local_d 2026-10-28T10=3,10,1 2026-10-27T13=50,1,1\nhours not-a-session 1=1\n',
  )
  const { clock } = engine(on, JSON.stringify(SESSIONS))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1)

  // Only unarchived sessions active in the window are asked about, from its first hour on.
  expect(asked[0]).toBe('all 2026-10-27T12 local_a,local_b,local_r,local_s')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const timelines = async () => (await ui.findAll({ type: 'Svg' })).filter(found => /^(Activity|Tokens) over/.test(String(found.props.alt)))
  let drawn = await timelines()
  expect(drawn).toHaveLength(1)
  expect(await ui.find({ key: 'activity-local_a' })).toBeDefined()
  expect(drawn[0]?.props.alt).toBe('Activity over the last 7 days: busy in 2 of 56 three-hour spans')
  // The busier span is full height; the hour outside the week is not drawn.
  let source = String(drawn[0]?.props.source)
  expect(source).toContain('<rect x="330" y="2" width="5" height="14"/>')
  // A picture, stretched to the card's width, with no tooltips.
  expect(drawn[0]?.props.isInteractive).toBeUndefined()
  expect(source).toContain('width="4000"')
  expect(source).not.toContain('<title>')
  // The whole board's week, by day and hour, above the sections.
  expect(await ui.find({ key: 'heatmap' })).toBeDefined()

  await pick($, 'activity', 'tokens')
  drawn = await timelines()
  source = String(drawn[0]?.props.source)
  expect(drawn[0]?.props.alt).toBe('Tokens over the last 7 days: busy in 2 of 56 three-hour spans')
  expect(source).toContain('<rect x="318" y="2" width="5" height="14"/>')
  const heat = (await ui.findAll({ type: 'Svg' })).find(found => String(found.props.alt).startsWith('Tokens of the sessions shown'))
  // The grid is wider than any pane, so it fills the board's width; its text sits outside it.
  expect(String(heat?.props.source)).toContain('width="4000"')
  expect(String(heat?.props.source)).not.toContain('<text')
  expect(await ui.find({ key: 'hour-18' })).toBeDefined()
  expect(await ui.find({ key: 'hour-24' })).toBeDefined()
  expect(heat?.props.alt).toBe('Tokens of the sessions shown, by day and hour: busy in 3 of 168 hours in the last 7 days')
  // The last 7 days in the week's order, Monday first; 2026-11-03 is a Tuesday, so it is the brighter day.
  const dayNames = async () => {
    const days = (await ui.findAll({ type: 'Svg' })).find(found => found.props.alt === 'Days of the week')
    return String(days?.props.source)
  }
  expect((await dayNames()).match(/>\w{3}</g)?.join('')).toBe('>Mon<>Tue<>Wed<>Thu<>Fri<>Sat<>Sun<')
  expect(await dayNames()).toContain('fill="#d4d4d4">Tue<')
  // Another first day of the week reorders the rows, and is kept for new sessions.
  expect(await shownSettings($, ['week-start'])).toEqual(['1'])
  await pick($, 'week-start', '0')
  expect((await dayNames()).match(/>\w{3}</g)?.join('')).toBe('>Sun<>Mon<>Tue<>Wed<>Thu<>Fri<>Sat<')

  await pick($, 'activity', 'hidden')
  expect(await timelines()).toHaveLength(0)
  expect(await ui.find({ key: 'heatmap' })).toBeUndefined()
  // Hidden, the script still reads what sessions wait for, but no transcripts.
  await clock.advance(30_000)
  expect(asked.at(-1)?.startsWith('status ')).toBe(true)
  await ui.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  await terminal.unmount()
})

test('a session waiting on you has a dot by its title, and the toolbar counts them', async ($, on) => {
  activityScript(on, () => 'status local_b blocked pick one of \\"A\\" or B\nstatus local_c review_ready \nstatus local_a completed nothing\n')
  const { clock } = engine(on, JSON.stringify(SESSIONS))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'needs-local_b' })).toBeDefined()
  expect(await ui.find({ key: 'needs-local_c' })).toBeDefined()
  // Just the dot: neither words nor what the session waits for.
  expect(await ui.find({ type: 'Text', text: /pick one of|Needs you|Ready for review/ })).toBeUndefined()
  // A completed turn waits for nothing.
  expect(await ui.find({ key: 'needs-local_a' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /· 1 needs you ·/ })).toBeDefined()
  await ui.unmount()
})

test("a parent card lines up its sub-sessions' lifespans under its timeline", async ($, on) => {
  const withSub = [
    ...SESSIONS,
    { sessionId: 'local_f', title: 'Logging <docs>', startedBy: 'local_a', isRunning: false, isArchived: false, lastActivityAt: '2026-11-03T11:30:00Z', group: { id: 'g1', name: 'Local tools' }, link: 'claude://x/local_f' },
  ]
  activityScript(on, () => 'hours local_a 2026-11-03T10=5,1000,100\nstatus local_f blocked answer me\n')
  const { clock } = engine(on, JSON.stringify(withSub))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const chart = (await ui.findAll({ type: 'Svg' })).find(found => String(found.props.alt).startsWith('Activity over'))
  expect(chart?.props.alt).toBe('Activity over the last 7 days: busy in 1 of 56 three-hour spans; 1 sub-session on the same days')
  // The archived sub-session stays out until the card shows archived ones.
  const source = String(chart?.props.source)
  expect(source.match(/height="3"/g)).toHaveLength(1)
  expect(source).toContain('y="19"')
  expect(chart?.props.height).toBe(22)
  // A sub-session line says when it is the one waiting.
  expect(await ui.find({ key: 'needs-local_f' })).toBeDefined()
  await ui.unmount()
})

test('Settings opens a pane of its own, and can go back to the board row', async ($, on) => {
  const stored = store(on)
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const { clock, opens: opened } = engine(on, JSON.stringify(SESSIONS))
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'settings' })
  expect(opened.at(-1)).toBe('session-kanban-settings')
  // The board keeps no settings row while they have a pane.
  expect(await ui.find({ key: 'layout' })).toBeUndefined()
  const pane = await $.ui.mount({ ...SETTINGS, surface: 'desktop' })
  expect((await pane.find({ key: 'settings-place' }))?.props.value).toBe('pane')
  await pane.select({ key: 'settings-place', value: 'row' })
  await pane.unmount()
  expect(closed).toContain('session-kanban-settings')
  expect(stored.get('settingsPlace')).toBe('row')
  // Back in the row, which the Settings button folds away and open again.
  expect(await ui.find({ key: 'layout' })).toBeDefined()
  await ui.press({ key: 'settings' })
  expect(await ui.find({ key: 'layout' })).toBeUndefined()
  await ui.press({ key: 'settings' })
  await ui.select({ key: 'settings-place', value: 'pane' })
  expect(opened.at(-1)).toBe('session-kanban-settings')
  expect(await ui.find({ key: 'layout' })).toBeUndefined()
  await ui.unmount()
})

const BAND = {
  plugin: 'session-kanban',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('command buttons run their slash command, or put their prompt in the box to send', async ($, on) => {
  const stored = store(on)
  const ran: string[] = []
  const filled: string[] = []
  on('command.run', (_, e) => {
    ran.push(`${e.command}|${e.args}`)
    return {}
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  const { clock } = engine(on, JSON.stringify(SESSIONS))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // Off until Settings shows them.
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  await pick($, 'command-bar', 'shown')
  expect(stored.get('isCommandBarShown')).toBe(true)
  expect(await band.find({ type: 'Text', text: 'No commands yet.' })).toBeDefined()
  expect(await band.find({ key: 'command-keys-setup' })).toBeDefined()

  const pane = await $.ui.mount({ ...SETTINGS, surface: 'desktop' })
  // Sections, each titled, with a rule between them.
  expect((await pane.find({ type: 'Text', text: 'Command buttons' }))?.text).toBe('Command buttons')
  // Three between the four sections, one over Apply.
  expect((await pane.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toEqual(Array(4).fill('Section separator'))
  // Three fields to start with, and one more for each Add command.
  expect(await pane.find({ key: 'command-key-3' })).toBeDefined()
  expect(await pane.find({ key: 'command-key-4' })).toBeUndefined()
  await pane.press({ key: 'command-add' })
  expect(await pane.find({ key: 'command-key-4' })).toBeDefined()
  await pane.input({ key: 'command-key-1', text: '/session:close-out', kind: 'change' })
  await pane.input({ key: 'command-key-4', text: 'Summarize the diff', kind: 'change' })
  // Typing alone puts nothing on the band.
  expect(await band.find({ key: 'command-key-1' })).toBeUndefined()
  expect(stored.get('commandKeys')).toBeUndefined()
  await pane.press({ key: 'settings-apply' })
  // Apply leaves the pane open.
  expect(await pane.find({ key: 'command-key-1' })).toBeDefined()
  await pane.unmount()
  expect(stored.get('commandKeys')).toEqual(['/session:close-out', '', '', 'Summarize the diff', '', '', '', '', '', '', '', ''])

  // Empty slots are left out; a button shows its command's name only.
  expect((await band.find({ key: 'command-key-1' }))?.text).toBe('close-out')
  expect(await band.find({ key: 'command-key-2' })).toBeUndefined()
  expect((await band.find({ key: 'command-key-4' }))?.text).toBe('Summarize the diff')
  // A command's button sits in a blue frame; a prompt's stands plain.
  expect((await band.find({ key: 'command-frame-1' }))?.props.borderColor).toBe('suggestion')
  expect(await band.find({ key: 'command-frame-4' })).toBeUndefined()
  // Commands sit at the leading edge, prompts at the trailing one.
  expect((await band.find({ key: 'band-commands' }))?.text).toBe('close-out')
  expect((await band.find({ key: 'band-prompts' }))?.text).toBe('Summarize the diff')
  await band.press({ key: 'command-key-1' })
  await band.press({ key: 'command-key-4' })
  await clock.advance(1)
  expect(ran).toContain('session:close-out|')
  // A prompt is left in the box for the person to send as their own.
  expect(filled).toEqual(['Summarize the diff'])

  // A field stays shown while it holds a command, past the three.
  const again = await $.ui.mount({ ...SETTINGS, surface: 'desktop' })
  expect(await again.find({ key: 'command-key-4' })).toBeDefined()
  await again.unmount()

  await pick($, 'command-bar', 'hidden')
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  await band.unmount()
})
