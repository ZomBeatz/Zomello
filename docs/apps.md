# The Zomello apps

Zomello comes in two kinds of programs, the way Plex does:

| | What it is | Runs on |
|---|---|---|
| **Zomello** (the app) | Your own boards, stored on that device. It can also open any **Zomello Server** you've been given an account on. | Windows, macOS, Linux, Android, iPhone and iPad |
| **Zomello Server** | Hosts boards for several people: accounts, an Admin page, shared boards with invitations. | Windows, macOS, Linux (PC, NAS, Raspberry Pi) or Docker. See [server.md](server.md) |

Ways to work together:

- **Board files (`.zomello`)** work without any server. On a board, open **⋯ → Save as board file…**. Send that file however you like: email, a USB stick, a chat. Whoever opens it gets their own copy of the board, attachments included. Double-clicking the file opens it in Zomello.
- **A Zomello Server** keeps one board that everyone works on together, live. In the app, add servers under **Settings → Zomello Servers**, either by address or with **Find servers on this network**, which lists Zomello Servers on your Wi-Fi the way Plex finds its servers. They then appear in the sidebar under *Servers*, and each one opens in its own window. On phones and tablets a server opens in the browser, where it can be installed as an app of its own.
- **Phone & tablet access** (desktop app only) lets your phone use the boards on your computer while you're on the same Wi-Fi. Set it up in Settings → Phones & tablets.

## Getting the apps

GitHub builds every version for you. In the repository, open **Actions → Build apps → Run workflow**. When it finishes (about 20–30 minutes), the run's page lists **Artifacts**:

| Artifact | File | Install |
|---|---|---|
| `zomello-windows` | `Zomello_x.y.z_x64-setup.exe` | Run it. SmartScreen may say "Windows protected your PC": click **More info → Run anyway**. That warning goes away once the installer is code-signed. |
| `zomello-linux` | `.AppImage`, `.deb`, `.rpm` | Pick one: `.deb` for Ubuntu/Debian/Mint, `.rpm` for Fedora/openSUSE. The `.AppImage` runs anywhere (mark it executable first). |
| `zomello-macos` | `Zomello_x.y.z_universal.dmg` | Open it and drag Zomello to Applications. It runs on Intel and Apple Silicon Macs. If it isn't signed yet, right-click the app → **Open** the first time. |
| `zomello-android` | `Zomello.apk` | See *Android* below. |

Pushing a version tag (for example `git tag v0.2.0 && git push --tags`) does the same, and also collects everything into a **draft release** you can publish.

iPhone and iPad builds are made on your Mac (see below), because Apple only signs apps on a Mac or in Xcode Cloud.

## Android

### Installing the APK

1. Copy `Zomello.apk` to the phone (or download it there from GitHub).
2. Open it. Android asks to allow installs from that app (Files or Chrome). Allow it, then tap **Install**.

Until you set up your own signing key, GitHub signs each build with a throwaway key. Android only installs an update when it's signed with the same key as the copy already installed, so with test builds you have to uninstall the old copy first, which also removes its boards. Set up a key (next section) before you rely on it.

### Your own signing key (once)

On your PC, create a key. Keep the file and the password safe: every future update has to be signed with it.

```bash
keytool -genkeypair -v -keystore zomello-release.jks -alias zomello -keyalg RSA -keysize 2048 -validity 10000
```

Then turn it into text for GitHub:

```bash
base64 -w0 zomello-release.jks > zomello-release.jks.txt
```

On GitHub, open the repository → **Settings → Secrets and variables → Actions → New repository secret**, and add three secrets:

| Name | Value |
|---|---|
| `ANDROID_KEYSTORE` | the whole contents of `zomello-release.jks.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | the password you chose |
| `ANDROID_KEY_ALIAS` | `zomello` |

From then on, every APK is signed with your key and installs as an update over the last one.

To publish on the Google Play Store later, you'd also need a Play Console account ($25 once) and an `.aab` bundle (`npx tauri android build --aab`).

## Mac app signing (your Apple developer account)

Unsigned Mac apps need the right-click → Open step, and some Macs refuse them. With your Apple Developer membership, GitHub can sign and notarize the app so it opens normally.

On your Mac:

1. **Make the certificate.** In Xcode, go to **Settings → Accounts**, select your Apple ID, then **Manage Certificates… → + → Developer ID Application**.
2. **Export it.** Open **Keychain Access → My Certificates**, find *Developer ID Application: Your Name (TEAMID)*, then right-click → **Export…**. Save it as `cert.p12` and give it a password.
3. **Turn it into text** for GitHub:
   ```bash
   base64 -i cert.p12 | pbcopy
   ```
   This copies it to the clipboard.
4. **Make an app-specific password** for notarizing at [appleid.apple.com](https://appleid.apple.com): Sign-In and Security → App-Specific Passwords.
5. **Find your Team ID** at [developer.apple.com/account](https://developer.apple.com/account), under Membership details.

Add these GitHub secrets (Settings → Secrets and variables → Actions):

| Name | Value |
|---|---|
| `APPLE_CERTIFICATE` | the base64 text from step 3 |
| `APPLE_CERTIFICATE_PASSWORD` | the password from step 2 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)`, exactly as Keychain shows it |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password from step 4 |
| `APPLE_TEAM_ID` | your Team ID |

The next **Build apps** run signs and notarizes the `.dmg`.

## iPhone and iPad

The same app runs on iPhone and iPad; the layout adapts to the screen. It's built on your Mac with Xcode.

**One-time setup on the Mac:**

1. Install **Xcode** from the App Store and open it once to finish its setup.
2. Install **Node.js LTS** from [nodejs.org](https://nodejs.org).
3. Install **Rust**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
   Then run `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`.
4. Get Zomello's code with `git clone git@github.com:YOUR-USERNAME/zomello.git`, then `cd zomello && npm ci`.
5. Create the Xcode project:
   ```bash
   npx tauri ios init
   ```

**Put it on your own iPhone or iPad:**

1. Connect the device by cable and trust the Mac when asked. On the device, turn on **Settings → Privacy & Security → Developer Mode** (it restarts).
2. Run:
   ```bash
   npx tauri ios dev --open
   ```
   Xcode opens. Select the **Zomello** target → **Signing & Capabilities** → choose your **Team**. Then pick your device at the top and press **▶ Run**.

That's a development build signed to your account. For a permanent install on several devices, or for other people, use **TestFlight**:

1. Run `npx tauri ios build --export-method app-store-connect`.
2. Upload the `.ipa` with Apple's **Transporter** app.
3. Invite testers in App Store Connect.

Publishing on the App Store goes through the same App Store Connect page.

To avoid picking the team every time, put it in `src-tauri/tauri.ios.conf.json`: `"iOS": { "developmentTeam": "YOURTEAMID", "minimumSystemVersion": "15.0" }`.

## What's not there yet

- Opening `.zomello` files by tapping them on Android or iPhone. On phones, use **Settings → Data → Import** instead.
- Saving a board file on iPhone and iPad (and in Chrome on Android phones) opens the share sheet: Messages, Mail, Files, AirDrop and so on. The Android app's built-in browser has no share sheet, so there the file is saved in Zomello's folder under Android/data, which is awkward to find. A proper Android share button is planned.
- The Android and iPhone apps don't have phone & tablet access themselves. They are the phone.
