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

### "The game randomly ended"

A local game lives in one variable in one tab and is written to nowhere. `S` is
assigned in exactly three places: its declaration, `newGame`, and `backToIdle`
— and `backToIdle` is only reachable from the online dialog's Leave and Cancel
buttons. **So an offline game has no code path back to the opening screen at
all.** Seeing that screen means the page loaded again.

Which is easier than it sounds: Ctrl-R, a swipe-back gesture, a middle-click on
the wrong thing, or the browser discarding a backgrounded tab to save memory
and reloading it when you come back. Any of them ended the game silently, with
nothing said and nothing kept, and from the chair it looks exactly like the
game randomly ending.

Two things now. A `beforeunload` guard asks before a game in progress is thrown
away, which is the only defence against the ones the player causes themselves.
And a breadcrumb in `localStorage`, refreshed every few seconds while a game
runs and cleared when one is finished or put away on purpose, so that the next
load can say **what happened** instead of pretending nothing did. It cannot
prevent a reload; it stops one being a mystery.

Neither of these saves the game. Doing that means serialising `S`, and the
journal's snapshots hold *references* to the same card objects the hands hold —
"refs, so identity survives" — which a round trip through JSON would quietly
break, and every rewind after it with them. Worth doing, not worth doing
carelessly.

## How online play actually works

### A host's wifi stutter used to end everybody's game

`NET.room.onDisconnect().remove()` is how a room cleans itself up when the host
closes the tab. It was set once at start-up and never thought about again, and
Firebase fires an onDisconnect on **any** connection loss — a wifi handover, a
laptop sleeping for a moment, a socket being cycled. So a two-second blip on
the host's machine deleted the whole room server-side, every guest's `meta`
listener saw it vanish, and they were all shown "the host left" and dropped
back to the opening screen.

The host saw nothing. Their game lives in their own tab and never noticed. That
is the shape of it: a game that "randomly ended" for one player and looked
perfectly fine to everybody else.

Worse, an onDisconnect is **consumed when it fires**. After the first blip the
room had no clean-up left on it at all, so a host who then genuinely did leave
abandoned it in the database for good.

Two halves to the fix. The host watches `.info/connected` and, every time the
connection comes back, rewrites `meta` and `seats` and **re-arms** the
onDisconnect — so a blip that deleted the room repairs it within a second, and
the room is still cleaned up when the host really goes. And a guest no longer
believes a vanished room straight away: it waits `HOST_GRACE_MS` for it to come
back, and only then says the host has left.

The cached `meta` the host rewrites carries `started` with it. Without that, a
reconnect mid-game would rewrite `started: false` and put every guest back in
the lobby of a game that was already running — the fix causing a worse version
of the bug it fixes.


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
on a hidden tab. Bursts are
capped — sixteen cards per event, sixty live pieces of animation, eight
flights kept on the state — so a six-player payout cannot bury the board or
the frame rate. A screen that has only just been handed a game in progress
catches up silently rather than replaying the last eight things that happened
at somebody who has just sat down.

The one place any of this touches what you can see of the game is the piece
held back while it lands, and that expires on its own: if the timer that ends
the animation never runs, the next repaint draws the piece anyway. A flourish
is not worth a board with a road missing from it.

### How much movement, and who decides

**Motion** in the header cycles three settings, remembered per machine.

| | what moves | what you still learn |
|---|---|---|
| **full** | cards cross the screen | everything |
| **calm** | nothing travels | everything |
| **off** | nothing at all | the reveals, the log, the board |

**calm** is the interesting one. A card fades up where it came from, holds,
fades down, is repositioned *while its opacity is nought at both ends of that
step* — so the one part of it that is movement is the one part nobody can see —
and fades up where it went. You are told both ends of every exchange with
nothing to track across the screen. The card reveals lose their spin and their
overshoot for a plain fade, and a piece appears where it was built instead of
dropping in and bouncing, but the ring still goes off around it so you can
still see at a glance *where* somebody just built.

This used to be one const, read once at load:

```js
const fxOn = !matchMedia("(prefers-reduced-motion: reduce)").matches;
```

which is the polite thing to do and was, in practice, the bug that cost two
people at a six-player table any idea what was going on. *Animation effects*
off in Windows' accessibility settings — a switch plenty of people flip to make
an older laptop feel quicker, and one that Battery Saver flips for them without
asking — makes that query match. Every resource flight, every card drawn, every
robbery, every trade and every hex flash then went: not slowed, not simplified,
**gone**, with nothing on screen to say why and no way back, because a const
cannot be reassigned even from the console. Their games worked and their boards
updated; they just never saw anything move, and nobody at the table could work
out what was different about their computers. It looked for all the world like
the online animation bug all over again, and it was not — it was two machines
quietly opting themselves out.

The mistake was filing this motion under decoration. It is not: it is how the
game says who took what from whom, which hex paid out, and where a card went,
and most of that appears nowhere else. Answering *"please, less movement"* with
*"then you get none of that"* is the wrong trade. So a system asking for
reduced motion now picks **calm** — the middle setting, and as far as the OS
gets to go on its own. Nobody is stuck: the button cycles, and it is a `let`
rather than a `const` precisely so it can change while a game is running.

The button says which of the three it is on rather than just being a switch,
which is the other half of the fix. The people who need it are the ones who did
not know there was anything to change, and a button reading **Motion: calm** on
one player's screen and **Motion: full** on everybody else's answers the
question before it has to be asked.

If somebody still sees nothing move, the remaining honest reason is a hidden
tab: a browser that considers the window not visible never paints a frame, so
the animations are dropped rather than queued up to replay against a board that
has moved on since.

### The discard pile, and playing without the log

The two piles stand one above the other down the right-hand side of the board,
clear of the dice: the **discard pile** on top, the **draw pile** under it.
Discard on top because that is the one you look at and the one you play onto;
the deck you only ever click. Both are card-sized rather than thumbnail-sized.

The discard pile is every kitten card anybody has played, face up, newest on
top. **It outlives the game**, along with the deck beside it: both used to be
swept off the moment somebody won, which is the exact moment anybody wants to
look back through them — a game that ends on a contested win is the one you most
want to be able to reconstruct. Nothing is written under it — what the card is, it says by being face up,
and who played it at whom is what the log is for. Scroll the wheel over it to
walk through it. **Scrolling up — the same gesture you would use to scroll up a
page — walks towards the bottom of the pile.** Scrolling down comes back to the
top card.

Stated as the gesture and the destination, with no word like "forward"
anywhere in it, because that word cost three goes at this one line in three
different directions.

The arrows that used to sit under the pile are gone, and good riddance: the up
arrow went to older cards and the down arrow to newer ones, so pressing "down"
climbed back towards the card you were already looking at and, at the top of
the pile, did nothing at all. The wheel always dug the right way; the furniture
around it was lying.

This exists because the game log had quietly become mandatory. A Nope was
played by dragging it onto a **line of the log** — which meant the log was not
a record of the game, it was a control surface, and a player who had closed it
or was not reading it could not use one of the eleven cards at all. The pile
puts the card you would have been looking for a line about on the table, face
up, where you can point at it. The log is back to being what it should be:
worth reading, never required.

**The pile keeps its own record** — `S.pile`, appended to as cards are played.

It used to be read off the journal, which knows who played what at whom and
looked like the obvious place for it. It is not, and a Nope is why: answering a
card rewinds the board by splicing the entry it answers off the journal, along
with everything after it. So the card that had just been played vanished off
the pile as though it had never been played at all. It had been. It was played,
it was cancelled, and it is lying face up on the table where everybody can see
it.

The pile and the journal now disagree in exactly one way, on purpose:

