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
}

export interface Attachment {
  id: ID;
  name: string;
  url: string;
  addedAt: number;
}

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
  cover: string | null;
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

export interface Board {
  id: ID;
  title: string;
  description: string;
  color: string;
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

export interface Settings {
  theme: "system" | "light" | "dark";
  me: string;
  people: string[];
}

export interface AppData {
  version: 1;
  boards: Record<ID, Board>;
  lists: Record<ID, List>;
  cards: Record<ID, Card>;
  savedFilters: SavedFilter[];
  ui: Record<ID, BoardUi>;
  settings: Settings;
}

export type Route =
  | { page: "home" }
  | { page: "board"; boardId: ID }
  | { page: "archive" }
  | { page: "settings" };
