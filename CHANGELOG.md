# Changelog

## 0.6.1 (in progress)

**Reporting problems**
- **A problem log on each device:** errors and crashes are noted in a small file that never leaves the device. **Settings > About** shows how many lines it has and can **Copy**, **Save** or **Clear** it.
- **Send feedback** adds the last few problems from the log to the email, so a bug report says what went wrong.
- **Android crash reports in Play Console** are readable now: the app bundle carries the debug symbols Google asks for.

**Mac**
- **A Mac version:** one app for Apple silicon and Intel Macs. The release has a `.dmg`, and a Mac App Store build is on the way. The App Store copy leaves start at login and the firewall to macOS's own settings, like the Microsoft Store copy does on Windows.

**Behind the scenes**
- Tauri and its plugins updated to their latest fixes. DOMPurify updated for a security fix.

## 0.6.0

**Features: as simple or as full as you like**
- **Settings > Features** has three starting points, **Simple**, **Standard** and **Everything**, and eight groups you can turn on or off one by one: planning extras, linking tasks, more views, board looks, time tracking, custom fields, bucket automation and AI tools.
- **Nothing is ever deleted** by turning a group off: its buttons and menus are hidden, and cards that already use it still show it.
- **The welcome guide asks** how much to show at first. Everyone who used Zomello before keeps everything on.

**Linked tasks**
- **Tap a link badge** on a card to see everything it's linked to, grouped (part of, sub-tasks, blocked by, blocks, related), and jump to any of them. Made for phones, where you can't point at a card to see its links. The card menu has **Linked tasks…** too.
- **Blocked cards** say what they're waiting on ("Blocked by Homepage redesign"), look faded, and ask before you complete them. Completing the last card they wait on tells you which card is free to start.

**Bucket rules**
- **New cards start from a template**, keeping the title you type.
- **Cards moved or made here** can get a due date (if they have none), people, or a place on My Day.
- **When the whole checklist is ticked:** complete the card and/or move it to another bucket.
- **Tidy up:** archive completed cards after a day, a few days, a week or a month.
- **Skip bucket rules** on a card (its menu, the card itself, or several selected cards at once): moving it, ticking its checklist and Tidy up leave it alone. Handy for a reference card that lives in Done. A small icon on the card shows it's on.
- **Late cards:** cards in a bucket that go past their due date can move to another bucket and/or get a new priority, for example "Urgent".
- **Apply to the cards already here:** rules act on cards as they arrive; one click in the rules window gives the cards already in the bucket the same treatment.
- **A card's Activity says when a bucket rule made a change**, and which bucket's rule it was.
- **A small lightning icon on a bucket's header** shows it has rules. Point at it to see what they do, or click it to change them.

**Due today, at a glance**
- **"2 late" and "3 due today"** show next to the board's Filter button when cards need you. Click one to see only those cards, and again to see everything.

**Finding what's new**
- **After updating, a short note** shows the main things to try, once. **Settings > About > What's new** brings it back.

**Changing selected cards**
- **Fields** in the bar sets a custom field on every selected card at once.

**Filters**
- **Blocked** / **Not blocked**, **No labels**, **Not** a label, and filters for custom fields.

## 0.5.4

**Calendar**
- **Day, Week and Month views.** Week and Day show the hours, like Outlook: drag a card to a time to schedule it, or double-click an empty time to add one.
- **Start and end times on cards.** Next to a card's start and due dates, add a time (or leave it empty for all day).
- **Cards that run over several days show as one bar** across those days, in Month and in Week.

**My Day**
- A new page (in the menu, or press D) with what to do today on every board: what's late, what's due or scheduled today (timed things in time order), and what you added yourself. Add any card from its menu with **Add to My Day**; added cards leave My Day at midnight. **Suggestions** offers what's coming up.
- **Not finished from earlier:** tasks you added to My Day in the last week and didn't finish show at the top, with **Add all to today** or **Clear**.