- the **answered card stays**, greyed, with `cancelled` stamped across it — it
  really was spent, and the code pushes it onto `S.discard` by hand;
- anything rewound **behind** the answer **leaves**, because `restoreAll` has
  just put those cards back in their owners' hands. A pile that still showed
  them would be describing cards that are no longer in it.

That is `pileCancel` and `pileDrop`. Everything that reaches the journal with a
card on it reaches the pile through `logAction`, which is the one place journal
entries are made — a played card, and a Nope or a Defuse, which are journalled
as the answer rather than as a play and so carry `spent` instead of `card`. The
Imploding Kitten is the one card that is neither: it fires straight out of the
deck and never belongs to anybody, so it is handed over explicitly as
`pileCard`.

The pile travels to terminals as its own list. It could not be rebuilt at the
far end even in principle — a terminal is sent a shorter tail of the journal
than the pile covers.

### What a Nope does now

**One use. It cancels a turn.**

It had two for a while — cancel the card on the pile, or cancel a whole turn —
and which one you got depended on whether the card underneath happened to still
be answerable. That made the same gesture mean two very different things at two
different moments. Worse, it did not even do the small one cleanly. Cancelling
a card rewinds the journal past that card, and *everything after it goes too*:
Nope somebody's Alter the Future and the kitten card they bought afterwards was
handed back to them, paid for twice, struck through in the log as though it had
never happened.

A card that can cancel a winning turn was never going to be worth spending on
one play anyway. So it takes the turn: drop it on the pile, the seats light up,
click whose. And nothing that turn did is handed back — everything it drew is
destroyed, everything it built comes down, an Alter the Future's swap goes back,
and nothing it spent is refunded. The same rules a cancelled win has always
used.

Two things a Nope still answers in place, because neither is a turn: **your own
roll**, which is thrown again, and **another Nope**, which is taken back. Noping
a Nope stays possible for as long as there are Nopes to go round.

The line, everywhere it appears, is now **"X's turn was Noped"**.

The Nope's badge is off the discard pile with the second use it existed to
signal. It was there to say which of the two a drop would take; there is only
one now. A Defuse keeps its badge, because a Defuse still answers one
particular card.

#### What a Defuse does

Unchanged.

When the card on the pile is one **you** can answer, the pile is marked the way
the log marks an answerable line: the card that would answer it pinned to the
corner, pulsing, plus the word **answer**. It appears only while you are
actually holding that card, so it still tells the rest of the table nothing.

The **Nope's** badge is the important one, and it is doing a different job here
than it does in the log. In the log it only ever said "this line is
answerable". On the pile it answers a much sharper question, because a Nope
dropped there cancels the **card** lying on the pile if that card can still be
answered, and goes after somebody's whole **turn** if it cannot. Those are
wildly different things to do with the card, and the badge is the only thing on
screen that says which one the drop is about to do. Badge showing: it takes the
card. No badge: it takes a turn.

**On a card** — dropped on the discard pile, or still on a log line if you
prefer — it cancels that card. The card is spent, what it was going to do does
not happen, and **the player carries on with the rest of their turn**.

Cancelling a card used to end the victim's turn outright. That made one Nope
the most punishing card in the game, made playing anything at all a risk you
thought twice about, and — worst of the three — meant a Nope had to be aimed at
exactly the right log line, because catching the wrong entry took somebody's
whole turn by accident.

**On a player** — dropped on their seat card — it cancels their whole turn, the
same way a win is cancelled. Everything they drew, built and played that turn
is gone. That is still available and is still brutal; it is now something you
choose deliberately rather than something that happens as a side effect of
answering a card.

**Knights and victory points are never touched by either**, unless the thing
being cancelled is a **win**. The guard used to let the hidden-points sweep
through whenever the player happened to be sitting on the target score, so
Noping the turn of somebody who had merely got there burned their whole hand of
Feral Kittens — and said so in the log, announcing cards nobody had any
business seeing. Cancelling a turn undoes that turn; it is not licence to reach
into a hand for something bought three turns ago. A knight played on the
cancelled turn is undone with everything else that turn did, which is a
different thing from taking the knight.

### Aiming a card after you have played it

Every kitten card is played by dropping it on the discard pile. **Neither the
board nor a seat card is a place to play one any more.** Knight, Alter the Future and Reverse
used to be dropped on the board while everything else was dropped on a player,
which meant knowing which of two gestures a card wanted before you could play
it — and nothing on screen said which. They all go to the pile, and the ones
that need a board answer ask for it afterwards, the same way the targeted ones
ask who they are for. One place to play a card, and one sentence that describes
where every card in the game goes.

For the ones that need a victim, the game stops — the turn clock pauses — and
the seats it could be aimed at **glow**. Click a face. That replaced a dialog
listing everybody's name as buttons, which had replaced dragging the card onto
somebody's seat card, and it is better than both: the dialog put a box over the
table naming players you were already looking at, and dragging was fine to use
and impossible to discover. Escape puts the card back and restarts the clock.

A **Nope** dropped on the pile does whichever of its two jobs is available. If
the card lying there can still be answered, it cancels that card. If it cannot
— nothing played, or the window shut — the seats light up instead and you pick
whose whole turn to cancel.

This is the way round it should always have been. Dragging a card onto
somebody's seat card means choosing the target **before** the card is played,
which is fine once you know the game and invisible until then: nothing on
screen says an Attack is a thing you aim, so a new player picks it up, finds
nowhere obvious to put it, and puts it back. Playing to the pile is one gesture
that works for all eleven cards, and the question arrives when it is actually a
question. Favor chains straight on into naming its three resources.

Aiming a card at a seat still works and is quicker. Nothing here takes that
away.

### Cards land where the cards are

Your own cards fly to your own hand — each resource to **its own pile**, kitten
cards to the hand beside them. A wheat card that lands on the wheat pile has
said which pile went up without anybody having to read a number.

**And the number does not move until the card gets there.** A counter that went
up the instant a card was dealt told you the answer while the animation was
still busy explaining the question, which made the card crossing the screen
decoration rather than news. Every counter now subtracts whatever is still in
the air on its way to that player, and each card clears its own hold at the
moment it visually lands. A kitten card is not in your hand until it is in your
hand — and it arrives face up, so the card you watched cross the screen is the
one that turns up among your cards.

**And it appears once.** The hold used to be taken inside the animation's own
callback, which runs a frame after the render that put the card there — so a
drawn card appeared among your cards, the browser painted it, and then it
vanished again when the hold finally landed, only to come back when the card
did. A payout was worse: the counters jumped to the full new figure and then
dropped to zero before climbing back one card at a time. The state was right
throughout and every number ended up correct, which is why this survived so
long; it just looked like the game could not make up its mind.

The plan for a flight is now worked out the moment the flight is first seen,
and its holds are placed there and then — measuring and moving are all that
wait for the next frame. `checkFlights` moved ahead of the drawing in
`render()` to match, so the hold is in place before a single counter is drawn.
Nothing is held back when nothing is going to fly, either: with motion off, or
on a screen nobody is watching, `fxWillPlay()` is false and the counters simply
tell the truth straight away rather than waiting out an animation that is not
coming.

That is a view and only a view: the state is correct the whole time, so the
worst a bug in there can do is show a wrong number for a second. Every hold is
cleared by a timer set when the hold is taken — nothing waits on an animation
finishing, or even on it having started — no count can be pushed below zero,
and the whole lot is dropped at the end of a turn. That last one matters
because timers are throttled to a crawl in a tab nobody is looking at, so
without it somebody who tabbed away mid-payout could come back to counters
reading low until the backlog caught up. Everybody else's still arrive at their seat card,
because a number about to change is all you can see of somebody else's hand
anyway. Watching a card you had just been given land on a counter above the
board, while the actual card appeared somewhere else entirely, never said
"this one is yours".

