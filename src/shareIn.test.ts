import { describe, expect, it } from "vitest";
import { sharedTask } from "./shareIn";

describe("sharedTask", () => {
  it("uses the subject when there is one", () => {
    expect(sharedTask("https://example.com/a", "A great article")).toEqual({ title: "A great article", description: "https://example.com/a" });
  });
  it("names a bare link after its site", () => {
    expect(sharedTask("https://www.example.com/a?b=1", "")).toEqual({ title: "Look at example.com", description: "https://www.example.com/a?b=1" });
  });
  it("takes the first line of longer text", () => {
    expect(sharedTask("Buy paint\nWhite, 2 liters", "")).toEqual({ title: "Buy paint", description: "Buy paint\nWhite, 2 liters" });
    expect(sharedTask("Call the plumber", "")).toEqual({ title: "Call the plumber", description: "" });
  });
});
