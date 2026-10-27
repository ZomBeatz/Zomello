import type { ImportedBoard } from "./importers";

/** Ready-made boards to start from (Home > Start from a template). Plain starting points: rename, add, delete freely. */
export interface BoardTemplate {
  id: string;
  name: string;
  icon: string;
  color: string;
  about: string;
  labels: { name: string; color: string }[];
  lists: { name: string; cards: { title: string; labels?: string[]; checklist?: string[]; description?: string }[] }[];
}

const L = { green: "#22c55e", blue: "#0ea5e9", orange: "#ec6a3f", purple: "#a855f7", red: "#ef4444", yellow: "#eab308" };

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "week",
    name: "Weekly plan",
    icon: "🗓️",
    color: "#2580c3",
    about: "This week at a glance: what's on, what's next, what's done.",
    labels: [{ name: "Work", color: L.blue }, { name: "Home", color: L.green }, { name: "Errand", color: L.orange }],
    lists: [
      { name: "This week", cards: [{ title: "Plan the week (10 minutes on Sunday)", checklist: ["Look at the calendar", "Pick the 3 most important things", "Move the rest to Later"] }] },
      { name: "Today", cards: [] },
      { name: "Waiting on someone", cards: [] },
      { name: "Later", cards: [] },
      { name: "Done", cards: [] },
    ],
  },
  {
    id: "move",
    name: "Moving house",
    icon: "📦",
    color: "#ec6a3f",
    about: "Everything for a move, from booking the van to updating your address.",
    labels: [{ name: "Book", color: L.orange }, { name: "Pack", color: L.blue }, { name: "Admin", color: L.purple }],
    lists: [
      {
        name: "Before",
        cards: [
          { title: "Book movers or a van", labels: ["Book"] },
          { title: "Get boxes and tape", labels: ["Pack"], checklist: ["Boxes", "Tape", "Markers", "Bubble wrap"] },
          { title: "Change of address", labels: ["Admin"], checklist: ["Post office", "Bank", "Work", "Doctor", "Subscriptions"] },
          { title: "Set up internet at the new place", labels: ["Book"] },
        ],
      },
      { name: "Packing", cards: [{ title: "Kitchen", labels: ["Pack"] }, { title: "Bedroom", labels: ["Pack"] }, { title: "Living room", labels: ["Pack"] }, { title: "Bathroom", labels: ["Pack"] }] },
      { name: "Moving day", cards: [{ title: "Essentials box", checklist: ["Chargers", "Toiletries", "Snacks", "Tools", "Bedding"] }, { title: "Meter readings", labels: ["Admin"] }] },
      { name: "After", cards: [{ title: "Unpack the kitchen first" }, { title: "Register to vote at the new address", labels: ["Admin"] }] },
      { name: "Done", cards: [] },
    ],
  },
  {
    id: "school",
    name: "School term",
    icon: "📚",
    color: "#6366f1",
    about: "Assignments, exams and reading for one term or semester.",
    labels: [{ name: "Assignment", color: L.purple }, { name: "Exam", color: L.red }, { name: "Reading", color: L.blue }],
    lists: [
      { name: "To do", cards: [{ title: "Add every due date from the syllabus", checklist: ["Class 1", "Class 2", "Class 3"] }] },
      { name: "This week", cards: [] },
      { name: "Working on it", cards: [] },
      { name: "Handed in", cards: [] },
    ],
  },
  {
    id: "trip",
    name: "Trip planner",
    icon: "✈️",
    color: "#0ea5e9",
    about: "Bookings, plans and a packing list for a trip.",
    labels: [{ name: "Booking", color: L.orange }, { name: "Idea", color: L.yellow }, { name: "Packing", color: L.blue }],
    lists: [
      { name: "Ideas", cards: [{ title: "Places to see", labels: ["Idea"] }, { title: "Places to eat", labels: ["Idea"] }] },
      { name: "To book", cards: [{ title: "Travel there and back", labels: ["Booking"] }, { title: "Where to stay", labels: ["Booking"] }] },
      { name: "Booked", cards: [] },
      {
        name: "Packing",
        cards: [{ title: "Packing list", labels: ["Packing"], checklist: ["Passport or ID", "Chargers and adapters", "Medicine", "Clothes", "Toiletries"] }],
      },
    ],
  },
  {
    id: "project",
    name: "Project",
    icon: "🚀",
    color: "#2580c3",
    about: "A simple flow for any project: ideas, to do, doing, review, done.",
    labels: [{ name: "Urgent", color: L.red }, { name: "Idea", color: L.yellow }, { name: "Blocked", color: L.orange }],
    lists: [
      { name: "Ideas", cards: [] },
      { name: "To do", cards: [{ title: "Write down the goal in one sentence" }, { title: "List the first 5 steps" }] },
      { name: "Doing", cards: [] },
      { name: "Review", cards: [] },
      { name: "Done", cards: [] },
    ],
  },
  {
    id: "chores",
    name: "Household chores",
    icon: "🏠",
    color: "#22c55e",
    about: "Daily, weekly and monthly chores (open a card and set Repeat to make it come back).",
    labels: [{ name: "Daily", color: L.green }, { name: "Weekly", color: L.blue }, { name: "Monthly", color: L.purple }],
    lists: [
      { name: "Daily", cards: [{ title: "Dishes", labels: ["Daily"] }, { title: "Tidy up for 10 minutes", labels: ["Daily"] }] },
      { name: "Weekly", cards: [{ title: "Laundry", labels: ["Weekly"] }, { title: "Vacuum", labels: ["Weekly"] }, { title: "Take out the recycling", labels: ["Weekly"] }, { title: "Groceries", labels: ["Weekly"] }] },
      { name: "Monthly", cards: [{ title: "Change the bed sheets", labels: ["Monthly"] }, { title: "Clean the fridge", labels: ["Monthly"] }] },
      { name: "Done", cards: [] },
    ],
  },
  {
    id: "event",
    name: "Event or party",
    icon: "🎉",
    color: "#a855f7",
    about: "Guests, food, supplies and the day itself.",
    labels: [{ name: "Guests", color: L.blue }, { name: "Food", color: L.orange }, { name: "Buy", color: L.green }],
    lists: [
      { name: "Plan", cards: [{ title: "Pick the date and place" }, { title: "Guest list", labels: ["Guests"] }, { title: "Send invitations", labels: ["Guests"] }] },
      { name: "Food and drinks", cards: [{ title: "Menu", labels: ["Food"] }, { title: "Shopping list", labels: ["Buy"] }] },
      { name: "On the day", cards: [{ title: "Set up", checklist: ["Tables and chairs", "Decorations", "Music"] }] },
      { name: "Done", cards: [] },
    ],
  },
  {
    id: "jobs",
    name: "Job search",
    icon: "💼",
    color: "#0f766e",
    about: "Track applications from first look to offer.",
    labels: [{ name: "Remote", color: L.blue }, { name: "Dream job", color: L.yellow }, { name: "Follow up", color: L.orange }],
    lists: [
      { name: "Interested", cards: [{ title: "Update my resume" }] },
      { name: "Applied", cards: [] },
      { name: "Interviewing", cards: [] },
      { name: "Offer", cards: [] },
      { name: "Not this time", cards: [] },
    ],
  },
];

/** A template as a board to add (see the store's importBoard). */
export function templateBoard(t: BoardTemplate): ImportedBoard {
  return {
    source: "Template",
    title: t.name,
    color: t.color,
    labels: t.labels,
    people: [],
    warnings: [],
    lists: t.lists.map((l) => ({
      name: l.name,
      cards: l.cards.map((c) => ({ title: c.title, description: c.description, labels: c.labels, checklist: (c.checklist ?? []).map((text) => ({ text, done: false })) })),
    })),
  };
}
