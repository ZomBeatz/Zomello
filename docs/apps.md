# The Zomello apps

Zomello comes in two kinds of programs, the way Plex does:

| | What it is | Runs on |
|---|---|---|
| **Zomello** (the app) | Your own boards, stored on that device. It can also open any **Zomello Server** you have an account on. | Windows, Linux, Android |
| **Zomello Server** | Hosts boards for several people: accounts, an Admin page, shared boards with invitations. | Windows, Linux, macOS (PC, NAS, Raspberry Pi) or Docker. See [server.md](server.md) |

Ways to work together:

- **Board files (`.zomello`)** work without any server. On a board, open **⋯ > Save as board file…** and send the file however you like: email, a USB stick, a chat. Whoever opens it gets their own copy of the board, attachments included. Double-clicking the file opens it in Zomello.
- **A Zomello Server** keeps one board that everyone works on together, live. In the app, add servers under **Settings > Zomello Servers**, by address or with **Find servers on this network**. They appear in the sidebar under *Servers*, and each one opens in its own window.
- **Phone & tablet access** (desktop app) lets your phone use the boards on your computer while you're on the same Wi-Fi. Set it up in **Settings > Phones & tablets**.

## Downloads

Every version is on the repository's **Releases** page:

| File | Install |
|---|---|
| `Zomello_x.y.z_x64-setup.exe` | **Windows 10/11.** Run it; it installs for your user, no admin needed. SmartScreen may say "Windows protected your PC": click **More info > Run anyway**. |
| `.AppImage`, `.deb`, `.rpm` | **Linux.** `.deb` for Ubuntu/Debian/Mint, `.rpm` for Fedora/openSUSE. The `.AppImage` runs anywhere (mark it executable first). |
| `Zomello.apk` | **Android.** See below. |

Data lives in `%APPDATA%\com.zombeatz.zomello` on Windows and `~/.local/share/com.zombeatz.zomello` on Linux.

## Android

### Installing the APK

1. Download `Zomello.apk` on the phone (or copy it over).
2. Open it. Android asks to allow installs from that app (Files or Chrome). Allow it, then tap **Install**.

Updates install over the old copy and keep your boards.

### Your computer's boards on your phone

The Android app keeps its own boards, and can also show your computer's boards, encrypted:

1. On the computer: Zomello > **Settings > Phones & tablets**. Turn it on and install its certificate on the phone; the page shows how.
2. In the phone app: **Settings > Servers > Boards on your computer**. Type the computer's `https://` address, or paste the pairing link from **Pair a device**, and tap **Connect**. Allow Zomello to reach devices on your network if Android asks.
3. The menu now has a section for each place: **This phone** and **My computer** (plus any Zomello Servers), each with its own sections and **+ Board**.

While the phone is on the same network, its boards also show up in the computer's sidebar and can be edited there. Nothing is copied: when the phone leaves, they disappear from the computer.

## Building it yourself

Needs Node.js 20+ and Rust (rustup).

```bash
npm install
npm run app        # dev window with hot reload
npm run bundle     # Linux: AppImage, deb, rpm in src-tauri/target/release/bundle/
```

On Linux, `./scripts/install-desktop.sh` builds and installs Zomello into your app menu.

**Windows:** on a Windows PC, install Node.js LTS, Rust and the "Desktop development with C++" build tools, then `npm install` and `npm run bundle`. Or cross-compile from Linux:

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm run bundle:windows
```

**Android:** install Android Studio, and in its SDK Manager add **NDK (Side by side)** and **Android SDK Command-line Tools**. Turn on USB debugging on the phone, plug it in, then:

```bash
npm run android
```

It builds the app, installs it on the phone and opens it.

**On GitHub:** **Actions > Build apps > Run workflow** builds Windows, Linux and the APK. Pushing a version tag (`git tag v0.2.0 && git push --tags`) also gathers them into a draft release.

## Known limits

- **Opening `.zomello` files by tapping (Android):** use **Settings > Data > Import a board** instead.
- **Finding servers on Android:** "Find servers on this network" may find nothing in the Android app. Add the server by its address.
