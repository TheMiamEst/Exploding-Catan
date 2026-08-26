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
  *Host N seats*. Read the four-letter room code out to everyone. Starting a
  local game from **New Game** leaves the room first, and says so before it
  does — if you are the host, leaving ends it for everybody.
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

There is a **build stamp** in `index.html` — `GAME_VERSION`, near the top of
the script — and it is not shown anywhere on the page. It has two jobs, both
machine-facing:

- The three script tags at the bottom of the file carry it as `?v=`, which is
  what stops GitHub Pages serving ten-minute-old JavaScript after a push.
- The host stamps it into the state, so a player on different code gets a
  banner saying so rather than a game that misbehaves for no visible reason.

**Bump it on every release, in both places** — the constant and the three
`?v=` query strings, which have to match each other. Miss it and everybody
keeps the old code for ten minutes and blames the game. A date is a good stamp
precisely because it is not a decision.

One thing the stamp cannot fix: **`index.html` itself has no cache-buster**,
and it is where nearly all the game lives. Pages serves it with the same ten
minute max-age, so a reload straight after a push can hand you the old file and
none of your changes. If something you just shipped is not there, that is the
first thing to rule out — a hard reload (Ctrl+Shift+R) settles it.

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

**The log is only redrawn when it changes.** A terminal rebuilds the log from
the published state, and the host publishes after every repaint — which is
caused by all sorts of things that are nobody else's business: opening a trade
panel, clicking a resource inside it, even dragging the corner of the window.
Each of those arrived everywhere else as a fresh state and threw away the whole
log to build it again, replaying the entry animation on every line. So the log
flickered on everybody else's screen whenever the host resized theirs, which is
a thing they could see and could not possibly explain. Compare first, and do not
rewrite what is already on screen — the same guard the chat window, the side
panels and the dice all use.

**All of it travels.** The flight itself is written onto the state and
published like everything else, and every browser plays it off that record.
This was the single biggest thing wrong with online play and it was invisible
from the host's chair: the piece plops and the card reveals had always been
driven off the state, so they reached everybody, but every flying card was
called straight out of the game logic — and only one browser runs the game
logic. The host watched resources fly out of the ground, trades cross between
seat cards and robberies travel face down; everyone else watched the numbers
quietly change and reasonably concluded the game had no animation in it.

A flight carries what actually **moved**, copied at the instant it moved,
rather than a reference to whatever the caller was holding. So an animation can
no longer disagree with the board about how many cards changed hands — which
it could: a player owed three wood off two hexes and paid one by a nearly empty
bank watched three cards arrive and their counter go up by one.

**The dice tumble travels too**, and used to be the last thing that did not.
It was a flag on the state that the drawing cleared as it read it — and the
drawing runs inside `render()`, which runs *before* the state is published. So
the dice were always already stale by the time they went out, and no terminal
ever saw a die move: the numbers simply appeared. It is a counter now, and a
counter that only goes up cannot be consumed by whoever looks at it first.

That turned out to be half of it. The tumble was invisible to the **host** as
well, on any roll that paid out: producing resources asks for a repaint of its
own, so a roll rendered twice, and the second pass replaced the very elements
that were mid-animation with identical ones that were not. A CSS animation runs
from the moment its element is created, so the second write threw the first away
before the browser had drawn a frame of it. The dice are now written only when
the throw itself changes — the same compare-first guard the chat window and the
side panels already use. Worth remembering for anything else that animates on
creation: a repaint is not free if the thing you are animating is rebuilt by it.

Face down means face down **on the wire** too. Now that flights travel, a
robbery naming its resource would put it in every player's copy of the state,
readable by anyone who opened devtools — so only the count goes out and the
backs are drawn from that.

The drawing itself is not state: it is read off the live DOM a frame late, so
it always measures a board that has been laid out, and it is skipped entirely
on a hidden tab or for anyone whose system asks for reduced motion. Bursts are
capped — sixteen cards per event, sixty live pieces of animation, eight
flights kept on the state — so a six-player payout cannot bury the board or
the frame rate. A screen that has only just been handed a game in progress
catches up silently rather than replaying the last eight things that happened
at somebody who has just sat down.