**Your devices**
- **Move or copy cards to another device:** a card's menu has **Move to device** and **Copy to device**, with the boards on your computer, your phone or a Zomello Server. A selection of cards goes together.
- **Device backups:** a phone or tablet can have your computer keep a copy of its boards (Settings > Servers on the phone). After a reinstall, send it back from the computer (Settings > Phones & tablets > Device backups). Private boards can be included, locked with a password only you know.
- When your computer's boards or sections change, the phone's menu shows it right away (before, it waited until you opened one of the computer's boards).

**Adding tasks**
- **Type the date in the title:** "Dentist tomorrow 3pm", "Call Sam friday at 2:30", "Report due Oct 28". Zomello sets the date and time and shows what it found; the × keeps the words in the title instead.
- **Type a repeat in the title too:** "Water plants every monday", "Rent monthly on the 1st", "Standup daily at 9:30 until Dec 20". Turn it off in **Settings > Adding tasks**.
- **Board templates:** start a board from a weekly plan, moving house, a school term, a trip, a project, household chores, an event or a job search.
- **Save any board as a template** (its menu > **Save as template**): its buckets, labels and open cards, without dates or people. Your templates show first under **Start from a template**.
- **Share to Zomello (Android):** share a link or text from any app and pick **Add to Zomello**.

**Changing many cards at once**
- **Select cards, then change them together:** set progress, priority, labels, people or due dates (or push them all a day or a week later), move them to another bucket or board, add them to My Day or duplicate them. Ctrl click a card (or choose **Select** in its menu, which also works on phones), then click or tap more. **Shift click** selects a range, **Ctrl A** selects everything on the board, and a bucket's menu has **Select all cards**.
- **Click an empty part of the board** to clear the selection.

**Bucket rules**
- **Bucket rules…** in a bucket's menu: new cards made in a bucket can get labels and a priority, and cards moved in can get a progress (as before) and labels. For example, every card made in "Testing" gets a "From testing" label it keeps after moving on.

**More**
- **My Day widget (Android)** for your home screen.
- **Done and Snooze** on reminders on phones and tablets.
- **Resize timed cards** in the calendar's Week and Day views by dragging their bottom edge.
- **Your Zomello dates in your calendar app:** save a calendar file from any board, or (on a Zomello Server) make a private calendar link that Google Calendar, Outlook or Apple Calendar subscribe to. The calendar file for every board leaves out private boards.
- **Device backups include attached files.**
- **Send feedback** in Help and Settings > About starts an email with your version and device filled in.

**Also**
- **Zomello is open source** under the MIT license. Settings > About links to the code.
- **Fixed:** changing a setting in a bucket's menu could pick the bucket up and drag it until you let go of the mouse.
- **Reminders on phones and tablets arrive even when Zomello is closed.** The app hands each card's reminder and the daily summary to the phone ahead of time.
- Choose how many checklist items a card shows on the board (Customize > Show on cards).
- Plainer wording all over the app, and the Help link opens the guide at docs.zombeatzmedia.com.

## 0.5.3

**Share boards between your devices**
- Each phone or tablet can let your other devices connected to the same computer see and edit its boards (Settings > Servers). It's off until you turn it on.
- Mark any board **Private: only on this device** in its menu. Private boards never leave the device, and your computer's private boards don't show on your phones.

**Also**
- A privacy policy page for the app stores.

## 0.5.2

**iPhone and iPad**
- Zomello now builds for iPhone and iPad, with "This iPad" in the menu and a side menu that fits in portrait.

**Phone and tablet apps**
- Scan the QR code on your computer to connect to it. If the computer's certificate isn't installed yet, Zomello offers to open its setup page.
- Saving a board file (and exporting your data) on Android opens the Save screen, with Share afterwards.
- A new app icon that fills Android's icon shape, and Zomello's own icon on notifications.
- Moving a board from your computer's boards inside the phone app works now.
- Layout fixes: the board toolbar fits on one row, the calendar uses the full width with unscheduled tasks below it, and cards and pages use the whole screen width.
- Hints meant for a keyboard and mouse are hidden on phones, and "Desktop notifications" reads "Notifications".

## 0.5.1

**Move boards between your devices**
- In the phone app, drag a board onto another place in the menu (This phone, Computer, or a server) and choose Move or Copy. Holding a board also gives **Move to…** and **Copy to…**.
- On the computer, a phone on the same Wi-Fi shows in the sidebar. Drag your boards onto it, or drag its boards into yours.
- Boards bring their buckets, cards and attached files along.

**Copy and paste cards**
- New **Copy card** in a card's menu, and **Paste cards…** in board and bucket menus, on every device.
- Pasting keeps titles, descriptions, checklists, labels, priority, dates and people.
- A plain list from anywhere also works, one card per line. On a computer, Ctrl+V on a board does the same.

**Also new**
- An online demo to try Zomello in the browser, with nothing to install.
- Windows downloads now come as a single `.exe` installer.
- A new README with screenshots, a quick start and answers to common questions.

## 0.5.0

First public release: Zomello for Windows, Linux and Android, plus Zomello Server for Docker, Windows, Linux and macOS.
