# iPhone and iPad: the My Day widget and "Add to Zomello"

This branch (`ios-extensions`) adds two small extensions to the iPhone and iPad app:

- **ZomelloWidget:** the My Day home-screen widget (small, medium and large).
- **ZomelloShare:** "Add to Zomello" in the share sheet. Text or a link waits in the app group, and Zomello opens Quick add with it the next time it's opened.

Both read and write the shared folder `group.com.zombeatz.zomello` (an App Group). Zomello writes the widget's content (`src/widget.ts` → `apple_group.rs`) and takes what was shared (`src/shareIn.ts`).

## Build it on the Mac

1. Get the branch: `git fetch && git checkout ios-extensions`
2. Install XcodeGen once: `brew install xcodegen`
3. Make the Xcode project from `project.yml`: `cd src-tauri/gen/apple && xcodegen generate && cd -`
4. Open `src-tauri/gen/apple/zomello.xcodeproj` in Xcode. For each of **zomello_iOS**, **ZomelloWidget** and **ZomelloShare**: **Signing & Capabilities** > **Automatically manage signing** on, Team **ZomBeatz Media**. Under **App Groups**, `group.com.zombeatz.zomello` should be ticked. If it's red, click the refresh button so Xcode registers it.
5. Run it on the iPad: `npm run tauri ios dev`, or build as usual: `npm run tauri -- ios build --export-method app-store-connect`.

## Try it

- **Widget:** press and hold the home screen > **+** (or **Edit** > **Add Widget**) > **Zomello** > **My Day**. It updates when you change things in Zomello (within about 15 minutes; iOS decides exactly when) and moves to the new day at midnight.
- **Share:** in Safari (or any app), **Share** > **Zomello** (it may be under **More**) > **Add**. Open Zomello: Quick add shows it.

## When it works

Merge the branch into main. App Store Connect picks the extensions up with the next build; there's nothing to add to the listing. Each extension's version (`CFBundleShortVersionString` / `CFBundleVersion` in `project.yml`) must match the app's, so bump all three together.