A kitten card you drew turns face up on the way into your hand. Nobody else
sees which one it was; the identity rides in a `privateCard` field that net.js
strips for every other seat, the same way a robbery's does — and the drawing
code reads `privateCard` as well as the projected field, because a game played
on one screen never goes through that projection and so had nothing to read.
The card came face down to the one person entitled to see it.

**Cards you lose leave from where you keep them.** A discard drops out of the
bottom bar, away from your hand; everybody else's drops out from under their
seat card as it always did. Your resources live in the bottom bar now, so a
discard of yours falling away beneath your portrait was leaving from a place it
had never been — and moving in the same direction as everything you gain, which
made losing cards look like a payout.

**A robbery is now face up at both ends of it.** It travels face down so the
table cannot read what was taken — but the person it was taken *from* is not
"the table". They were holding the card; they are entitled to see which one
left. Only they and the thief get the identity, which is exactly the two people
who would know at a real table.

That redaction had a hole in it, and it was seat-shaped:

```js
if (!f.privatePid) return f;      // seat 0 is falsy
```

Every robbery by the player in the **first seat** therefore fell straight
through the redaction and travelled to the whole table with its private bundle
intact, readable by anyone who opened devtools. It asks whether the field is
*there* now, rather than whether it is truthy.

### Nothing gets selected by dragging across the table

Nothing on the table is text. A drag that started on the board used to sweep a
blue selection across every hex, number and player name it crossed, which looks
broken and on some browsers eats the drag that was meant to be happening.
`user-select` is off for the page and back on for the places where words are
worth selecting: the log, the chat, dialogs and panels.

### One thing at a time

A card played turns over in the middle of the board for a couple of seconds.
The pile used to take it at the same instant, so the same card was in two
places at once and the quiet one in the corner was the one you noticed second
and believed first. **The pile now waits for the reveal to finish.** Entries
with no reveal of their own pass straight through.

**Bots wait too.** They move faster than anybody can read, and playing the next
card while the last one is still on screen stacked the reveals two and three
deep — at which point the queue drops the middle one and the table simply never
sees it. The driver holds while `showcaseBusy()`.

Two things make that safe rather than a new way to wedge the table:

- `showcaseBusy()` is **capped**. Every reveal ends on a timer, and a timer is
  exactly what does not fire in a browser tab nobody is looking at — so a
  backgrounded screen could otherwise have held its own game up for ever. Past
  the longest dwell in the game plus a wide margin, whatever is on screen stops
  being a reason to wait for it.
- `clearShowcase` **releases** whatever was queued. A reveal thrown away by a
  rewind or a new game was released by nobody, and its card never appeared on
  the pile at all — a permanent hole, one card wide.

### A card leaves your hand when you play it

Not when it finishes resolving. Alter the Future asks for two number tokens
before it can be journalled — which hexes are being swapped decides who is
allowed to Defuse it — so the card used to sit in your hand, with no reveal and
no acknowledgement of any kind, until after you had picked both. It read as
though the click had missed.

`S.playing` holds a card that has been played and is still waiting on
something. It leaves the hand at once, and turns over in the middle of the
board like any other play. It lives on the **state** rather than in a variable
because the person playing it may be at another screen entirely: online, the
drag happens on their machine and the play runs on the host's, so a
browser-local flag would have hidden the card from the wrong hand and shown the
reveal to the wrong person.

It can never outlive the pick it is waiting on. Anything that ends a pick
without going through its own callback — Escape, a rewind, a Nope landing
somewhere else — would otherwise leave a card out of its owner's hand for good,
so `render` clears it whenever no pick is open.

### A board card is shown before it changes the board

Alter the Future cannot be journalled until its two hexes are named — whether
anybody may Defuse it depends on which hexes are being swapped — so the reveal
that comes off the journal arrives at the very instant the numbers move.
Measured with a bot playing one, both happened in the same 100ms sample: the
swap IS what triggers the entry that draws the card. The one thing anybody
needed to watch, two numbers trading places, happened underneath the card
explaining it.

A bot's board card now sets the same `S.playing` marker a human's play sets on
its way to the pile. The card turns over at once, the bot driver waits on the
reveal before touching the board, and the swap then happens in the clear.

The reveal that *would* have come off the journal is skipped, because the card
has already had its moment and putting it back up would cover the very thing it
was announcing. Only for board cards: a targeted card changes nothing on the
board, so its second reveal covers nothing and is worth keeping — it is the one
that names the victim. Measured after the change: reveal at 105–2005ms, swap at
3105ms with nothing over the board, and the log still carries which two numbers
changed places.

The Knight was already right, as it turns out — it journals itself before
`beginRobberMove`, so the reveal was queued first and the driver's existing
wait held the robber back. Measured at 109–2711ms for the reveal and 3112ms for
the robber, with no overlap.

### The table goes quiet while you aim

Playing a card that needs a victim already stopped the clock. Now it dims the
board, the bottom bar and the header, and turns off pointer events on all
three — the card is already played, the only thing left is to say who it is
for, and a board you can still click is a board you can still misclick. The
seat cards stay bright and lift above it.

Only on the screen of whoever is choosing. Nobody else's game is interrupted by
a decision that is not theirs.

### A Defused robbery reads as cancelled

Every other action a Defuse or a Nope undoes is spliced out of the journal, and
the log strikes the line through for having vanished. A robbery is the
exception: it stays, marked `answered`, because everybody else standing on that
hex has to be able to see it is already settled. So it was the one cancelled
action that still read as though it stood — the robber had gone back and the
card had gone back, and the log said it happened. Struck through now, like the
rest.

A clock that is not running cannot be paused, either. The turn clock does not
start until the dice are thrown, so anything pausing it before the roll — a
Knight played first, which is an ordinary opening — was pausing nothing, and
writing `turnTimerRemaining = max(0, 0 - now) = 0` while it did. The next
resume then started a clock that had already expired, and the player was told
their turn had run out of time before it had begun. Both ends are guarded now:
nothing pauses a stopped clock, and nothing resumes one with nought left.

The clock stops for a Defused robbery, too. `finishRobber` has always resumed the clock and
nothing ever stopped it — an asymmetry that stayed hidden while the only robber
moves came from a seven, which pauses for its own reasons. A robbery Defused on
somebody else's turn handed the defuser a board decision with the current
player's clock running down behind it.

### Popups for the things that have no card

A seven gets a popup. A played card gets a popup. Three things that matter just
as much had nothing but a line in the log, and all three now turn over on every
screen:

- a **robbery**, which has no card of its own and is the most Defusable thing
  in the game;
- a **turn running out** on the clock, which is the one thing that happens
  because nobody did anything, and so had nothing to announce it;
- a **win being taken away** by the forced Nope — the biggest moment the game
  has.

The last two are journalled as **notices**: entries that say something happened
without anything having happened. That matters more than it sounds. Journal
entries are what `turnStartSnap` walks to find where a turn began, and it
treats an un-Nopeable entry as a line drawn under everything before it — so an
announcement about a cancelled turn, written just before the cancel, would have
wiped out the very snapshot the cancel was about to rewind to. `notice` entries
are skipped there. They carry no snapshot either, so they can never be answered.

### The opening screen is just the board

There used to be a card in the middle of the empty board carrying the game's
name, a line about what it is, and three buttons. All of that was already in
the header — New Game, Online and Rules are there, and so is the title — so it
was the same offer twice, and the second one had no styling of its own and
looked it.

