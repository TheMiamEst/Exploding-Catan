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

The build tag in the header — top right, next to the buttons — is the version
you are running. It changes with every release, so after a `git push` you can
reload and check the tag actually moved before blaming the game. Everyone
playing together has to be on the same one, and a terminal on a different
build says so out loud.

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

### Things you can see happen

Half of what happens on your turn used to happen invisibly: resources arrived
as a number ticking up in the corner, and a road appeared on the next repaint.

- **Pieces come down where they are placed** — a road the full length of its
  edge, a house on its corner, a city on its corner, each the shape and size of
  the real piece and in the builder's colour. The board leaves the piece out
  for the half-second it is falling, so what you are watching *is* the piece
  arriving rather than a flourish over one that landed a moment ago. Driven off
  the board state rather than off the click, so watching somebody else build
  looks the same as building yourself. Only things *arriving*: a Nope taking a
  road back off the board is a rewind, and does not land with a thump.
- **Production flies out of the ground.** Each hex that pays flashes in its own
  colour and the cards fly from it to the seat that owns the building, face up,
  landing on the resource counter they are about to change.
- **A bought kitten card flies off the deck** to the buyer, face **down** the
  whole way — which one it was is the owner's business.
- **A trade crosses between the two seat cards**, each side's half flying to
  the other. A bank or port trade happens at the trader's own elbow instead —
  down into the space just below their seat card and back up out of it. There
  is nobody on the other side of that one, and sending it out to the middle of
  the board made it look like there was.
- **Cards taken off you go the same way.** A Favor flies from the target to the
  asker, and an Exploding Kitten, an Attack and a seven all fly down to the
  bank at the loser's elbow. Every one of them face up: everybody already knows
  what those cards were.
- **The robbery is the exception, and travels face down** — `res-back.png` in
  the art folder. Which card the robber took is between the two of them, and it
  is the only exchange in the game nobody else is entitled to watch.

  Every card stands still for a second where it starts and a second where it
  lands. A card that only ever moves cannot be read: you see something cross
  the screen and have to work out afterwards what it was and whose it became.
  Several from the same place fan out rather than stacking.
- **The robber landing and a number token swapping** are bigger and slower than
  they were. They are the two things that change the board without a piece
  being built, and they were easy to blink past.

None of it is state: it is read off the live DOM a frame late, so it always
measures a board that has been laid out, and it is skipped entirely on a hidden
tab or for anyone whose system asks for reduced motion. Bursts are capped —
sixteen cards per event, sixty live pieces of animation — so a six-player
payout cannot bury the board or the frame rate.

The one place any of this touches what you can see of the game is the piece
held back while it lands, and that expires on its own: if the timer that ends
the animation never runs, the next repaint draws the piece anyway. A flourish
is not worth a board with a road missing from it.

### The seat cards

Points sit beside the name in a ring of their own — they are the score, and
lined up as a sixth identical box among roads and knights they read as trivia.
The rest is two groups rather than five boxes in a row: what is in your hand
(resources, kitten cards) and what is on the board (longest road, knights).
Largest Army lights the same gold as Longest Road, because they are the same
kind of thing — two points for holding something nobody else can.

### A phone held sideways

Landscape on a phone is about 375 pixels of height for everything, and the
strip at the top and the hand at the bottom were sized for a laptop. Between
them they left the board a letterbox. Under 560px tall the seat card folds onto
one row, the action buttons stop wrapping, the hand shrinks, and the board
takes what is left: on a 812x375 screen it goes from 43% of the height to 61%,
and the hexes from 17px to 24px. Nothing is removed — the same numbers, the
same cards, smaller.

The side panels get the height they can and each one scrolls inside itself with
its buttons pinned to the bottom, so the Trade button is never below the fold
with nothing obvious to scroll. Forced dialogs do the same.

The board takes touch directly: **one finger drags it**, **two fingers pinch to
zoom**, and **a double tap puts it back** to where it started. The pinch is
anchored, so whatever is under your fingers stays under them rather than
sliding away as it grows. It all runs on pointer events, so the same code
serves a mouse, a trackpad and a screen — the wheel now zooms towards the
cursor for the same reason.

