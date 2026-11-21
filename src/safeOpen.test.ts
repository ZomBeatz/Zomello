import { describe, expect, it } from "vitest";
import { planLink, runsWhenOpened } from "./safeOpen";

describe("what a link may open", () => {
  it("opens web, mail and phone links", () => {
    for (const u of ["https://example.com", "http://x.test/a", "mailto:info@zombeatzmedia.com", "tel:+15550100"]) expect(planLink(u).kind).toBe("web");
  });

  it("refuses network shares however they're written", () => {
    for (const u of ["\\\\server\\share\\run.exe", "//server/share/a.pdf", "%5C%5Cserver%5Cshare%5Crun.exe", "file://server/share/a.pdf", "file:////server/share/a.pdf"])
      expect(planLink(u).kind, u).toBe("refused");
  });

  it("refuses other schemes and relative paths", () => {
    for (const u of ["javascript:alert(1)", "ms-msdt:/id", "search-ms:query=x", "run.exe", "../x.pdf"]) expect(planLink(u).kind, u).toBe("refused");
  });

  it("opens documents on this computer, but only shows programs and scripts in their folder", () => {
    expect(planLink("C:/Users/me/Report.pdf")).toEqual({ kind: "file", path: "C:/Users/me/Report.pdf" });
    expect(planLink("file:///home/me/My%20Notes.txt")).toEqual({ kind: "file", path: "/home/me/My Notes.txt" });
    for (const u of ["C:\\Tools\\setup.EXE", "/home/me/x.sh", "file:///C:/a/b.lnk", "/Applications/Thing.app", "/tmp/x.desktop", "C:/a/b.bat. "])
      expect(planLink(u).kind, u).toBe("runs");
    expect(runsWhenOpened("invoice.pdf.exe")).toBe(true);
    expect(runsWhenOpened("invoice.pdf")).toBe(false);
  });
});