The one place any of this touches what you can see of the game is the piece
held back while it lands, and that expires on its own: if the timer that ends
the animation never runs, the next repaint draws the piece anyway. A flourish
is not worth a board with a road missing from it.

### The seat cards

Laid out the way Catan Universe lays its player box out, because that is an
arrangement most people at this table already know how to read:

```
  ③───┐  ┌──────────┐
  │ ●  │  │   Josh   │   ← name banner
  │    │  └──────────┘
  └┬───┬┘  [ 4 │ 3 ]       road, knights
   │ 7 │ 2 │                 ← hangs off the bottom
   └───┴───┘                   res, kitten cards
```

The portrait on the left, the score in a ring riding its top-left corner, the
name on a banner across the top of the right column, and what is on the board
hanging under the banner. Points get the ring of their own because they are the
score — lined up as a fifth identical box among roads and knights they read as
trivia. Largest Army lights the same gold as Longest Road, because they are the
same kind of thing: two points for holding something nobody else can.

The portrait is **bigger than the box has room for, and breaks its top edge to
get there**. The negative margin is what makes that free: a grid item's margins
are what its row is sized against, so the portrait contributes its old height to
the layout and renders at its new one, growing upwards out of the card. The card
does not get taller for it — it got 6px shorter — and the strip's existing top
padding is what the overhang grows into.

**What is in the hand hangs off the bottom of the card**, half in and half out.
That is the one thing here that is not ordinary layout, and it buys the
portrait its size back: the two numbers you glance at most sit in the strip's
own padding rather than taking a row from a card that has a face in it. The
strip carries the extra padding itself, because `overflow-x: auto` clips
vertically too — a pill hanging past the strip would simply be cut off.

The name banner is tinted with the seat's own colour, so the card says whose it
is twice over without saying it twice.

The card is a **grid**, not two nested columns, and that is the whole reason
the short-screen layout can re-parcel the same four boxes into two rows beside
the portrait without the markup changing — and why the hanging pill can drop
back into the flow when there is no height to hang into. The coloured dot that used to sit by
the name is gone — the portrait is ringed in the seat's colour, so six people
who all picked the same cat are still six different colours.

### Pictures

Everybody picks a face, from the **New Game** dialog, from **Online** before
you host or join, or by clicking your own portrait at any point in a game. The
choice is remembered between games.

They live in a folder of their own — `art/profile/1.png` … `40.png` — so that
actual pictures of people stay separate from hex tiles and card faces. Numbered
rather than named because the game probes for them: adding one is dropping a
file in, with no list to edit.

That folder is the **only** place a portrait comes from. The picker used to
fall back to the card faces and terrain tiles in `art/` while it was empty,
which was a reasonable stopgap and wrong the moment there were real pictures in
it — not least because an id saved from those days went on resolving, so
somebody who had once picked the Defuse card kept it for good however many
portraits arrived afterwards. An empty folder now means everybody plays as
their initial on their seat colour, which is also what you get by picking
**None**, and an old choice saved in the browser is dropped on load rather than
quietly showing as an initial nobody can explain.

What travels between browsers is an id like `a:3`, not a file, and each browser
resolves it against its own folder. Nobody has to have the
same art as anybody else: somebody with art you have not just shows up as their
initial on your screen.

Bots are dealt faces of their own at the start of a game, all different, and
never the one you chose.

### Talking at the table

Two more buttons beside the log.

**Chat** opens a window in the same left-hand column. It does not float over
the log — the log starts below it, so nothing you were reading is covered by
what somebody typed. The log's own top is measured from the button strip rather
than hardcoded, because the strip wraps to two rows on a narrow screen and to
one on a wide one, and it has gained buttons over time; an offset per
breakpoint worked right up until the row count changed under it. The button
carries a count of what was said while it was shut, and your own messages never
count towards it.

