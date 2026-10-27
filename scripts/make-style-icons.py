#!/usr/bin/env python3
"""App icons for the hidden styles (Bass Drop, Party Cat), from the same art as src/components/Logo.tsx.

Writes the desktop window icons (src-tauri/icons/styles/), the Android launcher icons (mipmaps for the
activity aliases in AndroidManifest.xml) and the iPhone/iPad alternate icons (Assets.xcassets). Needs
rsvg-convert. Run it again after changing the art:  python3 scripts/make-style-icons.py
"""
import json
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
RES = ROOT / "src-tauri/gen/android/app/src/main/res"
ASSETS = ROOT / "src-tauri/gen/apple/Assets.xcassets"
DESKTOP = ROOT / "src-tauri/icons/styles"

STYLES = {
    "bassdrop": {
        "ios": "AppIcon-BassDrop",
        "bg": ("#2a1650", "#0f0a1e"),
        # Android's adaptive icon background (the art sits on it).
        "flat": "#1D1036",
        "defs": """
          <linearGradient id="eq" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#22e1ff"/><stop offset="1" stop-color="#ff3fa4"/>
          </linearGradient>""",
        "art": """
          <g fill="none" stroke="#22e1ff" stroke-width="18" stroke-linecap="round" opacity=".85">
            <path d="M 112 560 Q 86 632 112 704"/><path d="M 912 560 Q 938 632 912 704"/>
          </g>
          <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#0a0614" stroke-width="64" stroke-linecap="round"/>
          <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#ff3fa4" stroke-width="30" stroke-linecap="round"/>
          <rect x="196" y="500" width="84" height="264" rx="30" fill="#ff3fa4"/>
          <rect x="150" y="522" width="86" height="220" rx="30" fill="#0a0614"/>
          <rect x="744" y="500" width="84" height="264" rx="30" fill="#ff3fa4"/>
          <rect x="788" y="522" width="86" height="220" rx="30" fill="#0a0614"/>
          <g fill="url(#eq)">
            <rect x="324" y="470" width="62" height="294" rx="24"/>
            <rect x="402" y="380" width="62" height="384" rx="24"/>
            <rect x="480" y="540" width="62" height="224" rx="24"/>
            <rect x="558" y="430" width="62" height="334" rx="24"/>
            <rect x="636" y="600" width="62" height="164" rx="24"/>
          </g>""",
    },
    "partycat": {
        "ios": "AppIcon-PartyCat",
        "bg": ("#14263d", "#0a1220"),
        "flat": "#0F1C2E",
        "defs": """
          <linearGradient id="bars" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#8ff3ee"/><stop offset=".5" stop-color="#3dd6d0"/><stop offset="1" stop-color="#1fa7a2"/>
          </linearGradient>""",
        "art": """
          <g fill="#eaf8ff">
            <path d="M 170 200 l 10 26 l 26 10 l -26 10 l -10 26 l -10 -26 l -26 -10 l 26 -10 z" opacity=".9"/>
            <path d="M 850 180 l 7 18 l 18 7 l -18 7 l -7 18 l -7 -18 l -18 -7 l 18 -7 z" opacity=".75"/>
            <circle cx="880" cy="320" r="8" opacity=".6"/><circle cx="140" cy="380" r="7" opacity=".5"/>
          </g>
          <path d="M 268 420 Q 236 288 262 196 Q 352 246 414 318 Z" fill="#8a847b" stroke="#0a0c10" stroke-width="16" stroke-linejoin="round"/>
          <path d="M 284 378 Q 266 300 280 244 Q 334 280 372 322 Z" fill="#f2a7c3"/>
          <path d="M 756 420 Q 788 288 762 196 Q 672 246 610 318 Z" fill="#8a847b" stroke="#0a0c10" stroke-width="16" stroke-linejoin="round"/>
          <path d="M 740 378 Q 758 300 744 244 Q 690 280 652 322 Z" fill="#f2a7c3"/>
          <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#0a0c10" stroke-width="64" stroke-linecap="round"/>
          <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#ff5e7e" stroke-width="30" stroke-linecap="round"/>
          <rect x="196" y="500" width="84" height="264" rx="30" fill="#ff5e7e"/>
          <rect x="150" y="522" width="86" height="220" rx="30" fill="#0a0c10"/>
          <rect x="744" y="500" width="84" height="264" rx="30" fill="#ff5e7e"/>
          <rect x="788" y="522" width="86" height="220" rx="30" fill="#0a0c10"/>
          <rect x="334" y="400" width="96" height="364" rx="30" fill="url(#bars)"/>
          <rect x="464" y="500" width="96" height="264" rx="30" fill="url(#bars)" opacity=".88"/>
          <rect x="594" y="590" width="96" height="174" rx="30" fill="url(#bars)" opacity=".76"/>
          <path d="M 830 752 C 912 752 936 668 900 604 C 880 566 896 520 936 528" fill="none" stroke="#0a0c10" stroke-width="56" stroke-linecap="round"/>
          <path d="M 830 752 C 912 752 936 668 900 604 C 880 566 896 520 936 528" fill="none" stroke="#8a847b" stroke-width="34" stroke-linecap="round"/>
          <path d="M 884 734 L 896 712 M 910 676 L 888 664 M 888 618 L 910 600" stroke="#5c574f" stroke-width="11" stroke-linecap="round"/>""",
    },
}


