# Tester sign-up automation

`Code.gs` runs inside the form's response spreadsheet. Each time someone signs up, it:

- adds their Google Play email to **zomello-testers@zombeatzmedia.com**, the group the Play closed test uses;
- emails them the links for the devices they picked;
- fills in **Play added**, **Play link**, **TestFlight**, **Email sent** and **Notes** at the right of the sheet;
- a week later, sends a short "how is it going?" email and fills in **Check-in**.

## Setup (about 10 minutes, on a computer)

1. In the form, open **Responses** and click **Link to Sheets** to make a new spreadsheet.
2. In that spreadsheet, open **Extensions > Apps Script**. Delete what's there, paste in all of `Code.gs` and click **Save**.
3. In the script editor, click **+** next to **Services**, choose **Admin SDK API** and click **Add**.
4. Fill in the two links at the top of `CONFIG`:
   - `PLAY_OPT_IN`: in Play Console, open the closed test's **Testers** tab. The opt-in link appears after you've added the group under **Google Groups**. Until then, leave it empty: Android testers are still added to the group and told the link is on its way, and their rows show **Waiting for link**.
   - `TESTFLIGHT`: the public link from your external TestFlight group. This only exists after the first build passes Beta App Review. Until then, leave it empty: iPhone and iPad testers are told the link is on its way, and their rows show **Waiting for link**.
5. Click the **clock icon** (Triggers), then **Add trigger**:
   - function `onFormSubmit`;
   - event source **From spreadsheet**;
   - event type **On form submit**.

   Save, then allow the permissions Google asks for. Do this signed in as info@zombeatzmedia.com, the group's owner.
6. Reload the spreadsheet and choose **Testers > Turn on the day-7 check-in emails**, then allow the new permission Google asks for.
7. Test it: send the form once from a second Google account, then check the sheet's new columns and that account's inbox.

## Later

- **A link arrives:** paste it into `CONFIG.PLAY_OPT_IN` or `CONFIG.TESTFLIGHT`, save, reload the spreadsheet, then choose **Testers > Send the Play link to everyone waiting** or **Send the TestFlight link to everyone waiting**.
- **A row went wrong** (a mistyped email, for example): fix the cell, select the row, then choose **Testers > Run again for the selected row**.

## Good to know

- Every email's subject has **Zomello beta** in it, and replies keep it. A Gmail filter on `subject:("Zomello beta" OR "Zomello feedback")` puts the test's mail, and feedback sent from the app, under one label.
- Gmail lets the account send about 1,500 emails a day, far more than a beta test needs.
- The script never stores anything outside the spreadsheet. Keep the spreadsheet private.
- Testers still tap **Become a tester** on the Play opt-in page themselves. Google requires that step and it can't be automated.