**Emoji** opens a tray of eighteen. Throw one and it lands over the middle of
your own portrait — big, no bubble behind it, two drop shadows so it reads over
pale art and dark alike — sits there for three and a half seconds and fades. A
repaint in the middle of that resumes the animation rather than replaying the
pop. It is centred with negative margins rather than a translate, because the
pop is a transform animation and the two would fight.

Both hang off the bottom of the button strip, in the same place: they are two
answers to the same question, so only one is ever out and opening either puts
the other away.

A kitten card bought off the deck flies to the **kitten counter** rather than
the middle of the seat card, which is where the counters used to be before the
portrait took that space.

**A trade offer is not written to the log.** Nothing has moved when one goes
out, and it may be declined by everybody — the log is for what happened, and a
trade that is agreed writes its own line when it settles. Bot refusals were
never announced either, so the two now match, and the log has stopped being a
running commentary on people thinking about trades.

**The bots throw them too, and they are not gracious.** They read the journal
— the public record of what was played, by whom, at whom — and react to it:
whoever just took your whole hand laughs at you, whoever just lost theirs
blames the dice, and a landed Nope is the smuggest moment available to anybody.
They congratulate a human who wins, about half the time. They cannot see a hand
to decide whether to laugh, so `AI.selfCheck`'s promise is untouched, and it is
funnier this way round anyway — they are reacting to what the table saw. Rate
limits keep it to roughly one throw every few turns rather than a wall of
faces: two and a bit seconds of quiet across the whole table after any throw,
nine seconds for the bot that made it, and every chance thinned by a single
`TAUNT_RATE` on top. They were funny at the old rate and wearing at it — the
joke is the timing, and timing needs gaps. One number rather than a dozen
re-tuned, so the tuning underneath still reads as "how much does THIS deserve
a laugh".

Both ride on the state rather than in the DOM, for the reason the feed does:
online, the host's browser is the only one that sees anything happen. A
terminal sends what was typed as an intent and waits to be told it landed,
exactly like a card being played — which also means neither can be forged into
anything but a message or one of the eighteen. Messages are escaped before they
are drawn; an emoji has to be one the tray holds.

### A phone held sideways

Landscape on a phone is about 375 pixels of height for everything, and the
strip at the top and the hand at the bottom were sized for a laptop. Between
them they left the board a letterbox. Under 560px tall the seat card folds its
name and both pills into two rows beside a smaller portrait, the button strip
above the log stays on one line rather than stacking, the action buttons stop
wrapping, the hand shrinks, and the board takes what is left: on a 812x375 screen it goes from 43% of the height to 61%,
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

The reset only fires on **bare board**. Building is itself a two-click gesture
— the first click arms the spot, the second confirms it — so on a vertex, an
edge or a hex, two taps in the same place are a placement and nothing else.
Treating them as a reset ate the confirming click and put the zoom back
instead, which is why, zoomed in, you could not build at all: every attempt
reset the view, and only the next pair of clicks landed. Anything carrying a
click handler is a hit target; the board behind them is not, and still
resets.

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

### Composing a trade

Both the player-to-player offer and the bank/port panel work the same way.
Click a resource to put one in, click past the most you could put in and it
wraps back to none, and the **− in the corner** takes one back out — which
is the way you actually fix a slip, rather than clicking a five all the way
round to nothing. The minus is only drawn when there is something to take back.
It is a `<span>` inside the button rather than a second button, because a
button cannot contain a button, and its click is stopped from reaching the
button underneath — which would otherwise put the card straight back in.

Both directions go through the same handler with a signed argument, so nothing
new had to be added to the short list of calls a terminal is allowed to make of
the host: online, a remote player's minus arrives as the same `modalCall` their
plus always did.

### Dialogs that do not take the screen