It is **removed**, not hidden, along with both calls to the function that drew
it. `renderIdle` runs on every repaint of an empty table, so anything left
calling a function that no longer exists throws in there — and one exception in
`renderIdle` takes the whole opening screen down with it, header buttons and
all. Which looks from the outside exactly like *the New Game button stopped
working*.

Taking the card out also uncovered a real fault in the header behind it:
**Rules threw on the opening screen** and did nothing at all. It tags its dialog
with `promptFor(viewSeat())` so an online host ships it to the right seat, and
`viewSeat` reads `S.players` — but the rules are readable before anybody has
started a game, and there is no `S` then. It only tags when there is a game to
have seats in.

### Names, not dots

A player's name in the log is written in that player's own colour. It used to
be a coloured dot followed by a plain white name, which is two things where one
will do — the dot carried the colour and the name carried the name, so at a
glance down a busy log you were matching little circles rather than reading.
The name is the label, so the name is what is coloured. Weighted and shadowed
for the same reason the reveal captions are: a seat colour is chosen to sit
against the board, not to be read as a word on a dark panel.

### The Imploding Kitten used to lock its own player out

Drawing it froze the table for the length of the reveal — `uiBlocked` returns
true for everybody while the card is landing — and then never gave it back. The
board's clickable spots are worked out when the board is **drawn**, so the board
drawn during the freeze had nothing on it you could click, and nothing repainted
when the freeze ended: the implode clock updates its own banner by hand and
never asks for a repaint. The player who had just drawn the card was locked out
of their own turn until something else happened to cause one — picking a card up
and putting it down again did it, which is how this was found.

The clock now notices the moment it stops holding the table and repaints once.

### Being asked to answer

A seven gets a popup. A card being played gets a popup. The one thing that did
**not** was the thing you are actually being asked to react to — a robbery has
no card of its own to turn over, so moving the robber onto your wheat happened
in silence apart from a line in the log.

Anything you can still answer now holds up the card that would answer it, in
the middle of the board, with the word **answer** on it and a line saying what
to drop where. It is drawn for the seat at this keyboard and nobody else: it
only appears when YOU are holding the card, so it gives the rest of the table
nothing. The mark on the discard pile was doing this job alone and was too
quiet — the pile is a hundred pixels wide in the corner of the screen, and the
moment that matters is the two seconds after the robber lands.

### Three things on one peg

The chat, the emoji tray and now the **dice history** all hang off the bottom
of the button strip, in the same place, and only one of them is ever out —
opening any one puts the other two away. The log starts below whichever is
open, so nothing you were reading is covered by what somebody typed or by a
chart you asked for.

The dice history used to be a modal across the middle of the screen. That is a
lot of furniture for something you glance at, and it made the one thing it is
now good for impossible: keeping it **open beside the board while you play**,
which is worth doing now that the log is optional rather than the only way to
follow the game. Same chart, a third of the width, redrawn on every repaint and
compared before it is written — it changes twice a turn at most, and rebuilding
it on every repaint would be a layout each time for nothing.

### Whose turn it is, on their face

A ring turns around the portrait of whoever is playing, in their own colour.
It is the same signal every piece of software on earth uses to mean *this is
the one that is working*, it needs no key and no reading, and it is the second
thing (after the discard pile) that the game log used to be the only source of.

It survives a repaint, which is the whole trick. A CSS animation starts from
nothing the moment its element is created, so a ring inside markup that gets
replaced would snap back to twelve o'clock every time anything on the table
changed. `resumeSeatAnimations` sets a **negative `animation-delay`** after each
write, starting it part-way through instead — the same trick the emote bubbles
already used. The ring loops forever and so has no start of its own to measure
from; the clock modulo the period is as good an anchor as exists.

The emote bubbles had that delay written *into* their markup, which was fine on
its own and became a problem the moment the seat strip started comparing itself
before writing: how far a bubble has got changes every repaint, so the strip
would have looked different every time and rebuilt constantly. What travels in
the markup now is when the bubble **started**, which does not change.

### Nothing on the table reloads while you are looking at it

The seat strip and the bottom bar are compared before they are written, like
the log, the chat, the side panels and the dice already were.

The bottom bar is the one that mattered. **Your hand lives there**, and it was
being rebuilt from scratch on every repaint — which dropped whatever card you
were hovering, restarted the lift on the one you were about to play, and made
the art blink as the `<img>` elements were replaced. You could watch your own
hand reload every time anything happened anywhere on the table. Same story on
the seat strip: four portraits re-fetched for a repaint caused by somebody
else's road.

The turn clock is the one thing in the bar that changes on its own, and a
ticking second is not a reason to throw a hand away. So `turnTimerShell` writes
the clock's **shape** with nothing in it, the comparison never sees it change,
and `paintTurnTimer` writes the width and the number straight into it
afterwards — the same in-place update that stopped the clock eating clicks.

`renderIdle` blanks both elements directly rather than going through their draw
functions, so it clears their stored signatures too. Otherwise the first
repaint of the next game would be compared against markup that is no longer on
screen.

### The turn clock, and why it was eating clicks

The clock in the bottom bar repaints itself and nothing else. That sounds like
an optimisation and is actually a correctness fix.

It used to call `render()` on every tick, four times a second. `render()` is
not a touch-up: `drawBoard` replaces the board's markup wholesale with
`svg.innerHTML = h`, and `drawPlayers` and `drawBottom` do the same to the seat
cards and the bottom bar. So every clickable thing on screen was being
destroyed and rebuilt every 250ms, all game long.

A browser only fires `click` when the press and the release land on the same
element. Any click whose mousedown and mouseup straddled one of those
rebuilds produced **no click event at all** — the element it began on no longer
existed by the time the button came up. A comfortable click takes 80–150ms
against a 250ms rebuild cycle, which is why it presented the way it did: clicks
that sometimes just do not register, with no pattern you could pin down. It was
also republishing the whole game state to Firebase at 4Hz, because `render()`
ends with `NET.publishSoon`.

The clock is one span with a width and a number in it, so the tick writes those
two things. A full repaint is owed only when the clock **appears or
disappears**, because that changes the bar's layout — and that happens at turn
boundaries, not on every tick. Worth remembering for anything else that wants
to update on a timer: repainting the world to change a number costs you every
click that lands while you are doing it.

### What the seven's watchdog must not mistake for silence

The watchdog re-asks when a seven's prompt goes missing, because a table that
can never move again is worse than whatever dropped the window. It fires only
when there is no dialog open anywhere on the table — and a **bot** never opens
one.

A bot pays the instant it is asked and then holds for `AI_PACE` before the
queue moves on, so the table can see it pay. `AI_PACE` is 3000ms. The
watchdog's two quiet passes are 2 × 1500ms, which is also 3000ms. A dead heat,
settled by whichever timer the browser happened to fire first — and when the
watchdog won, it asked a bot that had already paid to pay again.

It only bit on big hands, and the reason is exact: a bot holding 16 discards
half and is left with 8, which is **still over the limit**, so it stays at the
head of the queue and can be asked a second time. A bot holding 10 discards 5,
drops under the line, and `stepSeven`'s own `while (totalRes <= 7) shift()`
clears it — the second ask finds nothing to do. Sixteen cards or more was the
threshold.

So a bot with an answer in flight now counts as somebody answering. It is a
**deadline rather than a flag** on purpose: a flag left set by a path that
never runs its clean-up would wedge the watchdog permanently, which is the
exact class of bug the watchdog exists to catch. A deadline expires on its own.

### The Imploding Kitten's twenty seconds start when the card lands

The reveal is the biggest thing this game puts on screen — the one card nobody
ever holds, spun up out of nothing over a full second and held for four more —
and the clock used to start underneath it. The turn it grants began with five
of its twenty seconds already spent watching an animation, on a turn that
cannot be Noped and that ends the moment the clock does. You were being charged
for the cutscene.

