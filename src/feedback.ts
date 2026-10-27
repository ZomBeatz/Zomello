import { isRemote } from "./remote";
import { isServer } from "./server";
import { deviceWord, inTauri, isMobileApp, openExternal } from "./storage";

const CONTACT = "info@zombeatzmedia.com";

/** Which Zomello this is, in plain words ("the Android app", "the Windows app", "a browser on an iPad"…). */
function whichZomello(): string {
  const ua = navigator.userAgent;
  const system = /Android/i.test(ua)
    ? "Android"
    : /iPhone/i.test(ua)
      ? "iPhone"
      : /iPad/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
        ? "iPad"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh/i.test(ua)
            ? "Mac"
            : /Linux/i.test(ua)
              ? "Linux"
              : "an unknown system";
  const where = isServer ? ", on a Zomello Server" : isRemote ? ", using a computer's boards" : "";
  if (isMobileApp || inTauri) return `the ${system} app${where}`;
  return `a browser on ${system}${where}`;
}

/** Help > Send feedback: an email to us with the version and device already filled in. */
export function sendFeedback(): void {
  const subject = `Zomello feedback (${__APP_VERSION__})`;
  const body = [
    "What happened, or what would you like?",
    "",
    "",
    "Steps, if something went wrong:",
    "1. ",
    "",
    "---",
    `Zomello ${__APP_VERSION__}, ${whichZomello()} (this ${deviceWord}).`,
  ].join("\n");
  void openExternal(`mailto:${CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
}
