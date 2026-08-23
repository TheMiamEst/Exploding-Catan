# Exploding Catan

Catan with the development deck torn out and 54 kitten cards put in its place.
Plays locally against bots, hot-seat on one screen, or online with up to six
people.

Everything is in `Exploding Catan.html`. Double-clicking it still works — the
local game needs no server, no build step and no internet.

| file | what it is |
|---|---|
| `Exploding Catan.html` | the game: rules, board, UI, all of it |
| `ai.js` | the bots |
| `net.js` | online play |
| `firebase-config.js` | your Firebase keys (see below) |
| `art/` | optional card and tile art — anything missing falls back to drawing |

---

## Setting up online play

One-time, about five minutes. You only ever do this once; after that you just
update the game files.

### 1. Make a Firebase project

1. Go to <https://console.firebase.google.com> and **Add project**. Name it
   anything. Turn Google Analytics **off** — you do not need it.
2. In the left sidebar: **Build → Realtime Database → Create Database**.
   - Pick a location near you.
   - Choose **Start in test mode**. You will replace the rules in step 2.
3. Still in the sidebar: **Project settings** (the gear) → scroll to
   **Your apps** → click the web icon `</>`. Register the app with any
   nickname. Firebase shows you a `firebaseConfig = { … }` block.
4. Copy those values into `firebase-config.js`, replacing the `YOUR_…`
   placeholders. Keep the quotes.

### 2. Lock the database down a little

Test mode lets anyone read and write anything, and expires after 30 days.
In **Realtime Database → Rules**, paste this and **Publish**:

```json
{
  "rules": {
    "rooms": {
      "$code": {
        ".read": true,
        ".write": true,
        ".validate": "$code.length <= 8"
      }
    }
  }
}
```

That is still open to anyone who knows a room code, which is the trade for not
running a server or making everyone sign in. Room codes are four characters out
of a 32-character alphabet and rooms are deleted the moment the host closes the
tab, so the practical risk is a stranger guessing a code during the hour you are
playing. For a private game with friends this is fine. If you ever want it
properly closed, the next step up is Firebase Anonymous Auth and
`".write": "auth != null"`.

### 3. Play

- **Host:** open the game, press **Online**, type your name, press
  *Host N seats*. Read the four-letter room code out to everyone.
- **Everyone else:** open the same URL, press **Online**, type a name and the
  room code, press *Join room*.
- The host presses **Start game** when everyone is in. Any seat nobody took is
  played by a bot.

---

## Publishing it so friends can open a link

GitHub Pages, free, and updating is a `git push`.

1. Make an empty repo on GitHub. It can be private — Pages works either way on
   a free account for public repos; for a private repo you need Pages enabled,
   which is a paid feature, so **public is the easy path**.
2. From this folder:

```bash
git remote add origin https://github.com/YOUR_NAME/exploding-catan.git
git branch -M main
git push -u origin main
```

3. On GitHub: **Settings → Pages → Source: Deploy from a branch**, branch
   `main`, folder `/ (root)`. Save.
4. A minute later the game is at
   `https://YOUR_NAME.github.io/exploding-catan/Exploding%20Catan.html`.

To ship a change after that:

```bash
git add -A && git commit -m "what changed" && git push
```

Everyone gets it on their next reload. **All players must be on the same
version** — the state that travels between browsers assumes both ends agree on
what the game looks like. If you push a change mid-session, everyone should
reload.

---

## How online play actually works

One browser is the **host**. It runs the real game — the same code as the local
game, bots and all. Every other browser is a terminal: it never decides
anything. It sends what you did ("I dropped card 2 on log entry 14") and draws
the state the host sends back, in full, after every action.

The host redacts before sending: each seat gets its own cards and placeholders
for everyone else's, so the bluffing the Nope layer is built on survives.

Two things follow from having no server, and both are deliberate:

- **The host can read everything** in their browser's devtools. Pick a host you
  would lend money to.
- **If the host closes the tab, the game ends.** Everyone else is told why.

### Known rough edge

Open trades are run entirely from the offering player's screen — they click
Accept or Decline for each person as the table answers out loud. That is a
hot-seat habit that survived going online. It works, but it assumes you are on
a call together.

---

## Tuning

Two knobs, both readable from the browser console mid-game:

```js
REACT_WINDOW = 2000   // ms of answering room at every hand-over (default 3000)
AI.pace(1500)         // ms between visible bot actions (default 3000)
```

Both are deliberately slow: the window for a Nope or a Defuse is one log entry
wide, so a fast bot would slam it shut before a human could reach for a card.