`S.implodeFrom` is when the twenty seconds actually begin; `S.implodeUntil` is
that plus twenty. Between the draw and `implodeFrom` the table is frozen:
`uiBlocked` returns true ahead of everything else it tests, including the proxy
exemption, because this one blocks everybody — the player whose card it is most
of all. The bots hold off on the same condition, and the banner holds at "20s
begins when the card lands" rather than counting down through the reveal.

The freeze length is read off the two constants that drive the animation
(`IMPLODE_SHOW_MS` and `SHOWCASE_FADE`) rather than typed again, so it cannot
drift out of step with the thing it is waiting for — and read at call time,
because both are declared further down the file than the function that wants
them. The lead-in travels to terminals as its own remaining-milliseconds field
alongside the deadline, so a guest freezes for exactly as long as the host does
instead of starting its own clock when the state lands.

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

**The number token takes the click.** Aiming at the number is what anybody does
first — for Alter the Future it IS the thing you are choosing — and it was the
one place on a hex that did not respond. The token is drawn after the hex it
sits on, so anything on it that accepts a click takes that click away from the
hex underneath; the blank disc already said `pointer-events="none"` but the
number and its pips never did, so the dead spot moved around depending on
whether you had token art. The whole token layer is deaf to the pointer now,
and clicks fall through to the hex.

**The robber stands on the number**, rather than off the hex's shoulder where it
used to sit. A hex is dead while the robber is there, and the clearest way to
say a number will not pay is to put something over the number — off to one
side you had to look twice to work out which hex it belonged to, which on a
crowded board is a look you take every roll. A ring of the token still shows
around it, so you can see there is a number under there without being able to
read it.

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

### The card reveal

A card turning over in the middle of the board is the one instant everybody at
the table is definitely looking at the screen, and its caption was 14px of
plain grey. It is 19px and bold now (21px for the Imploding Kitten, which is
the card nobody ever holds), and **the players' names in it wear their own
colours** — the same colour as their pieces on the board, the bar down their
seat card and the dot beside their name in the log.

Only the names. The box itself stays out of it: a caption tinted end to end by
what kind of card it was is a second colour scheme to learn, and the one that
was already there — one colour per player — says the more useful thing.

The caption is built from the journal's plain-text copy of the line, so the
markup naming anybody is long gone by then and the names have to be found again
and re-marked. Longest name first, so a player called Jo cannot eat half of
Josh, and escaped before matching so a name with an `&` in it is still found.

The **running log is deliberately untouched** by any of this: coloured left
edge, plain words. It is a log — something you scan and scroll back through —
and a wall of coloured sentences reads worse than a wall of grey ones.

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
- **A Nope**, which is the case that reads worst if nothing says so. Undoing a
  Nope puts back whatever that Nope cancelled — the snapshot a Nope is
  journalled against is the board as it stood with the original action
  resolved, so the rewind does it for free. What was missing was anybody
  saying it had happened. Played out, the log read: *Green Nopes Orange's
  Favor* · *Orange is Noped, their turn ends* · *Orange Nopes Green's Nope* ·
  *Orange gets their turn back*. Four lines, not one of them mentioning the
  Favor, which by then had quietly taken effect for the second time — the
  cards had moved and the table had no way of knowing. There is a line for it
  now: **↺ Orange plays Favor on White — stands after all**. A Defused card
  already said this, because replaying it announces itself; this is the same
  courtesy for a Nope.
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

### Noping a win is Noping the winning points

A cancelled win leaves the winner **under the target**. Not "denied for now",
not "they will need answering again" — under. One Nope, one denial, and the
winner has to earn it again from below the line.

That follows from something simple: crossing the target always takes a turn,
and cancelling that turn takes it back. The Feral Kittens go with it because a
hidden point in hand would put them straight back over.

Knights do not. There was a backstop here that stripped them when the rewind
had not been enough; it fired about once in fifty games and achieved nothing
the one time it did — a player propped up by buildings and Longest Road loses
no points at all when their knights go, so it took the cards, left the score
at eleven and moved on. The case it was covering is handled properly now (see
below), and the rule is the whole rule: **a cancelled win costs the turn and
every Feral Kitten, and nothing else.**

### Two assertions, and why both stay

**A cancelled win always leaves the winner under the target.** That is not a
hope, it is the rule following from the shape of the game: you can only win on
your own turn, so you were under the target when that turn began, so cancelling
the turn puts you back under it. The single crossing that happens on somebody
else's turn — a settlement cutting the road that was holding Longest Road
together — is answered the same way, by taking the turn that gave it away.

So a check on it can only fire when the code is wrong. It was briefly removed,
on the reasoning that the state it caught got resolved a moment later by
something else. That reasoning was bad: resolved-by-something-else is not the
same as right, and the check was in fact sitting on a live bug (below). It is
back, and it now prints the winner's whole breakdown so the next one is
diagnosable at a glance.

**No win is declared while somebody else still holds a Nope.** Asserted in
`declareWinner`, because that is where the unrecoverable thing happens — the
game is over and the card was never played. An imploded turn is the one
legitimate exception.

### `turnOpenSnap` is not `turnStartSnap`

Two questions that give the same answer on almost every turn, and different
answers on exactly the one that matters.

`turnStartSnap` answers *how far back may a cancel reach into what this turn
did to other people* — and an Imploding Kitten says in as many words that its
haul is never handed back, so the mark begins again after it.

`turnOpenSnap` answers *where did the turn open*. That is what the turn record
covers: the record is filled in from the first build of the turn whether a
Kitten lands later or not.

The bonus-card restore was hung off the first of those, and should always have
been the second. On a turn carrying an Imploding Kitten the buildings came off
from the record — the whole turn's worth — while Longest Road was judged from
the middle of the turn; and on a turn where the Kitten came *last*,
`turnStartSnap` is null and the restore did not happen at all. Which put the
sticky-incumbent bug straight back for that one case: Blue and White both on
7-road chains, Orange settles in the middle of Blue's, White takes Longest Road
and crosses to 11 on Orange's turn, the Nope pulls Orange's settlement off — and
White keeps the bonus on the restored 7-7 tie, still on 11, and wins with the
Nope spent. A Kitten cannot move either bonus, so reading straight past it is
both safe and the only reading that matches what has just been undone.

### A Nope cancels the turn that is being played

Always that turn — not the winner's turn, when those are different.

You can cross the target on somebody else's turn. Their settlement cuts the
road that was holding Longest Road together, the bonus falls to you, and you
are on ten without having done a thing. The cancel used to rewind *the
winner's* turn, which in that situation meant rewinding nothing: "there is no
turn of theirs to undo" was true, and the wrong conclusion. The winner stayed
exactly where they stood, so the next Nope was demanded, and the next, until
the table had none left and the win landed anyway — every card at the table
spent to delay it by one check each. Which is the complaint this whole rule was
written to answer, arriving by a different road.

The turn being played is the turn that caused it, so that is the turn that
comes off. Undoing it puts the cut road back together and Longest Road with it,
and the winner drops back under the target for the same reason anybody does:
the thing that gave them the points has been un-done.

### Two mobile fixes, behind a width gate

Every rule below exists for a small screen, and **nothing outside a media query
was changed to make room for them**. That is not tidiness, it is the lesson: a
first version put the height rule and the Fullscreen button in the base sheet,
where they applied to every screen. The button widened the header enough to
wrap it onto a second row on a narrower laptop, which shortens the board area;
`height:100dvh` re-measures the whole column against a number that is only
interesting on a phone. Between them the deck and the discard pile ended up
below the fold in the middle of a real game, on a laptop, with friends.

