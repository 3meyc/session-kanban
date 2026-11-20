export type Card = {
  id: string
  title: string
  groupId: string | null
  groupName: string | null
  branch: string | null
  link: string | null
  parentId: string | null
  isRunning: boolean
  isArchived: boolean
  isPinned: boolean
  // The session the board runs in, which list_sessions leaves out.
  isCurrent: boolean
  lastActivityAt: number
}

// What only get_session tells about a session; fixed for its life, so looked up once.
export type Detail = { isRoutine: boolean; createdAt: number }

// One UTC hour of a session: transcript entries, tokens its replies used, and
// of those the output tokens.
export type HourCounts = [entries: number, tokens: number, output: number]

// By session id, then UTC hour ("YYYY-MM-DDTHH"); only hours in the timeline's
// window, and only sessions that wrote in it.
export type Activity = Record<string, Record<string, HourCounts>>

// What the card timelines and the heatmap measure, or neither drawn.
export type ActivityMetric = 'entries' | 'tokens' | 'hidden'

// Where the Settings button shows the board's settings: a pane of their own,
// or a row folded open under the toolbar.
export type SettingsPlace = 'pane' | 'row'

// The app's summary of a session's last turn, kept only when the session waits
// on the person: blocked on an answer, or done and ready for review.
export type TurnStatus = { category: 'blocked' | 'review_ready'; needsAction: string }

export type TitleMode = 'ellipsis' | 'multiline'

export type CornerStyle = 'square' | 'rounded'

// Status columns side by side, or the same sections stacked in one column.
export type LayoutMode = 'columns' | 'stacked'
// The last failed load: `offline` while the app's tools are reconnecting,
// `error` for anything else; `since` is when the run of failures began.
export type Failure = { kind: 'offline' | 'error'; message: string; since: number; attempts: number }

declare module 'claude-code' {
  interface PluginState {
    'session-kanban': {
      cards: Shaped<Card[]>
      details: Shaped<Record<string, Detail>>
      activity: Shaped<Activity>
      statuses: Shaped<Record<string, TurnStatus>>
      activityMetric: ActivityMetric
      filter: string
      isThisWeek: boolean
      isRoutinesShown: boolean
      isArchivedOpen: boolean
      archivedShownIn: Record<string, boolean>
      openSections: Record<string, boolean>
      isSettingsOpen: boolean
      settingsPlace: SettingsPlace
      // The first day of the week, as Date.getDay() numbers it (0 Sunday … 6 Saturday).
      weekStart: number
      // The command buttons above the prompt, F1 first: what each runs as typed,
      // a slash command or a prompt; '' leaves that button out.
      commandKeys: string[]
      isCommandBarShown: boolean
      titleMode: TitleMode
      cornerStyle: CornerStyle
      isOpenInSubs: boolean
      layoutMode: LayoutMode
      query: string
      loadCount: string
      fetchedAt: number
      failure: Failure | null
    }
  }
}
