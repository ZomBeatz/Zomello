import { addDays } from "date-fns";
import type { AppData, Board, Card, ID, List } from "./types";
import { toISO, uid } from "./utils";

/** The online demo (GitHub Pages): built with VITE_DEMO=1. Everything stays in the visitor's browser. */
export const isDemo = import.meta.env.VITE_DEMO === "1";

type Make = {
  newBoard: (title: string, color: string, order: number) => Board;
  newList: (boardId: ID, title: string, order: number) => List;
  newCard: (boardId: ID, listId: ID, title: string, order: number, extra?: Partial<Card>) => Card;
};

type CardSpec = {
  labels?: string[];
  who?: string[];
  priority?: Card["priority"];
  progress?: Card["progress"];
  start?: number;
  due?: number;
  checklist?: [string, boolean][];
  cover?: string;
  description?: string;
};

/** Example boards for the demo: work, home, school and personal, on top of the Getting started board. */
export function demoData(sample: AppData, make: Make): AppData {
  const data: AppData = {
    ...sample,
    boards: { ...sample.boards },
    lists: { ...sample.lists },
    cards: { ...sample.cards },
    settings: { ...sample.settings, me: "Alex", people: ["Alex", "Maya", "Jordan", "Sam"], sections: ["Work", "Home", "School", "Personal"] },
  };
  const day = (n: number) => toISO(addDays(new Date(), n));
  let order = 0;

  function board(title: string, icon: string, color: string, category: string, labels: Record<string, string>, gradient?: string) {
    const b = make.newBoard(title, color, Object.keys(data.boards).length);
    b.icon = icon;
    b.category = category;
    b.labels = Object.entries(labels).map(([name, c]) => ({ id: uid(), name, color: c }));
    if (gradient) b.background = { type: "gradient", value: gradient };
    data.boards[b.id] = b;
    return b;
  }
  function list(b: Board, title: string) {
    const l = make.newList(b.id, title, Object.values(data.lists).filter((x) => x.boardId === b.id).length);
    data.lists[l.id] = l;
    return l;
  }
  function card(b: Board, l: List, title: string, x: CardSpec = {}) {
    const c = make.newCard(b.id, l.id, title, order++, {
      description: x.description ?? "",
      labelIds: (x.labels ?? []).map((n) => b.labels.find((q) => q.name === n)!.id),
      assignees: x.who ?? [],
      priority: x.priority ?? "medium",
      progress: x.progress ?? "notStarted",
      startDate: x.start === undefined ? null : day(x.start),
      dueDate: x.due === undefined ? null : day(x.due),
      checklist: (x.checklist ?? []).map(([text, done]) => ({ id: uid(), text, done })),
      cover: x.cover ?? null,
      completedAt: x.progress === "completed" ? Date.now() : null,
    });
    data.cards[c.id] = c;
  }

  const w = board("Website Launch", "🚀", "#2580c3", "Work",
    { Design: "#a855f7", Content: "#ec6a3f", Dev: "#0ea5e9", Urgent: "#ef4444", Idea: "#eab308" },
    "linear-gradient(160deg, #0b1020 0%, #1e3a8a 60%, #2580c3 100%)");
  w.starred = true;
  const w1 = list(w, "Ideas"), w2 = list(w, "In progress"), w3 = list(w, "Review"), w4 = list(w, "Launch");
  card(w, w1, "Customer stories page", { labels: ["Content", "Idea"], who: ["Maya"] });
  card(w, w1, "Live chat on the pricing page", { labels: ["Dev", "Idea"], priority: "low" });
  card(w, w1, "New product photos", { labels: ["Design"], who: ["Jordan"], cover: "#0ea5e9" });
  card(w, w2, "Homepage redesign", { labels: ["Design"], who: ["Alex"], progress: "inProgress", start: -3, due: 2,
    checklist: [["Wireframes", true], ["Hero section", true], ["Mobile layout", false], ["Final colors", false]] });
  card(w, w2, "Write the About page", { labels: ["Content"], who: ["Sam"], progress: "inProgress", start: 1, due: 5 });
  card(w, w2, "Fix contact form emails", { labels: ["Dev", "Urgent"], priority: "urgent", due: -1, who: ["Alex"] });
  card(w, w3, "Pricing page copy", { labels: ["Content"], who: ["Maya"], progress: "inProgress", start: 4, due: 8,
    checklist: [["Draft", true], ["Team review", true], ["Legal check", false]] });
  card(w, w3, "Accessibility check", { labels: ["Dev"], priority: "important", start: 10, due: 12 });
  card(w, w4, "Launch announcement", { labels: ["Content"], who: ["Jordan"], cover: "#ec6a3f", start: 6, due: 14,
    checklist: [["Email newsletter", true], ["Social posts", false], ["Blog post", false]] });
  card(w, w4, "Go-live day", { labels: ["Dev"], who: ["Jordan", "Alex"], priority: "important", start: 18, due: 20 });
  card(w, w4, "Set up analytics", { labels: ["Dev"], who: ["Maya"], start: 13, due: 16 });
  card(w, w4, "Pick a launch date", { labels: ["Content"], progress: "completed" });
  card(w, w2, "Team check-in", { labels: ["Content"], who: ["Alex", "Maya"], due: 0 });
  card(w, w3, "Client review call", { labels: ["Design"], who: ["Alex"], priority: "important", due: 1 });

  const t = board("Trip to Japan", "✈️", "#ec6a3f", "Personal", { Booking: "#ec6a3f", Packing: "#0ea5e9", Ideas: "#eab308" });
  const t1 = list(t, "To book"), t2 = list(t, "Booked"), t3 = list(t, "Packing");
  card(t, t1, "Ryokan in Kyoto", { labels: ["Booking"], due: 3, who: ["Alex"] });
  card(t, t1, "Rail passes", { labels: ["Booking"], due: 6 });
  card(t, t2, "Flights", { labels: ["Booking"], progress: "completed" });
  card(t, t3, "Packing list", { labels: ["Packing"], due: 25, checklist: [["Adapters", false], ["Rain jacket", false]] });

  const f = board("Fitness Goals", "🎯", "#be185d", "Personal", { Goal: "#a855f7" });
  card(f, list(f, "This month"), "Run a 5K", { labels: ["Goal"], due: 14, progress: "inProgress", who: ["Alex"] });

  const s = board("Semester Plan", "📚", "#6366f1", "School", { Essay: "#a855f7", Exam: "#ef4444", Reading: "#0ea5e9" });
  const s1 = list(s, "This week"), s2 = list(s, "Later");
  card(s, s1, "History essay draft", { labels: ["Essay"], due: 1, progress: "inProgress", who: ["Alex"] });
  card(s, s1, "Biology quiz", { labels: ["Exam"], due: 3 });
  card(s, s2, "Read chapters 4 to 6", { labels: ["Reading"], due: 9 });

  const h = board("Home Projects", "🏠", "#22c55e", "Home",
    { Garden: "#22c55e", Repair: "#ec6a3f", Shopping: "#0ea5e9", Urgent: "#ef4444" },
    "linear-gradient(135deg, #0f766e 0%, #22c55e 100%)");
  const h1 = list(h, "To do"), h2 = list(h, "Doing"), h3 = list(h, "Done");
  card(h, h1, "Fix the fence gate", { labels: ["Repair"], due: 4, who: ["Sam"] });
  card(h, h1, "New shelves for the garage", { labels: ["Shopping"], priority: "low", who: ["Alex"],
    checklist: [["Measure the wall", true], ["Pick shelves", false], ["Order brackets", false]] });
  card(h, h1, "Plant fall bulbs", { labels: ["Garden"], due: 6, checklist: [["Tulips", false], ["Daffodils", false]] });
  card(h, h2, "Paint the spare room", { labels: ["Repair"], progress: "inProgress", start: -2, due: 3, who: ["Alex", "Sam"] });
  card(h, h3, "Clean the gutters", { labels: ["Repair"], progress: "completed" });

  const m = board("Meals & Groceries", "🌱", "#0f766e", "Home", { Weekly: "#22c55e" });
  const m1 = list(m, "This week");
  card(m, m1, "Grocery run", { labels: ["Weekly"], due: 1, checklist: [["Milk", false], ["Eggs", false], ["Coffee", true]] });
  card(m, m1, "Meal prep Sunday", { labels: ["Weekly"], due: 2 });

  // A few cards with everything filled in, so opening one shows what a card can hold.
  const find = (t: string) => Object.values(data.cards).find((c) => c.title === t)!;
  const hp = find("Homepage redesign");
  const about = find("Write the About page");
  const live = find("Go-live day");
  const now = Date.now();
  hp.description = "New hero, a clearer pricing teaser and a faster mobile layout.\n\n- Keep the brand colors\n- **Must** pass the accessibility check";
  hp.comments = [
    { id: uid(), text: "Mobile layout drafts are in the shared folder.", createdAt: now - 5 * 3600e3 },
    { id: uid(), text: "Kickoff with Maya and Jordan went well.", createdAt: now - 50 * 3600e3 },
  ];
  hp.time = [
    { id: uid(), start: now - 26 * 3600e3, end: now - 24.5 * 3600e3 },
    { id: uid(), start: now - 4 * 3600e3, end: now - 2.8 * 3600e3 },
  ];
  hp.estimate = 360;
  hp.links = [{ cardId: about.id, type: "relates" }, { cardId: live.id, type: "blocks" }];
  live.links = [{ cardId: hp.id, type: "blockedBy" }];
  about.links = [{ cardId: hp.id, type: "relates" }];
  // Times show these at their hours in the calendar's Week and Day views; one is picked for My Day.
  Object.assign(find("Team check-in"), { startTime: "10:00", dueTime: "10:30" });
  Object.assign(find("Client review call"), { startTime: "14:00", dueTime: "15:00" });
  Object.assign(find("Fix contact form emails"), { myDay: day(0) });
  const small = { id: uid(), label: "Small", color: "#22c55e" };
  const big = { id: uid(), label: "Big", color: "#ef4444" };
  w.fields = [
    { id: uid(), name: "Client", type: "text", options: [], showOnCard: false },
    { id: uid(), name: "Size", type: "select", options: [small, big], showOnCard: true },
  ];
  hp.fields = { [w.fields[0].id]: "Acme Co.", [w.fields[1].id]: big.id };
  about.fields = { [w.fields[1].id]: small.id };

  return data;
}

/** Start the demo over: drop this browser's copy and reload. */
export function resetDemo() {
  try {
    localStorage.removeItem("zomello-data");
  } catch {
    /* storage blocked: a reload still shows the demo boards */
  }
  location.reload();
}