The gate is **width**, not a guess about the device — a touch laptop is still a
laptop. Above 900px the layout is the one it always was, and that is checked
rather than assumed: every computed layout property of html, body, header,
stage, boardArea, bottom, piles, deckWrap, discardWrap, panels and feed is
compared against the pre-mobile build at 1920x1080, 1366x660 and 960x600, and
they match exactly.

Full mobile support means rethinking the whole layout, which is not what these
are. These are the two things that stop a phone being usable at all.

**Full screen.** A phone browser spends a third of a small screen on its own
address bar. There is now a Fullscreen button in the header, which hides itself
where the API does not exist rather than offering something that does nothing,
and says so if the request is refused — a button that appears broken is worse
than one that explains itself.

iPhone Safari does not implement the Fullscreen API at all (iPad does), so the
route there is Share -> Add to Home Screen, which the
`apple-mobile-web-app-capable` meta turns into a chromeless launch.

Three things help even without going full screen. `100dvh` is the height the
window actually has: `100%` is measured against the viewport with the address
bar scrolled away, so a fixed full-height layout was taller than the window
from the moment it loaded and the hand sat behind the browser's furniture.
`viewport-fit=cover` plus safe-area insets let the page reach under the notch
without putting anything readable there — repeated in the narrow and short
media queries, which trim the padding right back and were taking the insets
with them. And `overscroll-behavior:none` stops pull-to-refresh, so dragging a
card downwards no longer reloads the page, which on a local game is the game
gone.

**Trade windows.** Measured on a 384px screen: the panel column was 167px wide
and the trade window inside it was 423px tall in a 406px column. Cut off at
both ends — and the only thing that could scroll was the column *behind* the
panel, which is `pointer-events:none` so that an empty column never eats a
click, so a finger laid on the panel had nothing to drag. Cut off and
unscrollable, exactly as reported.

On a narrow screen the column stops being a column and gives the panel the
width of the screen, and the panel scrolls **inside itself** — the half that
matters, because the thing under your finger is then the thing that moves. The
same window is now 347px of a 384px screen, fits top to bottom, and scrolls
when it has to.

One thing found on the way: the existing `max-width:900px` rule for `#panels`
had never applied. The base `#panels` rule sits further down the sheet, so at
equal specificity it won. The new block is placed after it.

### An empty chair, and anybody may sit in it

Somebody leaving mid-game used to end the game without ending it. Their profile
stayed on screen, their turn came round, and nothing happened — an empty human
seat never rolls, and the turn clock does not start until somebody does. Play
reached that seat and stopped there for good.

A seat is now one of three things: a bot nobody has ever sat in, a person who
is here, and a person who has gone. The first and last are both empty chairs,
and **anybody with the room code takes either**. That is what makes one door do
both jobs — joining a game and coming back to it are the same act, and the only
difference is that a returning player is offered their own chair first if it is
still free.

**A bot picks up an abandoned seat**, which is the part that unsticks the game.
The seat keeps its hand, its colour and its pieces; the bot plays them until
somebody takes the chair, and hands straight back when they do. One agent is
added and removed rather than rebuilding the set, which would throw away every
other bot's state mid-game.

Mid-game arrivals used to be refused on the grounds that a seat holds a hand
and a colour, and handing that to a stranger would be handing them somebody
else's game. True, but the wrong side of the trade: the alternative was a seat
nobody could fill and a game that could not go on. A hand somebody walked away
from is worth less than a table that keeps playing. The feed says who sat down.

Two things had to learn that "not a bot" no longer means "somebody is there".
Dealing a new board counted an away seat as a player, so the next game stopped
at that seat the same way the last one did. And prompts were still shipped to
empty chairs — a dialog nobody will ever answer, which is the same dead-lock
arriving through the prompt instead of through the turn.

One more, found by testing: the host's lobby dialog reopens whenever the seats
change, and seats now change *during* a game. So the room dialog appeared over
the top of a game in progress — and because an open modal is an answer the
table is waiting for, the bots stopped dead and the game froze behind it. The
guest lobby had always guarded against this; the host's never needed to until
now.

### Leaving and coming back

Leaving a lobby used to cost you your seat for good, and the table with it.

A guest's uid was a fresh random on every join. The host matches a rejoin to a
seat by uid, so a brand new uid matched nothing — and the seat you had was
still marked taken, under your old id and your name, so it was never offered to
anybody else either. The table sat one player short and the only way back in
was a whole new room.

Three things fix it, and they are three different ways of leaving:

**You are remembered.** The uid lives in `localStorage`, so the same browser
comes back as the same person and drops straight into its own seat. The host
keeps a random one: a host leaving takes the room with it, so there is nothing
to come back to — and a random id means a host and a guest in two tabs of the
same browser cannot collide over it.

**Saying so frees the seat.** Every exit a guest has goes through `teardown`,
so that is where it says goodbye. In the lobby the host hands the seat back to
the table and anybody may take it.

**Not saying so frees it too.** The Leave button is the tidy way out; closed
tabs, flat batteries and walking out of range are most of the real ones. A
`present/{uid}` node the server removes on the guest's behalf covers those,
re-armed on every reconnect for the same reason the host's is — an
`onDisconnect` fires once and is then spent.

**Mid-game the seat is kept, not freed.** Once the cards are dealt a seat holds
a hand, a colour and pieces on the board. Handing that to a stranger would be
handing them somebody else's game, so a running table takes no new faces — but
it always takes back a face it knows. Rejoin from the browser you were playing
on and your seat is exactly as you left it; the host publishes the whole state,
so it makes no difference how long you were away.

And a guest nobody seats no longer sits in "waiting for the host to start"
forever. The host turns a request down by ignoring it, so after a few seconds
the guest says what it can see for itself: the table is full, or the game has
already started and you are not in it.

### The pile shows the card that was played

When somebody answers with a card, that card is what they played — and the
thing it answered is already sitting on the pile with a line drawn through it.

`entryCardKey` read `card` before `spent`, and those two disagree on exactly
one entry in the game. A Defused Alter the Future keeps the Alter on `card`,
which is what lets a third player whose hexes are being swapped still answer
the new swap. The pile read that as a second Alter being played, so a Defused
Alter showed as **a cancelled Alter with a fresh Alter on top of it** — instead
of a cancelled Alter under the Defuse that actually happened.

`spent` first. Flavour follows the card that is really going down, so the
Defuse is not labelled with the Alter's. Nothing else moved: the Defuse entry
still carries the Alter, so the answer chain is untouched — a third player on
those hexes can still Defuse the new swap, and anybody can still Nope it.

### What the pile SHOWS and what the pile ANSWERS

A card still turning over in the middle of the board is deliberately kept off
the discard pile until its reveal finishes — cards appear on the pile once
their moment is over, which is how it was asked for and how it should stay.

That is a rule about drawing. It was also, by accident, the rule deciding what
a card dropped on the pile answers: both `dropTargetAt` and `markDropTargets`
asked the pile what it was currently showing. So for the two or three seconds a
card is on screen — exactly the seconds you are looking at it and reaching for
an answer — the pile was still offering the card underneath it.

Three things broke in that window, all of them at the only moment they matter:

* **A Defuse could not answer the Exploding Kitten being shown to you.** The
  pile was offering the card beneath, which you had no business Defusing, so
  the drop was refused outright.
* **A Nope on the Defuse that had just bounced that Kitten back at you** was
  refused on your own turn.
* **On somebody else's turn the same Nope quietly became a turn-cancel.** The
  drop fell through to "cancel whoever is playing", the card was spent, a turn
  was taken — and your hand was still gone. Which is the report: *exploded
  someone, they defused it, I played a nope, and I still left with my hand
  exploded.*

