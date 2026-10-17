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

## Your computer's boards on your phone (Android app)

The Android app keeps its own boards, and can also show your computer's boards, encrypted, with no Chrome needed:

1. On the computer: Zomello → **Settings → Phones & tablets**. Turn it on and install its certificate on the phone; the page shows how. This is the same certificate Chrome uses.
2. In the phone app: **Settings → Servers → Boards on your computer**. Type the computer's `https://` address, or paste the whole pairing link from **Pair a device**, and tap **Connect**. Android 17 asks to let Zomello reach devices on your network; allow it.
3. The menu now has a section for each place: **This phone** and **My computer** (plus any Zomello Servers). Each section lists its boards by category, with **+ New board** at the bottom. Tap a board in another section to go straight to it. The app reopens wherever you were last.

Your computer's boards stay on the computer; the phone shows them while it can reach the computer. If it can't (computer off, different Wi‑Fi), the app opens the phone's own boards and offers **Try again**. Only https is used: the app trusts the certificates you install on the phone and refuses plain http to other devices.

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

### Build it on your PC and put it on your phone

Use this for testing; it's quicker than waiting for GitHub.

1. **Android Studio:** `paru -S android-studio` on Arch/CachyOS, or download it from developer.android.com. Open it once and finish its setup, accepting the licenses. Then go to **More Actions → SDK Manager → SDK Tools**, tick **NDK (Side by side)** and **Android SDK Command-line Tools**, and click Apply.
2. **The phone:** Settings → About phone → Software information, and tap **Build number** 7 times. Then Settings → Developer options → turn on **USB debugging**. Plug the phone in and tap **Allow**.
3. **Build and install:**
   ```bash
   npm run android
   ```
   It finds Android Studio's tools by itself, builds the app, installs it on the phone and opens it. Run it again after any change; the phone keeps your boards.

The first run sets up the Android project in `src-tauri/gen/android` and takes several minutes; later runs take a minute or two. `npm run android -- --debug` makes a much bigger build that lets a computer inspect the app over USB (Chrome's `chrome://inspect`).

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

See *Google Play* below to publish it on the Play Store.

## Google Play

1. **Build:** run `npm run android:release`. The first time, it makes your **upload key** in `~/zomello-keys/` and asks for a password. Back that folder up and keep the password, because every future update must be signed with it. It produces `app-universal-release.aab`.
2. **Play Console:** sign up at play.google.com/console ($25 once, plus an identity check). Create the app with name **Zomello**, type **App**, **Free**. The app's ID, `com.zombeatz.zomello`, is permanent once uploaded.
3. **Required forms** (Play Console → your app → Policy / App content):
   - **Privacy policy:** a public web page. A short one is fine: everything stays on the device or on computers and servers you choose, nothing is collected.
   - **Data safety:** "no data collected or shared".
   - **Content rating** questionnaire, **target audience** (adults), and **ads:** none.
4. **Store listing:**
   - A short and a full description.
   - The 512×512 icon: `src-tauri/icons/icon.png`, scaled.
   - A 1024×500 feature graphic.
   - At least 2 phone screenshots.
5. **Testing first:** new personal developer accounts must run a **closed test with at least 12 testers for 14 days** before Google allows a public release. In **Test and release → Closed testing**, create a release, upload the `.aab`, and add your testers' Google accounts. They install it from the link Play gives you.
6. **Release:** after the 14 days, apply for production access and promote the release to **Production**. Google reviews new apps, usually within a few days.

**Updates:** raise `"version"` in `src-tauri/tauri.conf.json` (e.g. 0.1.0 → 0.1.1), run `npm run android:release` again, and upload the new `.aab` as a new release.

**Your test copy:** the copy you installed by cable is signed with a different key, so Android won't update it with the Play version. Uninstall it first, which deletes the boards stored on the phone. Save any you want to keep beforehand: use a board's **⋯ → Save as board file**, or keep them on your computer.

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

The next **Build apps** run signs and notarizes the `.dmg`. The **Server downloads** for Mac get signed and notarized the same way.

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

- **Opening files by tapping (Android, iPhone):** tapping a `.zomello` file doesn't open Zomello yet. On phones, use **Settings → Data → Import a board** instead.
- **Saving board files on Android:** the Android app's built-in browser has no share sheet, so a saved board file lands in Zomello's folder under *Android/data*, which is awkward to find. iPhone, iPad and Chrome on Android use the share sheet. A proper Android share button is planned.
- **Finding servers on Android:** "Find servers on this network" may find nothing in the Android app, which needs extra permission to listen for network announcements. Add the server by its address instead.
- **Phone & tablet access in the mobile apps:** the Android and iPhone apps don't offer it; they are the phone.