The double tap matters more than it sounds. Between the browser's own
double-tap-to-zoom (killed here with `touch-action: manipulation`, which leaves
pinch-zooming the page alone for anyone who needs it) and a stray pinch on the
board, it was easy to end up magnified with only a 30px minus button to climb
back down. Two taps in the same spot now undo both the zoom and the pan. A
single tap still builds where you tapped, and a tap that ends a drag or a pinch
does not.

One trap worth knowing if you touch the stylesheet: several base rules
(`#panels`, `.modal`, `.panel`) are defined *after* the media queries, so a
query placed above them silently loses. The landscape block is deliberately the
last thing in the file.

### Numbers that keep up

Every figure on a seat card is live. It sounds like it should have been, but
it was not: numbers moved in a dozen places and not all of them asked for a
repaint. A bot buying a kitten card spent three resources and gained a card
without the board hearing about it, so the counters sat on figures that were
minutes old until something else forced a redraw — usually the end of the turn.

Rather than chase every call site, the four things that actually move
resources and cards ask for a repaint themselves, coalesced through a
microtask: a production payout of twenty gives costs exactly one redraw, and it
lands before the browser has painted, so the number changes in the same breath
as the thing that changed it. Walking four hundred bot actions and comparing
every seat card against the state after each one now finds no disagreement at
all, where the same walk used to find six.

### Dialogs that do not take the screen

Trades and card purchases open as **panels beside the board** rather than
modals over it, so the log, the board and your hand all stay reachable — you
can drop a Nope on something mid-trade. Each panel belongs to a seat, and one
seat's screen only draws its own, which is how a trade offer reaches everybody
at once: bots answer immediately, every person gets the offer on their own
screen, and the offerer watches the answers land before choosing who to deal
with. Nobody can answer for anybody else.

If a Nope or a Defuse rewinds the board while a panel is open, the panel is
closed — whatever it was offering may no longer be true.

Cards turning over in the middle of the board queue rather than overwrite each
other. They used to overwrite, which is fine for two unrelated plays and
useless for the pair that matter most: an action and the answer to it. A Nope
and the Nope that cancels it show the same face, so cutting the first one off
and dropping the second in its place looked like nothing had happened — and
being told your Nope has been handed back is exactly what you needed to see.
Answering somebody now waits for their card to finish. A backlog is capped at
two waiting and each card is held for a shorter beat while others are queued,
so the reveal never runs far behind the board.

Two robber moves can be owed at once — a seven, and a Knight played while
that seven's discards were still being paid. They queue rather than overwrite
each other, so both get made; the log says "must move the robber again" for
the second. A Knight turned around with a Defuse is placed by the defuser,
which is the usual explanation for a robber that seems to have moved with
nothing behind it.

Moving the robber and swapping the second Alter the Future token both take
two clicks, the same arm-then-confirm a build takes. Neither can be taken
back once it lands.

A Feral Kitten is a point the moment it is in your hand, not the turn after —
it is never played, so the "not until next turn" rule does not touch it. Draw
one at nine points and you win there and then, unless somebody Nopes it. A
Nope that lands costs you **every** Feral Kitten in your hand, not just enough
of them to drop you back under ten: taking the minimum left you parked on nine
with a spare, winning again the moment you laid one road.

A **Defuse** is the other card the "not until next turn" rule does not touch.
Every other card is a move you choose to make and can wait a turn to make; a
Defuse answers something being done to you, and a card you cannot play when
you need it is not a card. Draw one, get exploded, use it.

Your own points on the seat strip include the Feral Kittens in your hand;
every other seat shows the public figure the table is actually playing
against. Once somebody wins, every hand is face up and all the totals are
real.

Forced dialogs (discarding, answering a card aimed at you) are still modals,
because they have to be dealt with before play continues. Those carry their
own Defuse and Nope buttons, and they **fold away**: the − in the corner
shrinks the dialog to a tab in the bottom right and hands the board, the log
and your hand back, so you can drop a card on a line of the log rather than
answer from the dialog. Folding is a view state and yours alone; nobody
else's screen changes.

What folding hands back is the **reactions**, not the turn. While an answer is
owed — a seven part-paid, a robber still to place, a forced dialog open or
folded — rolling, building, buying, trading and ending the turn are all
refused, and the action bar says so instead of showing buttons. Dropping a
Nope or a Defuse on a log entry, and Noping somebody's turn, stay open: they
are what folding is for.