These take the **full height of the board area**. They used to be inset top and
bottom to keep clear of the dice and the kitten deck, which on a shorter screen
left a trade offer scrolling inside itself — and a dialog you have to scroll
before you can answer it is a dialog half the table answers wrong. Overlapping
the deck is the better trade: the deck is not going anywhere, and the panel is
gone in a few seconds.

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
real — and the hands themselves are listed in the **final standings**, under
the table, rather than crammed into the seat cards. The seat card used to grow
a list of everybody's cards the moment the game ended, which the portrait left
no room for; the standings window has always carried the same information and
has the space for it.

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

### What a colour means

Five, used the same way everywhere they appear — declared once as `--tAttack`,
`--tDefend`, `--tGain`, `--tBig` and `--tRoll` near the top of the stylesheet:

| | |
|---|---|
| **red** | something is being taken from somebody |
| **blue** | an answer — a Nope, a Defuse |
| **green** | a purchase, a payout, a card drawn |
| **gold** | the whole table should look up |
| **grey** | the dice, and everything else ordinary |

The log has coded its left edge this way for a long time and the words next to
it stayed grey, which is half a signal: you had to read the line to find out
whether the bar mattered. The words carry the colour now, and so does the
caption under a card turning over in the middle of the board — coded by what
the card *does* rather than by what it is called, so an Exploding Kitten and an
Attack read alike and a Feral Kitten does not read like either. That caption is
the one instant everybody at the table is definitely looking at the screen, and
it was 14px of plain grey.

Dialogs got the same treatment for a plainer reason: titles were the same
weight as the body text and the body text was dim on dim, so nothing on a popup
told you where to start reading. Titles are gold and heavier, explanation lines
are lighter and bigger, and the warning and confirmation boxes are bold in
their own colour.

### Advice, and turning it off

The one-line advice used to have a bar of its own across the bottom of the
window: 24 pixels of chrome, permanently, for a line that is empty most of the
time and never longer than a sentence. It sits in the header now, beside the
title, where it takes the width it needs and gives the board back the height.
**Tips** in the header turns it off for good, remembered between games —
somebody who has switched it off has decided they know how to play. The advice
sits as far right along the bar as it goes without touching the buttons, and
takes a line of its own on a screen narrow enough that the header wraps.

### Which way round the table

An arrow beside the buttons says whether play is going left or right through
the seats above. Nothing else on screen said so, and a **Reverse** turns it
over mid-game — you found out by watching whose turn came next, which is a
poor way to learn it an hour into a game where somebody has quietly reversed
twice. Hidden in a two-player game, where there is no direction to speak of.

### When a seven is rolled

Rolling a seven used to leave the bottom bar showing whatever it showed when
the dice were thrown — in the roll phase, the **Roll Dice** button, sitting
there through a seven, looking live and doing nothing at all when pressed. That
branch returned without a repaint; it repaints now, after the queue of who owes
exists, so the bar can say which it is: *finish the open window first* if the
roll caught you too, *waiting on the seven to be paid* if it did not.

**One way the window went missing.** Defusing a seven closed *every* forced
dialog on the table — this screen's and any shipped to another — and then
re-asked only if the head of the queue had changed. So a bystander Defusing
from the log while somebody else was part-way through counting out a big hand
took that player's window away and asked nobody for anything: a seven nobody is
being asked to pay, and a table that never moves again. The dialog is now only
closed when it is the defuser's own, which is only when they were the one being
asked. Everybody else keeps the pile they had counted out.

There is also a **watchdog** on it, because that was one path and there is no
reason to believe it was the only one. A seven is the one thing that stops the
table until it is paid, and the only one whose prompt going missing wedges the
whole game: the queue says who still owes, and nothing re-asks. A table that
can never move again is a far worse bug than whatever dropped the window. So
rather than trust that every path has been found, the game asks again —
`stepSeven` has always been safe to call twice, because the queue says what is
still *owed* rather than what has been *asked*.

