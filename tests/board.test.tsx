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

// What the engine stamps on a typed /kanban.
const RUN_KANBAN = { command: 'kanban', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 140 } } as const

// `listReply` is a function where a test changes the reply between refreshes.
function engine(on: On, listReply: string | (() => string)) {
  const calls: string[] = []
  const clock = mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', (_, e) => {
    calls.push(e.tool)
    const id = String(e.args.session_id ?? '')
    const text =
      e.tool === 'list_sessions'
        ? typeof listReply === 'function' ? listReply() : listReply
        : e.tool === 'get_session' && id === 'self'
          ? JSON.stringify(CURRENT)
          : e.tool === 'get_session'
            ? JSON.stringify({ sessionId: id, createdAt: '2026-11-03T07:01:00Z', scheduledTaskId: id === 'local_r' ? 'nightly-report' : undefined })
          : 'Deleted 1 session.'

    return { value: { content: [{ type: 'text', text }], isError: false } }
  })

  return { calls, clock }
}

test('status columns, rails, routines and sub-sessions', async ($, on) => {
  const { calls, clock } = engine(on, JSON.stringify(SESSIONS))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN_KANBAN)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Nothing runs, so In progress is a rail with no title; Archived is a rail with its count.
  expect(await ui.find({ type: 'Text', text: /^In progress/ })).toBeUndefined()
  expect(await ui.find({ key: 'expand-progress' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Archived/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^1$/ }))?.text).toBe('1')

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
  // The archived sub-session is counted in its parent but listed only with Archived open.
  expect(await ui.find({ key: 'local_e' })).toBeUndefined()
  expect(await ui.find({ key: 'card-local_e' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Sub-sessions: 1 (1 archived)' })).toBeDefined()

  // The routine run is hidden until asked for, then tagged with its run date.
  expect(await ui.find({ key: 'local_r' })).toBeUndefined()
  await ui.press({ key: 'routines' })
  expect(await ui.find({ key: 'local_r' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '03.11.26' })).toBeDefined()

  await ui.press({ key: 'expand-archived' })
  expect(await ui.find({ key: 'local_e' })).toBeDefined()
  expect(await ui.find({ key: 'local_d' })).toBeDefined()
  expect(await ui.find({ key: 'unarchive-local_d' })).toBeDefined()
  await ui.press({ key: 'delete-local_d' })
  // The delete runs from a timer, outside the press's budget.
  await clock.advance(1)
  expect(calls).toContain('delete_session')
  await ui.press({ key: 'collapse-archived' })
  expect(await ui.find({ key: 'local_d' })).toBeUndefined()

  await ui.press({ key: 'settings' })
  await ui.select({ key: 'title-mode', value: 'multiline' })
  expect(await ui.find({ key: 'open-local_a' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Logging' })).toBeDefined()
  await ui.select({ key: 'title-mode', value: 'ellipsis' })
  await ui.select({ key: 'corners', value: 'rounded' })
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
  // With Archived closed the archived child is hidden, but its running child still shows.
  expect(await ui.find({ key: 'local_k' })).toBeUndefined()
  expect(await ui.find({ key: 'local_g' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Sub-sessions: 2 (1 archived)' })).toBeDefined()
  // With Archived open the tree is whole again, the grandchild under its own parent.
  await ui.press({ key: 'expand-archived' })
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
  await ui.press({ key: 'settings' })
  await ui.select({ key: 'layout', value: 'stacked' })
  // A collapsed section is a bar that names itself, unlike a rail.
  expect((await ui.find({ type: 'Text', text: /^In progress/ }))?.text).toBe('In progress 0')
  expect((await ui.find({ type: 'Text', text: /^Archived/ }))?.text).toBe('Archived 1')
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
  expect(await ui.find({ type: 'Text', text: /^In progress/ })).toBeUndefined()
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
