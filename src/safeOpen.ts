/**
 * What a link may open. Cards can hold text from other people (a Zomello Server board, someone's phone,
 * an imported file), so a link must never be able to start a program: web, mail and phone links open
 * normally; a file on this computer opens unless it's something that runs (a program, script, installer
 * or shortcut), which is only shown in its folder; network shares (\\server\share, //server/share) and
 * anything else are refused.
 */

/** Files that run something when opened, on any of Windows, macOS or Linux. */
const RUNS = new Set(
  (
    "exe com bat cmd scr pif msi msix msixbundle appx appxbundle msp mst ps1 psm1 psd1 vbs vbe js jse wsf wsh wsc hta cpl " +
    "jar lnk url reg inf scf appref-ms application gadget settingcontent-ms library-ms search-ms diagcab chm " +
    "sh bash zsh csh ksh fish command tool app pkg mpkg dmg workflow terminal desktop appimage run bin deb rpm snap flatpakref " +
    "py pyw pl rb php"
  ).split(" "),
);

export type LinkPlan =
  | { kind: "web"; url: string }
  | { kind: "file"; path: string }
  | { kind: "runs"; path: string }
  | { kind: "refused"; why: string };

/** file:///home/me/My%20File.jpg → /home/me/My File.jpg (Windows: file:///C:/x → C:/x). */
export function fileUrlToPath(u: string): string {
  let p = u.replace(/^file:\/\/(localhost)?/i, "");
  try {
    p = decodeURIComponent(p);
  } catch {
    // Not percent-encoded after all.
  }
  return /^\/[A-Za-z]:\//.test(p) ? p.slice(1) : p;
}

export function planLink(raw: string): LinkPlan {
  const target = raw.trim();
  if (/^(https?|mailto|tel):/i.test(target)) return { kind: "web", url: target };
  let path = /^file:/i.test(target) ? fileUrlToPath(target) : target;
  try {
    // Notes encode backslashes (%5C); undo that so a network path can't hide behind it.
    if (/%[0-9a-f]{2}/i.test(path)) path = decodeURIComponent(path);
  } catch {
    // Keep it as written.
  }
  if (/^[\\/]{2}/.test(path) || /^file:\/\/[^/]/i.test(target)) return { kind: "refused", why: "Links to network shares don't open from Zomello." };
  const local = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("~/");
  if (!local) return { kind: "refused", why: "Zomello only opens web links and files on this computer." };
  // Windows ignores dots and spaces at the end of a name ("run.bat. " is run.bat).
  const name = (path.split(/[\\/]/).pop() ?? "").replace(/[\s.]+$/, "");
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (RUNS.has(ext) || /\.app[\\/]?$/i.test(path)) return { kind: "runs", path };
  return { kind: "file", path };
}

/** A stored attachment's name runs something when opened. */
export const runsWhenOpened = (name: string) => planLink(`/${name}`).kind === "runs";