The guard on it is deliberately the strongest available: it fires only when
there is no dialog anywhere on the table — no overlay on this screen, no panel,
nothing outstanding on anybody else's. In that state re-asking cannot interrupt
a soul, because there is nobody left to interrupt. It waits two quiet passes
rather than one, so a dialog in the act of being handed from one screen to
another is never mistaken for one that has gone.

### What a Nope reaches

A Nope dropped on a line of the log undoes that line, and everything after it.
Three cases are worth calling out:

- **A roll** is *thrown again*, and the turn carries on — **including after
  you have pressed End Turn**, as long as the hand-over window is still open.
  That window is the whole point: last call does not put the turn beyond
  answering, it starts the clock on it. But the reroll asked whether the roller
  was the *current* player, and after End Turn they are not, so Noping your own
  roll a second after leaving the table quietly handed play to the next player
  instead of throwing again. The turn goes back to whoever threw it now. The
  snapshots carry the board and not the clock, so who is up is the one thing
  that has to be put back by hand; everything else — skip tokens spent walking
  to the next seat, the turn record — was in the snapshot already. Anything
  else answered in that window is not treated the same way: their turn is
  genuinely over, and being Noped cannot end a turn twice. It does not end the
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
- **A whole turn** — the Nope's other use, dropped on whoever is playing
  rather than on a line — cancels what the turn *earned* AND hands back what
  it *took*. Those are two different things and only the first of them used to
  happen: Nope somebody's turn after they threw an Exploding Kitten and the
  victim's hand was still sitting in the bank, because the cancel only ever
  stripped the gains of the player being cancelled. The rewind point is the
  state the turn began in, so an exploded hand, a Favor, a robbery and the
  discards for a seven all come back, out of the bank the turn put them in.
  Two things are deliberately left alone: anything **un-Nopeable** draws a line
  under itself and the rewind lands just after it (the Imploding Kitten says in
  as many words that not even a cancelled turn undoes it), and a card somebody
  ELSE threw during the turn survives it — an Attack aimed at Green by Blue
  while Red is playing is Blue's doing, and neither of them is rewound.
- **A seven can also be Defused**, which is the cheaper answer: it buys one
  hand out of the cut and leaves the rest of the roll standing. The robber
  still moves and everybody else still pays. Anyone the seven is about to take
  from may spend it, **including whoever rolled it**. The roller used to be
  excluded, on the grounds that their own seven was theirs to wear — which in
  practice meant rolling a seven on a fat hand while holding both cards offered
  you exactly one of them, for a reason nothing on screen explained. Either
  answers it now: a Nope throws the dice again and costs you the number, a
  Defuse spares your hand alone and lets the rest of the seven stand.
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

### How the bots pick a road

Roads used to be steered by one target vertex: the best spot the bot could
eventually settle, and a road scored by whether it shortened the walk there.
Which works right up until that target is already reachable — and then every
candidate scores zero for progress, and the bot falls back on whichever road is
longest. That is where roads into dead ends came from, and why settlement
opportunities elsewhere on the board went unbuilt: with the one target in hand,
the rest of the board was invisible.

They now score against `reachValue` — *everything* still settleable and
reachable, each spot discounted by how many roads away it is. A road that opens
nothing raises it by nothing, so a dead end scores zero rather than scoring its
own length. Blocking has always been respected here and still is: the walk
cannot route through another player's road, nor through their buildings.

Longest Road is now worth **defending** as well as taking. The old test asked
only whether the bot was close enough to take it from somebody else, so a bot
holding a five-road run watched a rival build a six and did nothing about it —
there was no branch in which holding it mattered. It is measured against the
longest run anybody else actually has, rather than against the record on the
card, because the record does not move until somebody passes it.

The one weight worth knowing about is `W.roadOpens`, which is deliberately
small (2.2). `reachValue` sums the whole board rather than counting steps to
one target, so a good road opens twenty or thirty points of it; at any larger
weight that term buries Longest Road entirely, and the bot expands while its
lead evaporates.

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
