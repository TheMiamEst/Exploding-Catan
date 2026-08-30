/* ══════════════════════════════════════════════════════════════════════════
   EXPLODING CATAN — ONLINE PLAY
   ══════════════════════════════════════════════════════════════════════════
   Loaded as a classic script, like ai.js, so it shares the game's globals
   (S, hexes, vertices, edges, render, …) instead of importing anything.

   THE SHAPE OF IT
   One browser is the HOST. It runs the real game — the same code that runs
   when you play locally, bots and all. Every other browser is a TERMINAL: it
   never decides anything. It sends what you did ("I dropped card 2 on log
   entry 14") and draws the state the host sends back.

   That is deliberately the dumbest arrangement that works. The alternative —
   every client simulating from a shared seed — needs identical execution
   everywhere forever, and it puts every player's hand in every player's
   memory, which would gut the bluffing the whole Nope layer is built on.
   Here the host redacts: each seat is sent its own cards and nothing but
   placeholders for everyone else's.

   WHAT GOES OVER THE WIRE
     /rooms/CODE/meta            room settings, who is hosting
     /rooms/CODE/seats/{n}       roster: who is sitting where
     /rooms/CODE/pub             host → everyone: the log and the feed
     /rooms/CODE/view/{n}        host → that seat: the rest, redacted
     /rooms/CODE/intents         everyone → host: "this is what I did"

   The state is rewritten in full after every action rather than diffed. It
   cannot drift, and for six people taking turns the traffic is nothing — the
   private half is about 4KB a seat. The log and the feed are much the biggest
   part of it and are the same for everybody, so they go out once to a shared
   path instead of six near-identical times.

   HONEST LIMITS
     · The host can read the whole state in devtools. Fixing that needs a real
       server, not a browser. Pick a host you would lend money to.
     · If the host closes the tab, the game is over. Everyone else is told.
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I/O/0/1 to read aloud
const PUBLISH_DEBOUNCE = 60;      // ms — coalesce the burst of renders per action
/* The feed panel shows about fifteen lines at a time and scrolls. Forty gives
   a terminal some scrollback without dominating the traffic — feed HTML is by
   far the biggest thing on the wire, and the whole state is resent after every
   action rather than diffed. If it ever feels sluggish, the next step is to
   push feed lines to their own append-only path instead of resending them;
   they are immutable once written, so nothing else would have to change.
   S.log is deliberately NOT sent at all: it is written but never displayed. */
const FEED_KEEP = 40;
const PILE_KEEP = 60;      // how much of the discard pile travels
const JOURNAL_KEEP = 24;      // enough to judge the live entry and mark the feed

/* Inline handlers a shipped dialog is allowed to call back into. Anything the
   game puts on `window.__…` for its own modals goes here; nothing else can be
   invoked from another machine. */
const REMOTE_CALLS = ["__dc", "__fv", "__pickVictim", "__bGive", "__bGet",
                      "__deal", "__poolAdd", "__tof", "__twa"];

const NET = {
  on: false,
  role: null,            // "host" | "guest"
  code: null,
  seat: null,
  uid: null,
  name: null,
  db: null,
  room: null,            // firebase ref for /rooms/CODE
  roster: [],            // [{seat, name, bot}]
  started: false,
  dead: null,            // reason the session ended, if it did

  // host bookkeeping
  promptSeat: null,      // the seat a dialog being opened right now belongs to
  remote: {},            // seat -> {id, kind, key, buttons} of the dialog they hold
  remoteId: 0,
  pubTimer: null,

  // guest bookkeeping
  lastV: -1
};
window.NET = NET;

function online(){ return NET.on && !NET.dead; }
function isHost(){ return online() && NET.role === "host"; }
function isGuest(){ return online() && NET.role === "guest"; }

/* ══ plumbing ═══════════════════════════════════════════════════════════ */

/* The Firebase console hands you a block that begins `const firebaseConfig =`,
   and pasting it over the placeholder verbatim is the obvious thing to do — so
   both that name and the one the placeholder file used are accepted. */
function cfg(){
  if (typeof FIREBASE_CONFIG !== "undefined" && FIREBASE_CONFIG) return FIREBASE_CONFIG;
  if (typeof firebaseConfig !== "undefined" && firebaseConfig) return firebaseConfig;
  return null;
}

/* Why online play cannot start, in words, or null when it can. Worth being
   specific: "not set up" on its own sends you hunting through five things. */
function fbProblem(){
  if (typeof firebase === "undefined" || !firebase.apps)
    return "The Firebase scripts did not load — normally no internet, or the page " +
           "was opened straight off the disk with the network down.";
  const c = cfg();
  if (!c)
    return "<b>firebase-config.js</b> did not define a config. It needs to set " +
           "<b>firebaseConfig</b> to the block the Firebase console gave you.";
  if (!c.databaseURL)
    return "The config has no <b>databaseURL</b> line. That only appears once a " +
           "Realtime Database actually exists — <b>Build → Realtime Database → " +
           "Create Database</b> — so create it, then copy the config again.";
  if (/YOUR_/.test(c.databaseURL))
    return "<b>firebase-config.js</b> still has the placeholder values in it.";
  return null;
}

function fbReady(){ return !fbProblem(); }

function connect(){
  if (NET.db) return NET.db;
  if (!firebase.apps.length) firebase.initializeApp(cfg());
  NET.db = firebase.database();
  return NET.db;
}

/* Whatever was being played on this machine stops now. Without this a guest
   carried its local game's bots into the online session, and since a click
   handler on a terminal sends an intent rather than acting, those bots
   cheerfully played the guest's turns for them the moment one came round —
   which looks exactly like "the board does not respond". */
function dropLocalGame(){
  window.AGENTS = {};
  if (window.AI && window.AI.stop) window.AI.stop();
  if (typeof clearImplodeClock === "function") clearImplodeClock();
}

