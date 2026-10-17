export type ID = string;

export type Priority = "urgent" | "important" | "medium" | "low";
/** Card status. "waiting" = blocked on someone else; "onHold" = paused on purpose. */
export type Progress = "notStarted" | "inProgress" | "waiting" | "onHold" | "completed";

export interface Label {
  id: ID;
  name: string;
  color: string;
}

export interface ChecklistItem {
  id: ID;
  text: string;
  done: boolean;
  /** When set, this item mirrors another card (its title, completion and labels). */
  cardId?: ID | null;
  /** Labels on an unlinked item (linked items show the linked card's labels). */
  labelIds?: ID[];
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
  /** Custom field values by FieldDef id. */
  fields: Record<ID, FieldValue>;
  order: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;

}

/** A column on a board. Planner calls these "buckets". */
export type SortMode = "custom" | "due" | "alpha" | "priority" | "created" | "updated" | "progress";

export interface List {
  id: ID;
  boardId: ID;
  title: string;
  order: number;
  archived: boolean;
  wipLimit: number | null;
  collapsed: boolean;
  /** How cards are shown in this bucket. Display only — the custom (`order`) arrangement is never changed by it. */
  sort: SortMode;
  sortDesc: boolean;
  /** Per-bucket overrides of the board's "Show on cards" settings. */
  badges?: Partial<Record<BadgeKey, BadgeMode>>;
  /**
   * Cards moved (or added) into this bucket get this progress, e.g. a "Done" bucket completes them.
   * A bucket that completes cards also shows them, instead of tucking them under "Show completed".
   */
  autoProgress?: Progress | null;
  /** Per-bucket override of the board's "hide ticked checklist items on cards". */
  hideChecked?: boolean;
}

export type BoardBackground =
  | { type: "none" }
  | { type: "color"; value: string }
  | { type: "gradient"; value: string }
  /** value: stored image path (or data: URL in browser dev). */
  | { type: "image"; value: string };

export type BadgeKey =
  | "dates" | "checklist" | "assignees" | "priority" | "description" | "notes" | "links" | "time" | "attachments";
/** off = hidden, icon = compact badge, full = the actual information. */
export type BadgeMode = "off" | "icon" | "full";

/** Sections of the card details window that a board can hide. */
export type CardSection =
  | "assignees" | "labels" | "fields" | "description" | "checklist" | "links" | "files" | "notes" | "activity"
  | "progress" | "priority" | "startDate" | "dueDate" | "reminder" | "repeat" | "time" | "cover" | "moveBoard";

export type FieldType = "text" | "number" | "select" | "checkbox" | "date" | "url";

export interface FieldOption {
  id: ID;
  label: string;
  color: string;
}

export interface FieldDef {
  id: ID;
  name: string;
  type: FieldType;
  /** Choices for "select" fields. */
  options: FieldOption[];
  /** Show the value on the card in the board. */
  showOnCard: boolean;
}

export type FieldValue = string | number | boolean | null;

export interface BoardDisplay {
  columnWidth: "narrow" | "normal" | "wide";
  compact: boolean;
  labelStyle: "text" | "bar";
  badges: Record<BadgeKey, BadgeMode>;
  /** Fade cards that haven't been touched in a while. */
  aging: boolean;
  /** Checklists shown on cards ("Details") leave out ticked items. */
  hideChecked?: boolean;
}

export interface Board {
  id: ID;
  title: string;
  description: string;
  color: string;
  /** Emoji shown next to the board name. */
  icon: string | null;
  background: BoardBackground;
  /** Background effects: blur in px (images), dim 0–80 (% darkening). */
  backgroundFx: { blur: number; dim: number };
  display: BoardDisplay;
  fields: FieldDef[];
  hiddenSections: CardSection[];
  labels: Label[];
  archived: boolean;
  starred: boolean;
  /** Optional group in the sidebar and on Home (e.g. "Work", "Home"). Null = not in one. */
  category?: string | null;
  /** Calendars shown (read-only) in this board's Calendar view. */
  calendarFeeds?: CalendarFeed[];
  /** Zomello Server only (set by the server): who owns the board, and everyone on it. */
  ownerId?: ID;
  members?: { userId: ID; displayName: string; username: string; role: "owner" | "member" }[];
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
  /** Only this card and the cards related to it (parents, sub-tasks, links). */
  relatedTo: ID | null;
  /** Follow relations all the way (whole chain), not just direct ones. */
  relatedDeep: boolean;
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
  /** Bucket the last checklist spin-off from this board went to (default for the next one). */
  lastSpinOffList?: ID;
}

export interface ReminderSettings {
  enabled: boolean;
  /** "HH:mm" — once a day, a summary of what's due / late. */
  digestTime: string;
  digest: boolean;
}

export interface A11ySettings {
  /** Turn off animations and transitions. */
  reduceMotion: boolean;
  /** Stronger borders and text contrast. */
  highContrast: boolean;
  /** Always underline links. */
  underlineLinks: boolean;
  /** Extra letter, word and line spacing (easier reading, dyslexia-friendly). */
  readableSpacing: boolean;
  /** Thick, always-visible keyboard focus outline. */
  strongFocus: boolean;
  /** Bigger buttons and checkboxes. */
  largerTargets: boolean;
}

/** A Zomello Server added in Settings → Zomello Servers. */
export interface ServerEntry {
  id: ID;
  name: string;
  /** scheme://host:port */
  url: string;
  /** "computer": a computer running the Zomello app with Phones & tablets on (phone app only). */
  kind?: "server" | "computer";
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
  /** Page zoom, 1 = 100%. Ctrl + mouse wheel, Ctrl +/-/0. */
  zoom: number;
  /** Default length of a focus countdown, minutes. */
  focusMinutes: number;
  focusSound: boolean;
  a11y: A11ySettings;
  /** Look of the whole app: the ZomBeatz blue and orange, or a theme found as an Easter egg. */
  style: AppStyle;
  /** Easter-egg styles found so far (they show up in Settings once found). */
  unlockedStyles: AppStyle[];
  /** The welcome guide has been seen (or skipped). */
  onboarded: boolean;
  /** Board categories folded shut in the sidebar. */
  collapsedCategories: string[];
  /** Categories ("sections") made on their own, so they show even before a board is in them. */
  sections?: string[];
  /** Party Cat's cat sings now and then (and when clicked). */
  catSings?: boolean;
  /** Desktop app: closing the window keeps Zomello running in the tray. */
  runInBackground: boolean;
  /** Zomello Servers this app can open (Plex style), alongside the boards stored here. */
  servers?: ServerEntry[];
}

export type AppStyle = "classic" | "bassdrop" | "partycat";

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
  | { page: "settings" }
  /** Zomello Server: admins only. */
  | { page: "admin" };

/** A countdown ("focus") timer, optionally tied to a card's time tracking. */
export interface FocusTimer {
  cardId: ID | null;
  label: string;
  durationMs: number;
  /** When running: the moment it hits zero. */
  endsAt: number | null;
  /** When paused: time left. */
  remainingMs: number;
}

/** An iCal (.ics) address whose events show in a board's Calendar view, e.g. a Google Calendar. */
export interface CalendarFeed {
  id: ID;
  name: string;
  url: string;
  color: string;
  /** Hidden from the calendar without removing it. */
  show?: boolean;
}
