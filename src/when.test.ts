import { describe, expect, it } from "vitest";
import { readWhen } from "./when";

// Tuesday, October 27, 2026, 10:00 in the morning.
const now = new Date(2026, 9, 27, 10, 0);
const r = (s: string) => readWhen(s, now);

describe("readWhen", () => {
  it("reads days", () => {
    expect(r("Dentist tomorrow")).toMatchObject({ title: "Dentist", dueDate: "2026-10-28", dueTime: null });
    expect(r("Call Sam today")?.dueDate).toBe("2026-10-27");
    expect(r("Groceries friday")?.dueDate).toBe("2026-10-30");
    expect(r("Groceries on Fri")?.dueDate).toBe("2026-10-30");
    expect(r("Standup tuesday")?.dueDate).toBe("2026-10-27");
    expect(r("Review next friday")?.dueDate).toBe("2026-11-06");
    expect(r("Plan next week")?.dueDate).toBe("2026-11-02");
    expect(r("Taxes in 3 days")?.dueDate).toBe("2026-10-30");
    expect(r("Taxes in a week")?.dueDate).toBe("2026-11-03");
  });

  it("reads dates", () => {
    expect(r("Report due Oct 28")).toMatchObject({ title: "Report", dueDate: "2026-10-28" });
    expect(r("Party December 5th")?.dueDate).toBe("2026-12-05");
    expect(r("Party 5 Dec")?.dueDate).toBe("2026-12-05");
    expect(r("Trip Jan 3")?.dueDate).toBe("2027-01-03");
    expect(r("Launch 2026-11-15")?.dueDate).toBe("2026-11-15");
    expect(r("Pay rent on the 1st")?.dueDate).toBe("2026-11-01");
    expect(r("Bad date Feb 31")).toBeNull();
  });

  it("reads times", () => {
    expect(r("Dentist tomorrow 3pm")).toMatchObject({ title: "Dentist", dueDate: "2026-10-28", dueTime: "15:00" });
    expect(r("Call Sam friday at 2:30pm")).toMatchObject({ title: "Call Sam", dueDate: "2026-10-30", dueTime: "14:30" });
    expect(r("Meeting 3pm friday")).toMatchObject({ title: "Meeting", dueDate: "2026-10-30", dueTime: "15:00" });
    expect(r("Lunch at noon")).toMatchObject({ title: "Lunch", dueDate: "2026-10-27", dueTime: "12:00" });
    expect(r("Coffee at 9")).toMatchObject({ dueDate: "2026-10-28", dueTime: "09:00" });
    expect(r("Gym at 5")).toMatchObject({ dueDate: "2026-10-27", dueTime: "17:00" });
    expect(r("Call 14:45")?.dueTime).toBe("14:45");
    expect(r("Movie tonight")).toMatchObject({ dueDate: "2026-10-27", dueTime: "19:00" });
    expect(r("Early 8am")).toMatchObject({ dueDate: "2026-10-28", dueTime: "08:00" });
  });

  it("leaves titles alone otherwise", () => {
    expect(r("Plan Friday party")).toBeNull();
    expect(r("Read chapter 3")).toBeNull();
    expect(r("Buy 2 tomatoes")).toBeNull();
    expect(r("tomorrow")).toBeNull();
    expect(r("Fix the today page")).toBeNull();
  });

  it("reads repeats when they're on", () => {
    const rep = (t: string) => readWhen(t, now, { repeats: true });
    expect(rep("Water plants every monday")).toMatchObject({ title: "Water plants", dueDate: "2026-11-02", recurrence: { freq: "weekly", interval: 1, weekdays: [1], until: null } });
    expect(rep("Gym every mon wed fri at 6pm")).toMatchObject({ title: "Gym", dueDate: "2026-10-28", dueTime: "18:00", recurrence: { weekdays: [1, 3, 5] } });
    expect(rep("Rent monthly on the 1st")).toMatchObject({ title: "Rent", dueDate: "2026-11-01", recurrence: { freq: "monthly" } });
    expect(rep("Recycling every 2 weeks")).toMatchObject({ dueDate: "2026-10-27", recurrence: { freq: "weekly", interval: 2 } });
    expect(rep("Stretch every day")).toMatchObject({ title: "Stretch", recurrence: { freq: "daily" } });
    expect(rep("Pay invoices every weekday")?.recurrence?.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(rep("Standup daily at 9:30 until Dec 20")).toMatchObject({ title: "Standup", dueDate: "2026-10-28", dueTime: "09:30", recurrence: { freq: "daily", until: "2026-12-20" } });
    expect(rep("Standup tuesday at 9am")).toMatchObject({ dueDate: "2026-10-27", dueTime: "09:00" });
    expect(rep("Standup tuesday at 9am")?.recurrence).toBeUndefined();
    expect(rep("Work on it until friday")).toMatchObject({ title: "Work on it", dueDate: "2026-10-30" });
    expect(rep("Notes from the daily")).toBeNull();
    expect(rep("Weekly review")).toBeNull();
  });

  it("leaves repeats alone when they're off", () => {
    expect(r("Stretch every day")).toBeNull();
    expect(r("Water plants every monday")).toBeNull();
  });
});