function randomCode(){
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function randomId(){ return Math.random().toString(36).slice(2, 10); }

/* Firebase drops keys whose value is undefined and turns sparse arrays into
   objects. Everything on the wire goes through here so neither surprises us
   at the far end. */
function clean(v){
  if (v === undefined || typeof v === "function") return null;
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(clean);
  const out = {};
  for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = clean(v[k]);
  return out;
}

/* An object that came back as {0:…,1:…} because it went out as a sparse or
   null-holed array. */
function arr(v, len){
  const out = [];
  for (let i = 0; i < len; i++) out.push(v ? (v[i] === undefined ? null : v[i]) : null);
  return out;
}

/* ══ the state blob ═════════════════════════════════════════════════════

   Board geometry is rebuilt from the player count on the far side — hex
   layout, vertices and edges are pure functions of the board size. Only what
   was dealt at random travels: terrain, numbers and ports. */

function serializeGame(){
  return {
    ver:      (typeof GAME_VERSION !== "undefined") ? GAME_VERSION : null,
    n:        S.players.length,
    terrain:  hexes.map(h => h.terrain),
    numbers:  hexes.map(h => h.number),
    vport:    vertices.map(v => v.port),
    eport:    edges.map(e => e.port),
    vOwner:   vertices.map(v => v.owner),
    vType:    vertices.map(v => v.type),
    eOwner:   edges.map(e => e.owner),

    players: S.players.map(p => ({
      name: p.name,                    // the host renames seats from the lobby
      avatar: p.avatar || null,        // and everybody picks their own face
      res: Object.assign({}, p.res), cards: p.cards.slice(),
      knights: p.knights, skipTokens: p.skipTokens,
      roads: p.roads, settlements: p.settlements, cities: p.cities
    })),

    bank: Object.assign({}, S.bank),
    robber: S.robber, cur: S.cur, dir: S.dir, phase: S.phase,
    turnCounter: S.turnCounter, rolled: S.rolled, rollId: S.rollId || 0,
    extraTurn: S.extraTurn, armed: S.armed, select: S.select,
    // A card played but not yet resolved. Travels so that it leaves the right
    // hand and turns over on every screen, rather than only on the host's.
    playing: S.playing || null,
    // The discard pile travels as its own record. It is not derived from the
    // journal any more, and a terminal is sent a shorter tail of the journal
    // than the pile needs, so it could not be rebuilt at the far end anyway.
    pile: (S.pile || []).slice(-PILE_KEEP),
    setupNeed: S.setupNeed,
    deckLen: S.deck.length, discardLen: S.discard.length,
    longestRoad: S.longestRoad, largestArmy: S.largestArmy, roadLens: S.roadLens,
    implodeTurn: S.implodeTurn, implodeBy: S.implodeBy,
    mode: S.mode || "normal",
    board: S.board || (BOARDSET === BOARD.large ? "large" : "small"),
    winPoints: S.winPoints || 10,
    turnSeconds: S.turnSeconds || 0,
    turnTimerRemaining: S.turnTimerPaused ? S.turnTimerRemaining
      : Math.max(0, ((S.turnTimerUntil || 0) - Date.now()) / 1000),
    turnTimerPaused: !!S.turnTimerPaused,
    // Who a seven is still waiting on. Sent because canDefuseEntry asks it:
    // without it, a terminal cannot tell that the roll on its screen is still
    // answerable and draws no Defuse marker on the line.
    seven: S.seven ? { actor: S.seven.actor, jid: S.seven.jid,
                       queue: S.seven.queue.slice() } : null,
    winner: S.winner, revealed: S.revealed,
    diceLog: S.diceLog.slice(-60),

    // The deadline travels as "milliseconds still to run", so nobody has to
    // trust anybody else's wall clock. Same for the gap between turns.
    implodeLeft: Math.max(0, (S.implodeUntil || 0) - Date.now()),
    // The lead-in travels the same way, so a terminal freezes for the reveal
    // exactly as long as the host does rather than starting its own clock the
    // moment the state lands.
    implodeLeadLeft: Math.max(0, (S.implodeFrom || 0) - Date.now()),
    handoverLeft: Math.max(0, (S.handoverUntil || 0) - Date.now()),
    handoverTurn: S.handoverTurn === undefined ? -1 : S.handoverTurn,

    // Snapshots stay home: they are big, and a terminal never rewinds
    // anything. `snap: 1` is the marker canNopeEntry actually tests.
    journal: S.journal.slice(-JOURNAL_KEEP).map(e => ({
      id: e.id, turn: e.turn, actor: e.actor, target: e.target, kind: e.kind,
      card: e.card ? { key: e.card.key, flavor: e.card.flavor || null } : null,
      payload: e.payload || null, nopeable: e.nopeable, noped: e.noped,
      // What was spent ANSWERING this entry. A Nope and a Defuse are
      // journalled as the answer rather than as a card play, so this is the
      // only record that they were cards at all - and the discard pile has to
      // show them like any other card somebody played.
      spent: e.spent ? { pid: e.spent.pid, key: e.spent.key } : null,
      cardOwner: e.cardOwner, participants: e.participants || null,
      noDefuse: !!e.noDefuse, notice: !!e.notice,
      show: e.show || null, plain: e.plain, snap: 1,
      // Somebody already spent a Defuse on this one. Travels so the marker
      // stops offering itself the moment it is settled, rather than letting a
      // second player drag a card the host is only going to turn away.
      answered: !!e.answered
    })),
    feed: (S.feed || []).slice(-FEED_KEEP),

    // Said and thrown. Public to the whole table by definition, so both ride
    // in the shared half with the feed rather than being copied per seat.
    // msgId travels with them because it is what tells a terminal which of
    // these it has already seen — the whole state is resent after every
    // action, so the same emote arrives over and over.
    chat: (S.chat || []).slice(-CHAT_KEEP),
    emotes: (S.emotes || []).slice(-EMOTE_KEEP),
    // Cards in flight. The same for every seat — a robbery travels face down
    // for everybody, including the two people who can see it in their own
    // hands — so it rides in the shared half too. Without this, only the
    // browser running the game ever watched anything move.
    fx: (S.fx || []).slice(-FX_KEEP),
    msgId: S.msgId || 0
  };
}

/* One seat's copy. Everyone else's hand becomes placeholders that keep the
   right length — every count in the UI reads `cards.length`, so nothing else
   has to know the difference. Once the game is over the hands are face up
   anyway and the real cards go out. */
function viewFor(blob, seat){
  const v = Object.assign({}, blob);
  v.players = blob.players.map((p, i) => {
    if (i === seat || blob.revealed) return p;
    const q = Object.assign({}, p);
    q.cards = p.cards.map(() => ({ key: "hidden", hidden: true }));
    return q;
  });
  v.fx = (blob.fx || []).map(f => {
    /* `!f.privatePid` was the test here, which is false for seat 0 — so every
       robbery by the player in the first seat travelled unredacted, private
       bundle and all, to everybody at the table. Ask whether the field is
       there, not whether it is truthy. */
    const owner = (f.privatePid === undefined || f.privatePid === null) ? null : f.privatePid;
    if (owner === null) return f;
    // The owner, and whoever it came off. A robbery is between two people and
    // both of them are entitled to know which card moved; the rest of the
    // table gets the count and a row of card backs.
    if (owner === seat || f.f === seat){
      const out = Object.assign({}, f);
      if (f.privateBundle) out.b = f.privateBundle;
      if (f.privateCard) out.c = f.privateCard;
      delete out.privateBundle;
      delete out.privateCard;
      return out;
    }
    // `p` rides along because a kitten draw is keyed by it and would otherwise
    // arrive with no idea whose hand it was going to.
    return { id:f.id, t:f.t, f:f.f, o:f.o, p:f.p, d:1, n:f.n };
  });
  v.seat = seat;
  v.roster = NET.roster;
  v.v = ++NET.pubVersion;
  return v;
}
NET.pubVersion = 0;

function applyGame(b){
  // Say so plainly when the host is running different code. Nearly every
  // "online is broken" report is one machine sitting on a cached build.
  if (typeof showVersionWarning === "function") showVersionWarning(b.ver);
  // A terminal never runs bots, whatever it was doing before it joined.
  if (isGuest() && window.AGENTS && Object.keys(window.AGENTS).length) dropLocalGame();
  if (!S || S.players.length !== b.n || S.board !== (b.board || (b.n >= 5 ? "large" : "small")))
    newGame(b.n, b.mode || "normal", b.board, b.winPoints, b.turnSeconds);

  const nh = hexes.length, nv = vertices.length, ne = edges.length;
  const terrain = arr(b.terrain, nh), numbers = arr(b.numbers, nh);
  hexes.forEach((h, i) => { h.terrain = terrain[i]; h.number = numbers[i]; });
  const vport = arr(b.vport, nv), vOwner = arr(b.vOwner, nv), vType = arr(b.vType, nv);
  vertices.forEach((v, i) => { v.port = vport[i]; v.owner = vOwner[i]; v.type = vType[i]; });
  const eport = arr(b.eport, ne), eOwner = arr(b.eOwner, ne);
  edges.forEach((e, i) => { e.port = eport[i]; e.owner = eOwner[i]; });

  const ps = arr(b.players, b.n);
  S.players.forEach((p, i) => {
    const q = ps[i]; if (!q) return;
    if (q.name) p.name = q.name;
    p.avatar = q.avatar || "";
    p.res = Object.assign({ wood:0, brick:0, sheep:0, wheat:0, ore:0 }, q.res);
    p.cards = arr(q.cards, (q.cards && q.cards.length) || 0).filter(Boolean);
    p.knights = q.knights || 0; p.skipTokens = q.skipTokens || 0;
    p.roads = q.roads || 0; p.settlements = q.settlements || 0; p.cities = q.cities || 0;
  });

  S.bank = Object.assign({}, b.bank);
  S.robber = b.robber; S.cur = b.cur; S.dir = b.dir; S.phase = b.phase;
  S.turnCounter = b.turnCounter; S.rolled = b.rolled || null; S.rollId = b.rollId || 0;
  S.extraTurn = b.extraTurn; S.armed = b.armed || null; S.select = b.select || null;
  S.playing = b.playing || null;
  S.pile = arr(b.pile, (b.pile && b.pile.length) || 0).filter(Boolean);
  S.setupNeed = b.setupNeed;
  S.longestRoad = b.longestRoad || { owner:null, len:0 };
  S.largestArmy = b.largestArmy || { owner:null, n:0 };
  S.roadLens = arr(b.roadLens, b.n).map(x => x || 0);
  S.implodeTurn = b.implodeTurn; S.implodeBy = b.implodeBy;
  S.mode = b.mode || "normal";
  S.board = b.board || (b.n >= 5 ? "large" : "small");
  S.winPoints = Math.min(20, Math.max(3, Number(b.winPoints) || 10));
  S.turnSeconds = Number.isInteger(Number(b.turnSeconds)) && Number(b.turnSeconds) >= 20 && Number(b.turnSeconds) <= 100
    ? Number(b.turnSeconds) : 0;
  S.turnTimerRemaining = Math.max(0, Number(b.turnTimerRemaining) || 0);
  S.turnTimerPaused = !!b.turnTimerPaused;
  S.turnTimerUntil = S.turnTimerPaused ? 0 : Date.now() + S.turnTimerRemaining * 1000;
  S.seven = b.seven
    ? { actor: b.seven.actor, jid: b.seven.jid,
        queue: arr(b.seven.queue, b.n).filter(x => x !== null && x !== undefined) }
    : null;
  S.winner = (b.winner === undefined) ? null : b.winner;
  S.revealed = !!b.revealed;
  S.diceLog = arr(b.diceLog, (b.diceLog && b.diceLog.length) || 0).filter(x => x !== null);

  // Deck and discard are only ever counted on a terminal, never looked at.
  S.deck    = new Array(b.deckLen    || 0).fill(null).map(() => ({ key:"hidden" }));
  S.discard = new Array(b.discardLen || 0).fill(null).map(() => ({ key:"hidden" }));

  S.implodeUntil = b.implodeLeft > 0 ? Date.now() + b.implodeLeft : 0;
  S.implodeFrom  = b.implodeLeadLeft > 0 ? Date.now() + b.implodeLeadLeft : 0;
  S.handoverUntil = b.handoverLeft > 0 ? Date.now() + b.handoverLeft : 0;
  S.handoverTurn = (b.handoverTurn === undefined) ? -1 : b.handoverTurn;
  if (typeof scheduleTurnTimer === "function") scheduleTurnTimer();

  S.journal = arr(b.journal, (b.journal && b.journal.length) || 0).filter(Boolean)
                .map(e => Object.assign({ payload:null, card:null }, e));
  S.feed = arr(b.feed, (b.feed && b.feed.length) || 0).filter(Boolean);
  S.chat = arr(b.chat, (b.chat && b.chat.length) || 0).filter(Boolean);
  S.emotes = arr(b.emotes, (b.emotes && b.emotes.length) || 0).filter(Boolean);
  S.fx = arr(b.fx, (b.fx && b.fx.length) || 0).filter(Boolean)
           .map(f => Object.assign({}, f, { src: f.src ? arr(f.src, f.src.length).filter(Boolean) : null }));
  S.msgId = b.msgId || 0;

  NET.roster = arr(b.roster, b.n).map((r, i) => r || { seat:i, name: PLAYER_NAMES[i], bot:true });

  drawFeedFromState();
  if (typeof drawChat === "function") drawChat();
  if (typeof mirrorClocks === "function") mirrorClocks();
}

/* The feed is DOM the host appends to as it goes; a terminal rebuilds it from
   the state each time, holding the scroll where the reader left it.

   Rebuilt only when it has actually CHANGED. The host publishes after every
   repaint, and a repaint is caused by all sorts of things that are nobody
   else's business — opening a trade panel, clicking a resource in it, even
   resizing the window. Each of those arrived at every terminal as a fresh
   state, and this threw away the whole log and built it again, replaying the
   entry animation on every line. So the log flickered on everybody else's
   screen whenever the host so much as dragged the corner of their window,
   which is a thing they could see and could not explain. */
function drawFeedFromState(){
  const box = document.getElementById("feed");
  if (!box) return;
  let h = "";
  for (const f of (S.feed || [])){
    h += '<div class="ev ' + (f.kind || "info") + '"' + (f.jid ? ' data-jid="' + f.jid + '"' : "") +
         '><span class="evturn">' + (f.turn ? "Turn " + f.turn : "Setup") + "</span>" + f.html + "</div>";
  }
  if (box.dataset.h === h) return;
  const following = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.dataset.h = h;
  box.innerHTML = h;
  if (following) box.scrollTop = box.scrollHeight;
}

/* ══ host: publishing ═══════════════════════════════════════════════════ */

function publish(){
  if (!isHost() || !NET.started) return;
  NET.pubTimer = null;
  const blob = clean(serializeGame());

  // The log and the feed are the same for everyone — they ARE the public
  // record — so they go out once rather than six near-identical times. They
  // are also most of the bytes, which is the practical reason.
  const pub = { journal: blob.journal, feed: blob.feed,
                chat: blob.chat, emotes: blob.emotes, msgId: blob.msgId };
  delete blob.journal;
  delete blob.feed;
  delete blob.chat;
  delete blob.emotes;
  delete blob.fx;

  const out = {};
  for (let s = 0; s < blob.n; s++) out[s] = clean(viewFor(blob, s));
  NET.room.update({ pub: pub, view: out });
}

NET.publishSoon = function(){
  if (!isHost() || !NET.started || NET.pubTimer) return;
  NET.pubTimer = setTimeout(publish, PUBLISH_DEBOUNCE);
};

/* ══ intents: terminal → host ═══════════════════════════════════════════ */

/* Returns true when the caller should stop: this machine does not decide
   anything, it just says what happened and waits to be told the result. */
NET.sendIntent = function(type, args){
  if (!isGuest()) return false;
  NET.room.child("intents").push(clean({
    seat: NET.seat, uid: NET.uid, type: type, args: args || [], t: Date.now()
  }));
  return true;
};

function handleIntent(m){
  if (!isHost() || !m || m.seat === undefined) return;
  const seat = m.seat, a = arr(m.args, (m.args && m.args.length) || 0);

  // Everything a terminal can ask for is either its own turn's business or a
  // reaction, which is legal at any time. Anything else is dropped rather
  // than trusted: a terminal is not an authority on whose turn it is.
  const mine = seat === S.cur;

  // Stand the host's own "is it my turn" guards down for the duration: every
  // click handler below is written for the person sitting in front of it.
  window.__netApplying = true;
  try {
  switch (m.type){
    case "roll":        if (mine) rollDice(); break;
    case "endTurn":     if (mine) requestEndTurn(); break;
    case "vertex":      if (mine || ownsSelect(seat)) vertexClick(a[0]); break;
    case "edge":        if (mine || ownsSelect(seat)) edgeClick(a[0]); break;
    case "hex":         if (mine || ownsSelect(seat)) hexClick(a[0]); break;
    // Choosing who a card is aimed at, by clicking their portrait. Guarded by
    // ownsSelect like the board clicks: the pick belongs to whoever played the
    // card, and nobody else may answer it for them.
    case "seat":        if (ownsSelect(seat)) seatClick(a[0]); break;
    case "buy":         if (mine){ NET.promptSeat = seat; buyKittenDialog(); } break;
    case "bankTrade":   if (mine){ NET.promptSeat = seat; bankTradeDialog(); } break;
    case "playerTrade": if (mine){ NET.promptSeat = seat; playerTradeDialog(); } break;
    case "drop":        applyRemoteDrop(seat, a[0], a[1], a[2]); break;
    case "modalBtn":    remoteModalButton(seat, a[0], a[1]); break;
    case "modalCall":   remoteModalCall(seat, a[0], a[1]); break;
    // Talking is not taking a turn: these three are legal from anybody at any
    // time, which is the whole point of them. Both pushes re-check what they
    // were handed — a message is escaped before it is drawn, and an emote has
    // to be one of the eighteen in the tray.
    case "chat":        pushChat(seat, a[0]); break;
    case "emote":       pushEmote(seat, a[0]); break;
    case "avatar":      setSeatAvatar(seat, a[0]); break;
  }
  } finally { window.__netApplying = false; }
  render();
}

function ownsSelect(seat){
  return !!S.select && (S.select.actor === undefined ? seat === S.cur : S.select.actor === seat);
}

/* A card drop, replayed against the host's own copy of that player's hand.
   The index is re-checked here rather than trusted, because the hand can
   change between the drag starting and the message landing. */
function applyRemoteDrop(seat, idx, kind, id){
  const p = S.players[seat];
  const card = p && p.cards[idx];
  if (!card) return;
  const info = { idx: idx, ownerId: seat, key: card.key, card: card };
  let drop = null;
  if (kind === "entry")  drop = { kind:"entry",  jid: id };
  // The pile carries the journal id of whatever card it was showing on the
  // guest's screen, so the host answers the same card they were looking at
  // rather than whatever happens to be on top by the time this lands.
  if (kind === "pile")   drop = { kind:"pile",   jid: id };
  if (kind === "player") drop = { kind:"player", pid: id };
  if (kind === "board")  drop = { kind:"board" };
  if (kind === "hand")   drop = { kind:"hand", owner: seat, overIdx: id };
  if (!drop || !dropAllowed(info, drop)) return;
  performDrop(info, drop);
}

/* ══ dialogs that belong to somebody else's screen ══════════════════════

   Rather than rewriting seven dialogs to be network-aware, the whole modal
   is shipped: title, body HTML and button labels go to the seat it belongs
   to, and that seat's clicks come back as the button index. The dialog's own
   inline handlers (the +/− counters and so on) come back the same way, so a
   dialog that redraws itself keeps working across the wire at the cost of one
   round trip per click. */

/* An untagged dialog stays on the screen that opened it. There used to be a
   fallback here — "nobody said whose this is, so give it to whoever already
   holds a modal" — meant for dialogs that redraw themselves. It also caught
   every unrelated dialog opened while somebody was mid-discard, which is how
   the dice history ended up on another player's screen and how the host's own
   Restart confirmation got posted to a guest and never came back. The dialogs
   that redraw now re-tag themselves instead. */
NET.takePromptSeat = function(){
  const s = NET.promptSeat;
  NET.promptSeat = null;
  return s;
};

function writePrompt(seat, payload){
  if (NET.room) NET.room.child("prompt/" + seat).set(clean(payload));
}
function dropPrompt(seat){
  delete NET.remote[seat];
  if (NET.room) NET.room.child("prompt/" + seat).remove();
}

/* Any player, anywhere, still owing an answer. The bots wait on this: a dialog
   shipped to somebody else leaves no overlay on the host's screen, so the DOM
   alone cannot tell. */
NET.anyPrompt = function(){
  for (const k in NET.remote) return true;
  return false;
};

NET.pendingSeats = function(){ return Object.keys(NET.remote).map(Number); };

/* Last resort. A player who closed their tab mid-dialog leaves an answer
   outstanding that will never arrive, and the bots wait on it forever. */
NET.clearAllPrompts = function(){
  if (!isHost()) return;
  for (const k of Object.keys(NET.remote)) dropPrompt(+k);
  if (typeof closeAllPanels === "function") closeAllPanels();
  if (typeof render === "function") render();
};

/* Called from openModal. Returns true when the dialog has been sent away and
   must not be drawn here. */
function btnSpec(buttons){
  return (buttons || []).map(b => ({ label: b.label, cls: b.cls || "", disabled: !!b.disabled }));
}

NET.shipModal = function(title, bodyHTML, buttons, mini){
  // Read it either way, so a tag left over from an offline game can never send
  // the first online dialog to the wrong person.
  const seat = NET.takePromptSeat();
  if (!isHost() || !NET.started) return false;
  if (seat === null || seat === undefined) return false;
  if (seat === NET.seat) return false;                 // it is the host's own
  if (!NET.roster[seat] || NET.roster[seat].bot) return false;   // a bot answers inline

  const id = ++NET.remoteId;
  NET.remote[seat] = { id: id, kind: "modal", key: null, buttons: buttons || [] };
  writePrompt(seat, { id: id, kind: "modal", title: title, body: bodyHTML,
                      buttons: btnSpec(buttons), mini: !!mini });
  return true;
};

/* A side panel for a seat that is not at this screen. Unlike a modal there can
   be one of these outstanding per seat at the same time, which is what lets a
   trade offer reach the whole table together. */
NET.shipPanel = function(key, seat, title, bodyHTML, buttons){
  if (!isHost() || !NET.started) return false;
  if (!NET.roster[seat] || NET.roster[seat].bot) return false;
  const id = ++NET.remoteId;
  NET.remote[seat] = { id: id, kind: "panel", key: key, buttons: buttons || [] };
  writePrompt(seat, { id: id, kind: "panel", key: key, title: title, body: bodyHTML,
                      buttons: btnSpec(buttons) });
  return true;
};

NET.clearPanel = function(key, seat){
  if (!isHost()) return;
  if (seat !== null && seat !== undefined){
    const r = NET.remote[seat];
    if (r && r.kind === "panel" && r.key === key) dropPrompt(seat);
    return;
  }
  for (const k in NET.remote)
    if (NET.remote[k].kind === "panel" && NET.remote[k].key === key) dropPrompt(+k);
};

NET.clearRemote = function(){
  if (!isHost()) return;
  for (const k in NET.remote) if (NET.remote[k].kind === "modal") dropPrompt(+k);
};

function remoteModalButton(seat, id, i){
  const r = NET.remote[seat];
  if (!r || r.id !== id) return;
  const b = r.buttons && r.buttons[i];
  if (!b || b.disabled) return;
  b.fn();
}

function remoteModalCall(seat, fn, args){
  if (!NET.remote[seat]) return;
  if (REMOTE_CALLS.indexOf(fn) < 0) return;            // nothing else is callable
  if (typeof window[fn] !== "function") return;
  window[fn].apply(null, arr(args, (args && args.length) || 0));
}

/* ── the terminal side of a shipped dialog ── */
/* Draw the dialog the host has handed this seat — as a modal if it demands an
   answer before anything else can happen, or as a side panel if it should
   leave the board and the log reachable. Passing null takes it away again. */
function showRemotePrompt(p){
  if (!p){
    if (NET.shownKind === "modal") dismissLocalModal();
    if (NET.shownKind === "panel") closePanel("remote");
    if (typeof forgetModalFold === "function") forgetModalFold();
    NET.shownPrompt = null; NET.shownKind = null;
    return;
  }
  if (NET.shownPrompt === p.id) return;
  NET.shownPrompt = p.id;

  // Shims so the dialog's own inline handlers reach the host instead of
  // looking for closures that only exist over there.
  for (const name of REMOTE_CALLS){
    window[name] = function(){
      NET.sendIntent("modalCall", [name, Array.prototype.slice.call(arguments)]);
    };
  }
  window.__mb = function(i){ NET.sendIntent("modalBtn", [p.id, i]); };

  const btns = arr(p.buttons, (p.buttons && p.buttons.length) || 0).filter(Boolean);

  if (p.kind === "panel"){
    if (NET.shownKind === "modal") dismissLocalModal();
    NET.shownKind = "panel";
    // Rebuilt locally rather than shipped as markup, so the buttons route back
    // through the same intent path a modal's do.
    panelBox["remote"] = { seat: NET.seat, title: p.title, body: p.body, rewindAt: S ? S.rewinds : 0,
      buttons: btns.map((b, i) => ({ label: b.label, cls: b.cls, disabled: b.disabled,
                                     fn: () => NET.sendIntent("modalBtn", [p.id, i]) })) };
    drawPanels();
    return;
  }

  if (NET.shownKind === "panel") closePanel("remote");
  NET.shownKind = "modal";
  let h = "";
  btns.forEach((b, i) => {
    h += '<button class="' + (b.cls || "") + '" ' + (b.disabled ? "disabled" : "") +
         ' onclick="window.__mb(' + i + ')">' + b.label + "</button>";
  });
  drawLocalModal(p.title, p.body, h, !!p.mini);
}

/* ══ lobby ══════════════════════════════════════════════════════════════ */

function seatRowsHTML(){
  let h = '<div class="rules" style="margin:8px 0 4px">Seats</div>';
  for (let i = 0; i < NET.roster.length; i++){
    const r = NET.roster[i] || {};
    const nm = r.name || PLAYER_NAMES[i];
    // Resolved against THIS browser's art folder: an id names a picture, not a
    // file, so somebody who has not got that file sees the initial instead of
    // a broken image. Nobody has to have the same art as anybody else.
    const src = (typeof avatarSrc === "function") ? avatarSrc(r.av) : null;
    h += '<div class="artrow">' +
         '<span class="avnow" style="width:26px;height:26px;border-width:2px;border-color:' +
           PLAYER_COLORS[i] + '">' +
           (src ? '<img src="' + src + '" alt="">'
                : '<span class="none" style="font-size:12px">' +
                  esc(initialOf(nm)) + '</span>') +
         '</span>' +
         '<span class="f">' + esc(nm) + (r.bot ? " (bot)" : "") +
         (i === NET.seat ? " ← you" : "") + "</span></div>";
  }
  return h;
}

/* Deal a fresh board to the people already sitting down. Used both by Start
   in the lobby and by Restart mid-game, so a table that wants another round
   never has to break up and swap a new room code around. */
function startTable(){
  closeModal();
  NET.started = true;
  NET.room.child("meta/started").set(true);
  NET.remote = {};
  NET.promptSeat = null;
  if (NET.room) NET.room.child("prompt").remove();
  if (typeof closeAllPanels === "function") closeAllPanels();
  window.AGENTS = {};
  // The opening the host chose in the lobby, the same one the local New Game
  // dialog sets. It travels with the state, so every terminal knows which
  // game it is watching.
    newGame(NET.roster.length,
      (typeof GAME_MODE !== "undefined") ? GAME_MODE : "normal",
      (typeof GAME_BOARD !== "undefined") ? GAME_BOARD : undefined,
      (typeof GAME_WIN_POINTS !== "undefined") ? GAME_WIN_POINTS : 10,
      (typeof GAME_TURN_SECONDS !== "undefined") ? GAME_TURN_SECONDS : 0);
  const bots = NET.roster.map((r, i) => r.bot ? i : -1).filter(i => i >= 0);
  if (bots.length && typeof window.AI !== "undefined"){
    const humans = NET.roster.map((r, i) => r.bot ? -1 : i).filter(i => i >= 0);
    window.AI.enable(humans);
  }
  S.players.forEach((p, i) => {
    const r = NET.roster[i];
    if (!r || r.bot) return;                  // bots keep the face newGame dealt them
    p.name = r.name;
    p.avatar = r.av || "";
  });
  beginSetupStep();
  publish();
}
NET.startTable = startTable;

function hostLobby(){
  const start = startTable;
  const refresh = () => {
    const body =
      '<p class="sub">Room code <b style="font-size:22px;letter-spacing:3px">' + NET.code + '</b>' +
      ' — read it out to your friends. They open the same page and press <b>Online → Join</b>.</p>' +
      seatRowsHTML() +
      '<div style="height:10px"></div>' +
      (typeof modePickerHTML === "function" ? modePickerHTML() : "") +
      '<div style="height:12px"></div>' +
      '<div style="margin:0 0 4px;color:var(--dim);font-size:11.5px">Board</div>' +
      '<div class="pick">' +
      ["small", "large"].map(key => '<button class="' +
        ((typeof GAME_BOARD !== "undefined" && GAME_BOARD === key) ? "primary" : "") +
        '" onclick="window.__board(\'' + key + '\')">' +
        (key === "small" ? "Normal board" : "Expansion board") + '</button>').join("") +
      '</div>' +
      '<div style="height:12px"></div>' +
      '<div style="margin:0 0 4px;color:var(--dim);font-size:11.5px">Points to win <b id="ngWinValue">' +
        (typeof GAME_WIN_POINTS !== "undefined" ? GAME_WIN_POINTS : 10) + '</b></div>' +
      '<input type="range" min="3" max="20" value="' +
        (typeof GAME_WIN_POINTS !== "undefined" ? GAME_WIN_POINTS : 10) +
        '" oninput="window.__win(this.value)" style="width:100%">' +
      '<div style="height:12px"></div>' +
      '<div style="margin:0 0 4px;color:var(--dim);font-size:11.5px">Turn timer <b id="ngTimerValue">' +
        ((typeof GAME_TURN_SECONDS !== "undefined" && GAME_TURN_SECONDS) ? GAME_TURN_SECONDS + " seconds" : "Off") + '</b></div>' +
      '<input type="range" min="0" max="9" step="1" value="' +
        (typeof timerSliderValue === "function" ? timerSliderValue(GAME_TURN_SECONDS || 0) : 0) +
        '" oninput="window.__timer(this.value)" style="width:100%">' +
      '<div class="okbox" style="margin-top:10px">Empty seats are played by bots. Start when everyone is in ' +
      '— the seating is fixed once the game begins.</div>' +
      '<div class="rules" style="margin-top:8px">You are the host: your browser is running the game, so ' +
      'leaving this page ends it for everyone.</div>';
    openModal("Hosting — " + NET.code, body, [
      { label:"Cancel", fn: () => { teardown(); closeModal(); backToIdle(); } },
      { label:"Start game", cls:"primary", fn: start }
    ]);
  };
  NET.onRoster = refresh;
  // The opening buttons redraw the lobby they live in rather than the New Game
  // dialog's, which is the only thing the two pickers do differently.
  window.__mode = function(key){
    if (typeof MODES !== "undefined" && MODES[key]) GAME_MODE = key;
    refresh();
  };
  window.__board = function(key){
    if (key === "small" || key === "large") GAME_BOARD = key;
    refresh();
  };
  window.__win = function(points){
    GAME_WIN_POINTS = Math.min(20, Math.max(3, Number(points) || 10));
    const out = document.getElementById("ngWinValue");
    if (out) out.textContent = GAME_WIN_POINTS;
  };
  window.__timer = function(position){
    const value = Math.min(9, Math.max(0, Math.round(Number(position))));
    GAME_TURN_SECONDS = value ? 20 + (value - 1) * 10 : 0;
    const out = document.getElementById("ngTimerValue");
    if (out) out.textContent = GAME_TURN_SECONDS ? GAME_TURN_SECONDS + " seconds" : "Off";
  };
  refresh();
}

function guestLobby(){
  const refresh = () => {
    if (NET.started) return;
    openModal("Joined " + NET.code,
      '<p class="sub">You are in. Waiting for the host to start.</p>' + seatRowsHTML(),
      [{ label:"Leave", fn: () => { teardown(); closeModal(); backToIdle(); } }]);
  };
  NET.onRoster = refresh;
  refresh();
}

function startHost(n, name, av){
  dropLocalGame();
  connect();
  NET.role = "host"; NET.on = true; NET.dead = null;
  NET.uid = randomId(); NET.name = name; NET.seat = 0; NET.code = randomCode();
  NET.room = NET.db.ref("rooms/" + NET.code);
  NET.roster = [];
  for (let i = 0; i < n; i++) NET.roster.push({ seat:i, name: PLAYER_NAMES[i], bot: i !== 0 });
  NET.roster[0] = { seat:0, name: name, bot:false, uid: NET.uid, av: av || "" };

  NET.room.set(clean({ meta: { host: NET.uid, n: n, started: false, at: Date.now() },
                       seats: NET.roster }));
  NET.room.onDisconnect().remove();

  // Somebody asking for a seat.
  NET.room.child("join").on("child_added", snap => {
    const j = snap.val(); snap.ref.remove();
    if (!j || NET.started) return;
    let seat = NET.roster.findIndex(r => r.uid === j.uid);
    if (seat < 0) seat = NET.roster.findIndex(r => r.bot);
    if (seat < 0) return;                                   // table is full
    NET.roster[seat] = { seat: seat, name: j.name || PLAYER_NAMES[seat], bot:false,
                         uid: j.uid, av: typeof j.av === "string" ? j.av.slice(0, 40) : "" };
    NET.room.child("seats").set(clean(NET.roster));
    if (NET.onRoster) NET.onRoster();
  });

  NET.room.child("intents").on("child_added", snap => {
    const m = snap.val(); snap.ref.remove();
    try { handleIntent(m); }
    catch (err){ console.error("intent failed:", err); }
  });

  hostLobby();
}

function startGuest(code, name, av){
  dropLocalGame();
  connect();
  NET.role = "guest"; NET.on = true; NET.dead = null;
  NET.uid = randomId(); NET.name = name; NET.code = code; NET.seat = null;
  NET.room = NET.db.ref("rooms/" + code);

  NET.room.child("meta").get().then(snap => {
    if (!snap.exists()){
      NET.on = false;
      openModal("No such room", '<p class="sub">Nothing is running under <b>' + esc(code) +
        '</b>. Check the code with whoever is hosting — it is case-insensitive but the ' +
        'letters matter.</p>', [{ label:"Back", cls:"primary", fn: onlineDialog }]);
      return;
    }
    NET.room.child("join").push(clean({ uid: NET.uid, name: name, av: av || "" }));

    NET.room.child("seats").on("value", s => {
      NET.roster = arr(s.val(), (s.val() || []).length) .filter(Boolean);
      const me = NET.roster.findIndex(r => r && r.uid === NET.uid);
      if (me >= 0) NET.seat = me;
      if (NET.onRoster) NET.onRoster();
    });
    NET.room.child("meta/started").on("value", s => {
      if (s.val()) NET.started = true;
    });
    // Two halves arriving separately: draw only once both are in hand, and
    // only when the private half is actually newer than what is on screen.
    const tryApply = () => {
      if (!NET.lastPub || !NET.lastView) return;
      if (NET.lastView.v === NET.lastV) return;
      NET.lastV = NET.lastView.v;
      NET.started = true;
      if (document.querySelector(".overlay") && NET.shownKind !== "modal") closeModal();
      applyGame(Object.assign({}, NET.lastView,
                { journal: NET.lastPub.journal, feed: NET.lastPub.feed,
                  chat: NET.lastPub.chat, emotes: NET.lastPub.emotes,
                  msgId: NET.lastPub.msgId }));
      render();
    };
    NET.room.child("pub").on("value", s => { NET.lastPub = s.val() || {}; tryApply(); });
    NET.room.child("view").on("value", s => {
      const all = s.val();
      if (!all || NET.seat === null) return;
      NET.lastView = all[NET.seat] || null;
      tryApply();
    });
    // One node per seat now, so several people can be holding a dialog at the
    // same time — which is what lets a trade offer reach everybody together.
    NET.room.child("prompt").on("value", s => {
      const all = s.val() || {};
      showRemotePrompt(NET.seat === null ? null : (all[NET.seat] || null));
    });
    NET.room.child("meta").on("value", s => {
      if (!s.exists() && NET.on) hostGone();
    });

    guestLobby();
  });
}

function hostGone(){
  NET.dead = "host left";
  openModal("The host left", '<p class="sub">The browser running the game has gone, so the game ' +
    'has gone with it. That is the trade for not needing a server.</p>',
    [{ label:"Close", cls:"primary", fn: () => { teardown(); closeModal(); backToIdle(); } }]);
}

function teardown(){
  if (NET.room){
    NET.room.off();
    if (NET.role === "host") NET.room.remove();
    else NET.room.child("view").off();
  }
  NET.on = false; NET.role = null; NET.started = false; NET.room = null;
  NET.seat = null; NET.dead = null; NET.onRoster = null; NET.shownPrompt = null;
  NET.shownKind = null; NET.remote = {}; NET.promptSeat = null;
  if (typeof closeAllPanels === "function") closeAllPanels();
}

/* ══ the Online button ══════════════════════════════════════════════════ */

window.onlineDialog = function(){
  const problem = fbProblem();
  if (problem){
    openModal("Online play is not ready",
      '<div class="warnbox">' + problem + '</div>' +
      '<p class="sub">Online play passes messages between browsers through a Firebase Realtime ' +
      'Database. It is free, and setting one up is a five minute job you only do once — ' +
      '<b>README.md</b> next to this file walks through it.</p>' +
      '<p class="rules">Until then the local game works exactly as before: you ' +
      'against the bots.</p>',
      [{ label:"Close", cls:"primary", fn: closeModal }]);
    return;
  }
  if (online()){
    openModal("Online — " + NET.code,
      '<p class="sub">You are ' + (isHost() ? "hosting" : "playing in") + ' room <b>' + NET.code +
      '</b> as <b>' + esc(NET.name) + '</b>' + (NET.seat !== null ? " in the " +
      PLAYER_NAMES[NET.seat] + " seat" : "") + '.</p>' + seatRowsHTML(),
      isHost()
        ? [{ label:"Stay", cls:"primary", fn: closeModal },
           { label: NET.anyPrompt() ? "Unstick (" + NET.pendingSeats().length + " waiting)" : "Unstick",
             fn: () => { NET.clearAllPrompts(); closeModal();
                         announce("⚠ Pending answers were cleared by the host", "info"); } },
           { label:"Restart with these players", fn: () => {
               openModal("Start another game?",
                 '<p class="sub">Same room, same seats, a brand new board. Whatever is on the ' +
                 'table now is gone.</p>',
                 [{ label:"Keep playing", fn: closeModal },
                  { label:"Deal a new board", cls:"warn", fn: startTable }]);
             } },
           { label:"Leave the game", cls:"warn", fn: () => { teardown(); closeModal(); backToIdle(); } }]
        : [{ label:"Stay", cls:"primary", fn: closeModal },
           { label:"Leave the game", cls:"warn", fn: () => { teardown(); closeModal(); backToIdle(); } }]);
    return;
  }

  const saved = (function(){ try { return localStorage.getItem("ec_name") || ""; } catch(e){ return ""; } })();

  // Typed so far, so that picking a picture — which redraws the dialog — does
  // not throw away a half-typed name or room code.
  let typedName = saved, typedCode = "";
  const readFields = () => {
    const n = document.getElementById("netName"), c = document.getElementById("netCode");
    if (n) typedName = n.value;
    if (c) typedCode = c.value;
  };
  const theName = () => (typedName || "Player").trim().slice(0, 14) || "Player";

  const refresh = function(){
    const body =
      '<p class="sub">One browser hosts and runs the game; everyone else joins with the room code. ' +
      'Up to six seats, and any seat nobody takes is played by a bot.</p>' +
      '<div class="counter" style="gap:10px"><span class="lbl">You</span>' +
      (typeof avatarNowHTML === "function" ? avatarNowHTML(MY_AVATAR) : "") +
      '<input id="netName" maxlength="14" value="' + esc(typedName) + '" placeholder="Josh" ' +
      'style="flex:1;background:#0004;border:1px solid var(--line);border-radius:5px;color:var(--ink);' +
      'padding:5px 8px;font:inherit"></div>' +
      (typeof avatarGridHTML === "function" ? avatarGridHTML(MY_AVATAR) : "") +
      '<div class="counter" style="margin-top:8px"><span class="lbl">Room code to join</span>' +
      '<input id="netCode" maxlength="4" placeholder="ABCD" value="' + esc(typedCode) + '" ' +
      'style="width:110px;background:#0004;border:1px solid var(--line);border-radius:5px;color:var(--ink);' +
      'padding:5px 8px;font:inherit;text-transform:uppercase;letter-spacing:3px"></div>' +
      '<div class="rules" style="margin-top:10px">To host instead, leave the code blank and pick how ' +
      'many seats the table has.</div>' +
      '<div class="pick" style="margin-top:6px">' +
      [2,3,4,5,6].map(n => '<button onclick="window.__hostN(' + n + ')">Host ' + n + ' seats</button>').join("") +
      "</div>";

    openModal("Play online", body, [
      { label:"Cancel", fn: closeModal },
      { label:"Join room", cls:"primary", fn: () => {
          readFields();
          const code = (typedCode || "").trim().toUpperCase();
          if (code.length !== 4){ hint("A room code is four letters."); return; }
          const name = theName();
          try { localStorage.setItem("ec_name", name); } catch(e){}
          closeModal();
          startGuest(code, name, MY_AVATAR);
        } }
    ]);
  };

  window.__avPick = function(id){ readFields(); setMyAvatar(id); refresh(); };

  window.__hostN = function(n){
    readFields();
    const name = theName();
    try { localStorage.setItem("ec_name", name); } catch(e){}
    closeModal();
    startHost(n, name, MY_AVATAR);
  };

  // The art folder is probed asynchronously, so a dialog opened in the first
  // moment can be showing an empty picker when the pictures land.
  window.__avRefresh = function(){ readFields(); refresh(); };
  refresh();
};

/* ══ hooks the game asks about ══════════════════════════════════════════ */

/* Get out of the room and go back to being a browser on its own. The local
   New Game dialog calls this before dealing: starting a bot game while still
   seated in a room left the host publishing to people who were no longer in
   the game it was publishing, and left a guest drawing whatever the host sent
   over the top of the table they had just dealt themselves. */
NET.leave = function(){
  if (!online()) return false;
  teardown();
  return true;
};

NET.isOnline   = online;
NET.isHost     = isHost;
NET.isGuest    = isGuest;
NET.mySeat     = function(){ return NET.seat; };
NET.applyGame  = applyGame;
NET.publishNow = publish;
/* Exposed for poking at from the console when something looks wrong on one
   screen and right on another: NET.viewFor(NET.serializeGame(), 2). */
NET.serializeGame = serializeGame;
NET.viewFor    = viewFor;
NET.clean      = clean;
/* Also exposed so a suspect intent can be replayed by hand against the host's
   own copy: NET.handleIntent({seat:1, type:"vertex", args:[42]}). */
NET.handleIntent = handleIntent;
NET.showRemotePrompt = showRemotePrompt;

})();
