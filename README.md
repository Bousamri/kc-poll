# Keratoconus talk: live audience poll

A two-question poll for the oral presentation *Prevalence of keratoconus in the Middle East and North Africa: systematic review, meta-analysis and projection to 2050*.

The audience scans a QR code, guesses how common keratoconus is in the general population and among refractive-surgery candidates, and later sees how their guess compares with the pooled estimates (2.34%, 1 in 43; and 7.49%, 1 in 13).

| Page | Who uses it | Address |
| --- | --- | --- |
| Voting page | Audience phones | `https://bousamri.github.io/kc-poll/` |
| Presenter screen | Projector, laptop or your phone | `https://bousamri.github.io/kc-poll/screen.html` |
| Rehearsal | You and friends, before the talk | add `?s=test` to either address |

Votes go to a Google Sheet that you own, through a small Google Apps Script (`backend/Code.gs`). Nothing else is involved: no accounts for the audience, no paid service.

## Setup (about five minutes, once)

### 1. Put the site online (GitHub Pages)
1. Create a **public** repository named `kc-poll` and add these files.
2. Repository **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, Branch `main`, folder `/ (root)`, **Save**.
3. After a minute the voting page is live at `https://bousamri.github.io/kc-poll/`.

### 2. Connect the Google Sheet
1. Open a new Google Sheet (type `sheets.new` in the address bar) and name it `KC poll votes`.
2. **Extensions → Apps Script**. Delete the few lines already there, paste all of `backend/Code.gs`, press **Save**.
3. **Deploy → New deployment →** gear icon → **Web app**. *Execute as:* **Me**. *Who has access:* **Anyone**. **Deploy**.
4. **Authorize access →** your account → *Google hasn't verified this app* → **Advanced → Go to … (unsafe) → Allow**. Google shows this for every personal script. The `@OnlyCurrentDoc` line limits the script to this one spreadsheet.
5. Copy the **Web app URL** (it ends in `/exec`).

### 3. Tell the site where the sheet is
Open `config.js` on GitHub, press the pencil icon, paste the URL between the quotes of `api: ""`, and commit. Until then both pages run in **demo mode** with made-up numbers.

## On the day

* **Slide:** put `slide-qr/kc-poll-qr.png` (or the `.svg`) on the poll slide with the address `bousamri.github.io/kc-poll` underneath.
* **Your phone:** open your private presenter link (`screen.html#k=…`, sent to you separately) once. The phone remembers it. It shows the live count, the most chosen answer for each question, and a **Reveal answer** button. Revealing also shows each person their own result on their phone.
* **Projector (optional):** open `screen.html` in a browser, press **F** for full screen. A presentation clicker steps through: start the timer → question 1 results → reveal → question 2 results → reveal.

| Key | Action |
| --- | --- |
| → / Space / clicker | Next step |
| ← | Back one screen |
| 0, 1, 2 | Join screen, question 1, question 2 |
| R | Reveal or hide the answer |
| T | Start or restart the timer |
| F | Full screen |
| B | Black screen |
| ? | Settings and keys |

## Rehearsing
Use `?s=test` on both pages. Rehearsal votes never mix with the live ones. With your presenter key, **Settings → Clear all answers** starts a session from zero (rows stay in the sheet, they are just not counted), and phones on that session go back to question 1 by themselves.

## How it behaves
* Each phone gets a random ID, stored on that phone only. No names, emails or sign-ins.
* Phones open on a short start screen; each person's 45-second countdown (set in `config.js`) begins when they tap Start.
* An answer is sent the moment it is tapped. If the network drops, it stays on the phone and is retried automatically.
* Answers lock on the first tap: there is no way to go back or change them.
* Answers that arrive after a question is revealed are stored but not counted.
* Phones only check for the reveal while the screen is on, every 20 to 30 seconds, which keeps the load on the Google script small.

## Files
```
index.html          voting page
screen.html         presenter screen
config.js           the backend address (the only file you edit)
assets/questions.js the two questions
assets/answers.js   answer key and sources (phones load it only after a reveal)
backend/Code.gs     Google Apps Script backend
slide-qr/           QR code for the slide
```

The QR generator in `assets/qrcode.js` is by Kazuhiko Arase, MIT licence.