`discardDropRec` answers the second question separately. The drop reads the
whole pile including whatever has not finished arriving; the pile still draws
only what has. `markDropTargets` uses the same record, so the outline and the
drop can never disagree about what is being answered.

### The clock belongs to the turn, not to the wall

Blue Nopes Red's turn. Blue's own turn then ends instantly, and play jumps to
Orange. The log reads:

```
Red's turn was Noped by Blue.
Red's turn was Noped - nothing to lose.
Blue's turn timer expires.
```

`doEndTurn` cleared the clock and `advancePlayer` did not, which was fine for
as long as `doEndTurn` was the only way to reach `advancePlayer`. `cancelTurn`
calls it directly, so a Noped turn handed its live deadline straight to whoever
was next — already expired — and their first tick ran it out. Clearing it in
`advancePlayer` covers every route in, including ones not written yet.

A second bug sat underneath it: a deadline of **zero** means *not started*, the
clock does not begin until the dice are thrown — but the expiry test is
`until > now`, which a zero fails. Any stray tick between one turn ending and
the next player rolling read the absence of a clock as a clock that had run out.

### Held, not paused

The clock counts only while the game is waiting for the player whose turn it
is, on a screen somebody is looking at. Everything else holds it: a hidden tab,
an answer owed, a dialog open anywhere at the table, an Imploding Kitten still
landing, or somebody sitting on the target while the table decides what to do
about it.

**Held, not paused.** A pause is state something has to remember to undo, and
the ones that get forgotten are exactly the ones on the rare paths — a win
being argued over being the obvious one. The hold is asked fresh every tick and
needs no clean-up: the deadline slides along in front of it, so however long it
lasts the player still gets every second they were owed, and when the reason
goes the clock simply carries on.

**Trading does not hold it.** The first version of the hold borrowed
`humanPromptOpen()`, which is the *bots'* test — and that one counts trade
panels, because a trade offer left hanging stops a bot dead and it has to wait
the offer out. It is the wrong test for a clock. Buying kitten cards, trading
with the bank and offering a trade are all things you choose to do with your
own turn, and choosing to do them should not stop your turn running out. From
the chair it read as the timer pausing at random, because nothing about a trade
window says "the game is waiting".

A modal is the opposite. Nobody opens one on purpose — a discard owed to a
seven, a forced Nope, a robber handed to whoever Defused it — and until it is
answered the game genuinely cannot move. Those still hold, wherever at the
table they are, including a dialog shipped to somebody else's screen that
leaves no overlay on this one. The bots keep their own test, unchanged.

Backgrounded tabs are the same question asked differently. Browsers cut
background timers to about one a second and suspend them outright on mobile, so
a tick arriving much later than it was scheduled did not happen at the table.
The excess is handed back rather than spent — a turn cannot run out while
nobody is looking at it.

A turn handed back by a counter-Nope gets a fresh clock rather than none, since
`advancePlayer` stopped the old one and the snapshots carry the board rather
than the clock.

### An imploded turn is untouchable

Nothing reaches an imploded turn. Not a Nope, not an Exploding Kitten, not an
Attack, not anything. The only thing that ends it is its own twenty seconds.

The Nope had been blocked in three separate places — the turn cancel, the seat
pick, the journal — and every one of them was written as though the Nope were
the only card that could reach across a turn. It is not. `OFF_TURN` holds three
cards, and the other two are the Exploding Kitten and the Attack. Neither goes
anywhere near those three checks: both come through `canPlayToPile`, and
`canPlayToPile` had never heard of the Imploding Kitten. So the one turn in the
game that is supposed to be untouchable could be ended by throwing a bomb at it.

The rule now sits at the gate every off-turn play has to pass, rather than card
by card: while the implode is running, the player having the turn is the only
player who may do anything. Their own cards are unaffected — it is their turn.

Two other places needed it. The hand no longer lights those cards up as
playable, so the refusal is silent rather than a card that offers itself and
then declines; and a targeted pick that was already in the air when the Kitten
landed is dropped, because letting it complete would be the same interruption
arriving by a slower route.

### A Nope you could not play

An Exploding Kitten, an Attack and a Nope are all playable **off-turn** — that
is what `OFF_TURN` is for. So all three can be thrown at you while *you* are the
one having a turn.

And then a Nope had nowhere to go. Both gestures that answer a card — dropping
it on the discard pile, dropping it on the log line — routed through
`canNopeTurnNow`, which asks whether there is somebody else's turn to cancel.
On your own turn there is not, so both refused. The entry was answerable the
whole time (`canNopeFor` said yes); there was simply no way to say so. The one
thing still reachable was Noping your own roll, which is the only entry that
never went through a turn, and that is what people actually resorted to.

**When you Nope somebody else, you end their turn. When you Nope something
aimed at you and there is no turn to end, you cancel the card.** The second
half is not new machinery — `nopeEntry` has done exactly that since it was
written, *"the card is cancelled, the turn is not"*. It was only ever reachable
for a roll and for another Nope.

So `nopeCancelsCard` now decides which of the two a Nope means, and the pile,
the log line and the bots all ask it. Taking a turn stays the answer whenever
there is a turn to take, because taking Blue's turn cancels the Exploding
Kitten Blue threw at you along with everything else Blue did — the bigger
answer is still on the table, and it is still what the gesture means.

The bots had the identical hole. Their routing tested `e.actor === S.cur`,
which is false for an attack thrown at them during their own turn, so the
branch fell through to "do nothing": a bot holding a Nope, wanting to spend it,
allowed to spend it, with nowhere to put it. They ask the same question now.

### Nobody but the host ever saw a card move

The host publishes in two halves. The log, the feed, the chat and the emotes
are identical for every seat, so they go out once in `pub` and are merged back
in on arrival; everything that differs per seat goes out through `viewFor`.

`fx` — the list of cards in flight — was deleted from the blob alongside those
four, as though it were the same kind of thing. But it was never added to `pub`,
so it went out nowhere at all. Every seat's view carried an empty flight list,
and `viewFor`'s careful per-seat redaction of it had been running against
`undefined` since the day it was written.

It cannot join the shared half either. A robbery names the card it took, and
that must reach exactly two people: the thief and the person robbed. Everyone
else is entitled to a count and a row of backs, and to nothing more — the
private fields are stripped rather than hidden, so there is nothing to read in
devtools. That decision can only be made per seat, so `fx` stays in the blob
and goes out redacted with the rest of it.

What survived was everything a screen can animate on its own: your own cards
arriving in your own hand, off your own state. What was missing was everything
that needed the host to say it happened — kitten cards off the deck, resources
flying to somebody else's seat, trades crossing between two players. Which is
exactly the shape of the report: *own resource animations, yes; dev cards and
other people's, no.*

Eight flights of a few short keys each, six times over, is nothing next to
being able to see the game.

### A bot always answers the Nope that took its win

Every time, ahead of everything else, without weighing anything.

A bot spends a Nope for one of two reasons: somebody has visibly reached the
target, or this hand is the win and the card would take it away. Neither of
them can see a cancelled win. By the time the answer is being considered the
cancel has already put the bot back under the target, so "is anybody about to
win" says no and "does this hand hold the win" says no — and the bot sat on a
Nope while the game it had just won was handed back to the table.

The entry now carries a mark saying whose win it took, which is the only thing
that identifies it after the fact. A Nope kept through your own cancelled win
is a Nope that will never be worth more than it was at that moment, so there is
no judgement to make.

It is looked for across every answerable entry rather than only the newest:
being cancelled hands the turn on, and whoever picks it up may have journalled
something newer by the time the bot gets to think about it.