### What a Nope reaches

A Nope dropped on a line of the log undoes that line, and everything after it.
Three cases are worth calling out:

- **A roll** is *thrown again*, and the turn carries on. It does not end the
  roller's turn — ending a turn is no answer to a seven, since the robber has
  already moved and the hands have already been cut by the time the turn is
  over. This is what makes a Nope worth holding against a seven you cannot
  afford: five sixths of the rerolls are not sevens. A roll is also the one
  line you may Nope on **your own** turn, for exactly that reason.
- **A build** loses you the building, not the resources. What you spent stays
  spent — the same rule a Noped turn has always followed, and the reason a
  Nope is a real punishment rather than a free undo.
- **A trade** — between players or with the bank — puts the resources back
  where they came from. Trades are journalled like anything else, so the one
  move that can hand somebody the card they were missing is answerable too.
- **A seven can also be Defused**, which is the cheaper answer: it buys one
  hand out of the cut and leaves the rest of the roll standing. The robber
  still moves and everybody else still pays. Anyone the seven is about to take
  from may spend it — except whoever rolled it. Your own seven is yours to
  wear; you can Nope it and roll again, which costs you the number rather than
  sparing you the cut.
- **The robbery is Defusable too**, separately from the roll: drop a Defuse on
  the *"moves the robber onto…"* line. It is a "no you" like every other
  Defuse — the robbery is undone, and **you move the robber yourself**, and
  steal from whoever is standing on wherever you put it. The same seizure a
  Knight has always allowed, now available against the robber a seven sends
  round as well.

  Anybody with a building on the hex it landed on may spend it — not only
  whoever was robbed, since the robber sitting on your wheat costs you every
  roll it stays there. Never the player who moved it. Your own placement is
  then answerable in turn by whoever it lands on, which is bounded by how many
  Defuses are left in the game.

  A knight already credited stays credited: the card was played, and the
  Defuse answers the robbery rather than the card that caused it.

  No card opens a window asking whether you would like to answer it — not a
  Knight, not a Skip, not an Exploding Kitten. Everything it offered is on the
  board already: the card turns over in the middle of the screen, the line it
  wrote lights up in the log with a Defuse badge on it, and the card in your
  hand wakes up with an "answer" pip. What the window added was a modal
  standing on top of the log you wanted to drop the card onto.

  The forced dialogs that remain are the ones that take something from you
  before play can go on — a discard for a seven or an Attack. Those are a
  payment, not an offer. One consequence worth knowing: nothing pauses the
  table while you decide any more, so an answer has to be played inside the
  four log lines a Nope can reach back through.

  One Defuse settles it for the whole hex, and the robber lands on a hex
  several people share, so two of them reaching for it at once is ordinary.
  The host takes them in the order they arrive: the first goes through, and
  the second is turned away **with their card still in hand**. Nope that first
  Defuse and the robbery is back on the table for the others to answer.

Which card the robber took is never named anywhere public. The two of them can
see it in their own hands; the log and the feed say only that a card moved.

You are only asked who to rob when there is actually a choice. One player on
the hex is not a choice, and the window went up in front of an answer that had
already been decided.

---

## Tuning

Two knobs, both reachable from the browser console mid-game. Only the host's
setting matters for bot pacing, since only the host runs bots.

```js
AI.pace(1500)     // ms between visible bot actions (default 3000)
NOPE_REACH        // log lines a Nope may reach back, within the turn (default 4)
SHOWCASE_MS       // how long a played card stays on screen (default 2300)
```

Bot pacing is deliberately slow: a Nope has to be draggable onto a line before
the line scrolls out of reach, and a fast bot would bury it. A Nope only ever
reaches within the turn still in progress, **plus the three seconds after it
ends**. Play does not begin again in that gap: nobody can roll, the bots wait,
and nothing is drawn to say so — the table simply does not start, which is what
a table does while somebody thinks. Without it, playing a card and pressing End
Turn in the same breath put the card out of reach before anyone could lift a
finger, and "play it and leave" was a strategy rather than a risk.
