# Exploding Catan

Catan with the development deck torn out and 54 kitten cards put in its place.
Plays locally against bots, hot-seat on one screen, or online with up to six
people.

Everything is in `index.html`. Double-clicking it still works — the local game
needs no server, no build step and no internet. It is called `index.html` so
that the published URL is a bare folder rather than
`…/Exploding%20Catan.html`, which is unreadable over a phone call.

| file | what it is |
|---|---|
| `index.html` | the game: rules, board, UI, all of it |
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
4. Paste that whole block into `firebase-config.js`, replacing the one that is
   already there — variable name included. The console writes
   `const firebaseConfig = {…}` and that is exactly what the game looks for.

If the **Online** button still says it is not ready, it will now tell you which
of these is wrong rather than just that something is.

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
- For another round, the host opens **Online** again and picks **Restart with
  these players**: same room, same seats, a fresh board. Nobody has to rejoin.

---

## Publishing it so friends can open a link

GitHub Pages, free, and updating is a `git push`.

**The repository has to be public.** On a free GitHub account Pages is a paid
feature for private repositories, and the giveaway is that **Settings → Pages**
shows an upgrade notice where the *Source* dropdown should be. That is the one
thing that catches everybody.

Making it public is fine here: `firebase-config.js` is the only sensitive-
looking file and Firebase web configs are meant to be public — every player's
browser downloads it anyway. What protects the database is the rules in step 2
above, which is why you should not skip them once the repo is out in the open.
If you would rather keep the source private, Cloudflare Pages and Netlify both
build from a private GitHub repo on their free tiers.

1. On GitHub: **Settings → General → Danger Zone → Change repository
   visibility → Make public**.
2. **Settings → Pages** (left sidebar, under *Code and automation*). Under
   *Build and deployment*, set Source to **Deploy from a branch**, then pick
   branch **`master`** and folder **`/ (root)`**. Save.
3. Wait a minute or two. The game is then at

   ```
   https://themiamest.github.io/Exploding-Catan/
   ```

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
for everyone else's, so the bluffing the Nope layer is built on survives. What
you will see under your room in the Firebase console:

| path | what it holds |
|---|---|
| `pub` | the log and the event feed — the same for everybody, so it goes out once |
| `view/0` … `view/5` | one seat's private state: hands, board, whose turn it is |
| `prompt` | a dialog the host has handed to one player to answer |
| `intents` | what players did, consumed and deleted by the host |

About 24 KB reaches each browser per action, so a long six-player game costs
roughly 35 MB of the free tier's 10 GB a month. Rooms delete themselves when
the host leaves.

Two things follow from having no server, and both are deliberate:

- **The host can read everything** in their browser's devtools. Pick a host you
  would lend money to.
- **If the host closes the tab, the game ends.** Everyone else is told why.

### Known rough edge

An open trade goes round the table one player at a time rather than out to
everybody at once, because only one dialog can be in flight across the room.
Bots answer instantly; each person gets the offer on their own screen in turn.
Nobody can be answered for, but a six-player table takes a moment to poll.

---

## Tuning

Two knobs, both reachable from the browser console mid-game. Only the host's
setting matters for bot pacing, since only the host runs bots.

```js
AI.pace(1500)   // ms between visible bot actions (default 3000)
NOPE_REACH      // how many log lines back a Nope may reach (default 4)
```

Bot pacing is deliberately slow: a Nope has to be draggable onto a line before
the line scrolls out of reach, and a fast bot would bury it.