### The win gets a moment of its own

A win taken away had the whole middle of the board — a trophy, held for three
and a half seconds, on every screen. The win itself had a line in the log and a
dialog straight over the top of everything.

Both are the same trophy, so they had to stop looking the same: a denial is the
dark disc with a gold rim, a win is that disc filled in, lit, and a size up.
The longest dwell in the game, and never dropped from the queue.

It is journalled rather than announced, which is the difference between the
host seeing it and everybody seeing it — `announce()` draws on the screen it is
called from, and `declareWinner` only ever runs on the host, so the biggest
moment in the game was the one moment a guest never saw. The final standings
now wait for the trophy to clear before opening, capped at ten seconds so a
showcase that never finishes cannot mean a dialog that never opens.

### A rewind judges the bonus cards from where the turn started

Longest Road and Largest Army are sticky on purpose — the holder keeps them on
a tie, and a challenger has to strictly beat them. That is right while a game
is being played and wrong immediately after a rewind, because the holder it
protects may be the player whose turn is being cancelled. It defends the very
thing the Nope is taking away.

Which is how a Noped win still won. Red held Longest Road at 10. White built a
road to 11, took it, and hit the target. The Nope pulled the road back off the
board, leaving both on 10 — and the recompute, seeing White as the incumbent,
gave the tie to White. White kept the two points, kept ten, and won on the next
check with the Nope already spent.

The rewind now puts the bonus holders back where the turn found them before
recomputing, so the tie is judged from where the turn started. Red is the
incumbent again, White's 10 does not beat it, and the bonus stays where it was
before the road that has just been destroyed. The recompute still runs
afterwards, because the turn may have broken somebody else's road with a
settlement, and that settlement is coming down too.

**The one exception is the Imploding Kitten.** A win on an imploded turn cannot
be Noped, because nothing about an imploded turn can be. That is the only way a
game ends with Nopes still in hands.

### No win lands while somebody else holds a Nope

One question decides it: **is there a Nope at this table that is not the
winner's own?** If there is, the win does not land. If there is not, it does.

There used to be a second question in front of that one — *would cancelling
the turn actually take them back under the target?* — and if the answer was no,
the win was declared without anybody being asked. It was well meant. A Nope
spent on a win it cannot deny is a card thrown away, and that was a real
complaint. But it reads the card backwards: a Nope does not have to reduce
anybody's score to be worth playing. It denies the win **this time**, and the
winner has to come back and do it again. A six-player game ended with three
bots each holding one while a fourth was handed the game on the grounds that
their Nopes would not have helped.

So every Nope at the table is one more turn the winner has to survive, and the
game ends when the last one is gone. A cancelled win is now genuinely cancelled
— `cancelTurn` used to notice the rewind had failed to move the score and hand
over the game on the spot, which turned each of those Nopes into a card spent
on a win granted in the same breath. There is no silent win to head off:
`checkVictory` finds them again the moment anything happens and demands the
next Nope.

The winner's own Nope is not counted, because `forcedNoperFor` skips them.
Holding the last one yourself wins you the game — and having spent yours
answering somebody else is exactly how you end up in that position.

### A win can be argued over until the Nopes run out

Three things were wrong with a contested win, and together they produced a game
where a player reached the target, every Nope at the table was taken off the
people holding them one at a time, and the win stood anyway.

**A forced Nope could not be answered.** It spent the card by hand and called
`cancelTurn` directly, journalling only a *notice* — so it was the one card in
the game nothing could be played back at, and a win denied by one was denied
for good. It goes through `nopeWholeTurn` now, exactly as a voluntary turn-Nope
does, which journals a **nopeable** entry. Nope the forced Nope and the win
comes back; the next player holding one is then made to answer that, and so on.

**Nothing carried the argument on.** Undoing the cancel restored the winning
position, but nobody asked the question again, so a restored win just sat
there. `nopeEntry` re-checks victory after undoing any answer. It terminates
because every round of it spends a card: `forcedNoperFor` eventually finds
nobody and the win is declared.

**And nobody should be charged for an answer that was never available.** A Nope
on a win cancels the winner's *turn*. If their points do not come from that
turn — buildings and bonuses standing since earlier, which a cancel may not
touch — then cancelling denies nothing. `checkVictory` asks first now, and
`stripWinningPoints` asks the same question before destroying a single Feral
Kitten.

That question is answered by **doing it**: `winSurvivesCancel` rewinds the turn,
takes the Ferals, reads the score, and puts everything back. `snapAll` covers
every last thing `wipeNopedTurn` touches, and a `quietRun` counter keeps the
trial out of the log and the feed while it runs. The alternative was to work the
same sum out on paper — this turn's buildings and knights, and then Longest Road
and Largest Army recomputed from what is left — which is a second
implementation of the rules to keep in step with the first.

### The cascade eats a card it was never given

Reported from a real game: three Nopes in hand, a win to answer, two Nopes
played each way, and the answerer came out holding **none** instead of one. The
win went through against a card that had been in his hand when the argument
started.

Answering an entry rewinds to the snapshot that entry was journalled against,
and then charges the answered card again by hand — `spent` says who paid.
That second charge is there because the rewind is supposed to **predate** the
payment: without it the answered Nope would be handed back to its owner for
free. Every answer in the game journals its snapshot first and pays afterwards,
so that holds — except `nopeWholeTurn`, which paid first. Its snapshot
therefore restored a hand with the Nope already gone, and the re-charge reached
past the gap and took a **second** one, which left the game without ever being
played.

Invisible to anybody holding a single Nope, because then there is nothing else
to take. It needs two in one hand, which is why it survived until an end-game
cascade.

Two changes, because one of them alone would only have fixed today's case:

- `nopeWholeTurn` takes its snapshot **before** spending, like everything else.
- The re-charge names the card. `spendCard` returns what it took, the entry
  records that card's id alongside the kind, and answering charges **that
  card** or nothing at all. "Any Nope in that hand" is only the same card if
  the rewind really did put the original back; naming it makes a second charge
  unrepresentable, and says so in the console if a snapshot is ever taken late
  again. Entries from an older build carry no id and still fall back to the
  kind.

Measured on the reported cascade, three Nopes each, six counter-Nopes deep:
`3,3 -> 2,3 -> 2,2 -> 1,2 -> 1,1 -> 0,1 -> 0,0`, one card to the discard per
Nope played, none lost. Before: `3,3 -> 2,3 -> 1,2 -> 1,2 -> 0,1 -> 0,1 -> 1,0`.
With the old snapshot deliberately put back, the arithmetic now stays right
anyway and the console names the offending entry.

### When a bot spends a Nope

Two reasons, and no others: **to cancel a win**, or **to protect a hand that is
about to win**.

It used to have an opinion about nearly everything — a big hand about to be
halved, an Attack it would rather not wear, an Alter aimed at a hex it was
settled on, anybody buying a card while ahead. Each is defensible on its own,
and together they meant the bots burned every Nope they drew within a turn or
two of drawing it. So there was never a Nope in a bot's hand at the moment
somebody actually won, which is the one moment the card exists for. Holding it
is a move.

"About to win" is `publicVP`, not `totalVP`: a hidden Feral Kitten is not
something a bot may look at. An actual declared win is caught by the forced
Nope instead, which is a rule of the game rather than a decision.

"A hand that is about to win" is `vpNearest(p) === 0` — no resources missing
from the nearest scoring build — and one point short of the target, since a
settlement and a city upgrade are each worth exactly one. Its own hand and its
own hidden points are the one thing a bot is entitled to see.

The same rule governs the seven: a Defuse still goes on any cut worth
answering, because it costs the table nothing else, but the Nope is kept.

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
