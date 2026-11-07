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
      filter: string
      isThisWeek: boolean
      isRoutinesShown: boolean
      isArchivedOpen: boolean
      openSections: Record<string, boolean>
      isSettingsOpen: boolean
      titleMode: TitleMode
      cornerStyle: CornerStyle
      layoutMode: LayoutMode
      query: string
      loadCount: string
      fetchedAt: number
      failure: Failure | null
    }
  }
}
