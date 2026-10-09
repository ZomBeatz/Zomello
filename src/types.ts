export type ID = string;

export type Priority = "urgent" | "important" | "medium" | "low";
export type Progress = "notStarted" | "inProgress" | "completed";

export interface Label {
  id: ID;
  name: string;
  color: string;
}

export interface ChecklistItem {
  id: ID;
  text: string;
  done: boolean;
  /** When set, this item mirrors another card (its title and completion). */
  cardId?: ID | null;
}

export type LinkType = "relates" | "blocks" | "blockedBy";

/** Stored on both cards, with the inverse type on the other side. */
export interface CardLink {
  cardId: ID;
  type: LinkType;
}

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
  freq: RecurrenceFreq;
  /** Every N days/weeks/months/years. */
  interval: number;
  /** Weekly only: 0 = Sunday … 6 = Saturday. Empty = same weekday as the due date. */
  weekdays: number[];
  /** Last date (yyyy-MM-dd) an occurrence may fall on. */
  until: string | null;
}

export interface Attachment {
  id: ID;
  name: string;
  /** A link/path, or for stored files `attachments/…` (relative to the data dir; data: URL in browser dev). */
  url: string;
  addedAt: number;
  /** True when the file was copied into Zomello's own storage. */
  stored?: boolean;
  size?: number;
  mime?: string;
}

export type ActivityKind =
  | "created"
  | "moved"
  | "board"
  | "progress"
  | "priority"
  | "due"
  | "archived"
  | "restored"
  | "assigned"
  | "unassigned"
  | "renamed";

/** `from`/`to` hold ids or raw values; names are resolved when displayed. */
export interface Activity {
  at: number;
  kind: ActivityKind;
  from?: string | null;
  to?: string | null;
}

export interface TimeEntry {
  id: ID;
  start: number;
  /** null while the timer is running. */
  end: number | null;
}

export type CoverSize = "strip" | "full";

export interface Comment {
  id: ID;
  text: string;
  createdAt: number;
}

export interface Card {
  id: ID;
  boardId: ID;
  listId: ID;
  title: string;
  description: string;
  labelIds: ID[];
  priority: Priority;
  progress: Progress;
  /** ISO date, yyyy-MM-dd */
  startDate: string | null;
  /** ISO date, yyyy-MM-dd */
  dueDate: string | null;
  checklist: ChecklistItem[];
  attachments: Attachment[];
  comments: Comment[];
  assignees: string[];
  links: CardLink[];
  recurrence: Recurrence | null;
  cover: string | null;
  /** Attachment id of an image attachment used as the cover. */
  coverImage: ID | null;
  coverSize: CoverSize;
  activity: Activity[];
  time: TimeEntry[];
  /** Estimated effort in minutes. */
  estimate: number | null;
  /** Local date-time "yyyy-MM-ddTHH:mm" for a desktop reminder. */
  reminder: string | null;
  order: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

/** A column on a board. Planner calls these "buckets". */
export interface List {
  id: ID;
  boardId: ID;
  title: string;
  order: number;
  archived: boolean;
  wipLimit: number | null;
  collapsed: boolean;
}

export type BoardBackground =
  | { type: "none" }
  | { type: "color"; value: string }
  | { type: "gradient"; value: string }
  /** value: stored image path (or data: URL in browser dev). */
  | { type: "image"; value: string };

export type BadgeKey = "dates" | "checklist" | "assignees" | "priority" | "description" | "links" | "time" | "attachments";

export interface BoardDisplay {
  columnWidth: "narrow" | "normal" | "wide";
  compact: boolean;
  labelStyle: "text" | "bar";
  badges: Record<BadgeKey, boolean>;
  /** Fade cards that haven't been touched in a while. */
  aging: boolean;
}

export interface Board {
  id: ID;
  title: string;
  description: string;
  color: string;
  /** Emoji shown next to the board name. */
  icon: string | null;
  background: BoardBackground;
  display: BoardDisplay;
  labels: Label[];
  archived: boolean;
  starred: boolean;
  order: number;
  createdAt: number;
}

export type GroupBy = "bucket" | "progress" | "priority" | "assignee" | "label" | "due";
export type ViewMode = "board" | "list" | "calendar" | "timeline" | "charts";
export type DueFilter = "any" | "overdue" | "today" | "week" | "none";

export interface Filter {
  text: string;
  labelIds: ID[];
  priorities: Priority[];
  progress: Progress[];
  assignees: string[];
  due: DueFilter;
}

export interface SavedFilter {
  id: ID;
  name: string;
  boardId: ID;
  filter: Filter;
}

export interface BoardUi {
  view: ViewMode;
  groupBy: GroupBy;
  filter: Filter;
  /** Group ids whose "Completed" section is expanded on the board view. */
  showCompleted: string[];
}

export interface ReminderSettings {
  enabled: boolean;
  /** "HH:mm" — once a day, a summary of what's due / late. */
  digestTime: string;
  digest: boolean;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  me: string;
  people: string[];
  /** Accent color override; null = brand default. */
  accent: string | null;
  density: "compact" | "normal" | "comfortable";
  weekStartsOn: 0 | 1;
  defaultView: ViewMode;
  sidebarCollapsed: boolean;
  reminders: ReminderSettings;
}

/** A reusable card blueprint. Labels are stored by name so templates work on any board. */
export interface CardTemplate {
  id: ID;
  name: string;
  createdAt: number;
  title: string;
  description: string;
  checklist: string[];
  labels: { name: string; color: string }[];
  priority: Priority;
  assignees: string[];
  recurrence: Recurrence | null;
  cover: string | null;
  estimate: number | null;
}

export interface AppData {
  version: 1;
  boards: Record<ID, Board>;
  lists: Record<ID, List>;
  cards: Record<ID, Card>;
  savedFilters: SavedFilter[];
  templates: CardTemplate[];
  ui: Record<ID, BoardUi>;
  settings: Settings;
}

export type Route =
  | { page: "home" }
  | { page: "mytasks" }
  | { page: "board"; boardId: ID }
  | { page: "archive" }
  | { page: "settings" };
