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
});