def svg(s, shape):
    """shape: "tile" (rounded square), "round" (circle), "full" (edge to edge, for iOS), "fg" (art only, 74%)."""
    top, bottom = s["bg"]
    bg = {
        "tile": '<rect x="48" y="48" width="928" height="928" rx="208" fill="url(#bg)"/>',
        "round": '<circle cx="512" cy="512" r="464" fill="url(#bg)"/>',
        "full": '<rect width="1024" height="1024" fill="url(#bg)"/>',
        "fg": "",
    }[shape]
    art = s["art"]
    if shape == "fg":
        art = f'<g transform="translate(512 512) scale(.74) translate(-512 -512)">{art}</g>'
    if shape == "round":
        art = f'<g transform="translate(512 512) scale(.86) translate(-512 -512)">{art}</g>'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>
        {s["defs"]}
      </defs>{bg}{art}</svg>"""


def render(text, size, out, opaque=False):
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(text)
    args = ["rsvg-convert", "-w", str(size), "-h", str(size), f.name, "-o", str(out)]
    if opaque:
        args[1:1] = ["-b", "#000000"]
    subprocess.run(args, check=True)
    pathlib.Path(f.name).unlink()


DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

colors = []
for name, s in STYLES.items():
    render(svg(s, "tile"), 256, DESKTOP / f"{name}.png")
    for d, k in DENSITIES.items():
        render(svg(s, "tile"), int(48 * k), RES / f"mipmap-{d}/ic_launcher_{name}.png")
        render(svg(s, "round"), int(48 * k), RES / f"mipmap-{d}/ic_launcher_{name}_round.png")
        render(svg(s, "fg"), int(108 * k), RES / f"mipmap-{d}/ic_launcher_{name}_foreground.png")
    (RES / f"mipmap-anydpi-v26/ic_launcher_{name}.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        f'  <foreground android:drawable="@mipmap/ic_launcher_{name}_foreground"/>\n'
        f'  <background android:drawable="@color/ic_launcher_{name}_background"/>\n'
        "</adaptive-icon>\n"
    )
    colors.append(f'  <color name="ic_launcher_{name}_background">{s["flat"]}</color>')
    # iPhone/iPad: one 1024 px image per alternate icon (no transparency; iOS rounds the corners).
    icon = ASSETS / f'{s["ios"]}.appiconset'
    render(svg(s, "full"), 1024, icon / "icon.png", opaque=True)
    (icon / "Contents.json").write_text(
        json.dumps(
            {
                "images": [{"filename": "icon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
                "info": {"author": "xcode", "version": 1},
            },
            indent=2,
        )
        + "\n"
    )

(RES / "values/style_icons.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<!-- Made by scripts/make-style-icons.py -->\n<resources>\n' + "\n".join(colors) + "\n</resources>\n"
)
print("made", ", ".join(STYLES))
