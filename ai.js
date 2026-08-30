/* ══════════════════════════════════════════════════════════════════════════
   EXPLODING CATAN — BOT OPPONENTS
   ══════════════════════════════════════════════════════════════════════════
   Loaded as a classic script (NOT an ES module — module scripts are CORS
   checked and will not load over file://, which would break double-click).

   Structure:
     W          tunable weights — the vector self-play tuning will optimise
     eval       position evaluation (placement, expansion, threat)
     policy     what to do with a turn
     cards      kitten-card strategy, including the Nope layer
     agent      the object the game asks for decisions
     botTick    the driver that walks a bot through its turn

   FAIRNESS: the bot reads only what a player at the table can see — piece
   positions, resource COUNTS, played knights, public VP. It never inspects
   the composition of another hand or the contents of the deck. `AI.fair`
   is asserted by AI.selfCheck() so this cannot rot silently.
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

/* ── tunable weights ──────────────────────────────────────────────────── */
const W = {
  pip:            1.00,   // value of one pip of production
  diversity:      2.60,   // per distinct resource at a spot — see note below
  portSpecific:   1.30,
  portGeneric:    1.10,
  ore:            1.15,   // cities win games
  wheat:          1.20,   // cities and kitten cards
  sheep:          0.85,
  wood:           0.95,
  brick:          1.00,
  expansionDecay: 0.55,   // value of a spot n roads away
  cityBias:       1.35,   // prefer upgrading over sprawling
  cardBias:       1.00,
  hoardPenalty:   0.45,   // discourage sitting on >7 cards with a 7 looming
  leaderWeight:   1.00,   // how hard to punish the leader
  vpValue:       12.0,    // what one victory point is worth in plan scoring
  cardValue:      4.0,    // a kitten card is a lottery ticket next to a build
  needPenalty:    1.20,   // how much each still-missing resource discounts a plan
  nopeHoldVP:     8,      // start holding Nopes once someone hits this VP
  baitVP:         8,      // once we hit this, bait out enemy Nopes early
  handLimit:      7,      // spend down below this — a 7 halves anything above it
  closeToVP:      1,      // "very close" = this many resources short of a build
  cardPushVP:     5,      // from here on, kitten cards are worth chasing hard
  cardPushMult:   2.8,    // how much more a card is worth in that band
  roadReachMax:   3,      // never build toward a spot further away than this
  roadOpens:      2.2,    // per point of settle-value a road opens up. Small
                          // because reachValue sums the WHOLE board rather
                          // than counting steps to one target: a good road
                          // opens twenty or thirty points of it, and at any
                          // larger weight this term buries Longest Road.
  handHardCap:    9,      // above this, spend no matter what else is pending
  sevenAnswerCut: 5       // cards a seven must be about to take before a Nope
                          // or a Defuse is worth spending on it
};

/* Why diversity is weighted higher than in base Catan: a kitten card costs
   ANY 3 DIFFERENT resources. A player touching all five resources can buy a
   card almost every turn, which in this variant is the strongest engine in
   the game. Narrow ore/wheat boards are correspondingly weaker than they
   would be in vanilla. */

const RESW = { wood:"wood", brick:"brick", sheep:"sheep", wheat:"wheat", ore:"ore" };
function resWeight(t){ return W[t] !== undefined ? W[t] : 1; }
function pips(n){ return n === null || n === undefined ? 0 : 6 - Math.abs(7 - n); }

/* ══════════════════════════════════════════════════════════════════════════
   EVALUATION
   ══════════════════════════════════════════════════════════════════════════ */

/* Production value of a vertex, plus a bonus for how many DIFFERENT
   resources it touches. */
function vertexValue(vid){
  const v = vertices[vid];
  let score = 0;
  const kinds = {};
  for (const hid of v.hexes){
    const h = hexes[hid];
    if (h.terrain === "desert") continue;
    const p = pips(h.number);
    score += p * W.pip * resWeight(h.terrain);
    kinds[h.terrain] = (kinds[h.terrain] || 0) + p;
  }
  score += Object.keys(kinds).length * W.diversity;
  if (v.port === "3:1") score += W.portGeneric;
  else if (v.port) score += W.portSpecific * (kinds[v.port] ? 1.6 : 0.5);
  return score;
}

/* What a player already produces, in pips per resource. */
function production(pid){
  const out = { wood:0, brick:0, sheep:0, wheat:0, ore:0 };
  for (const v of vertices){
    if (v.owner !== pid) continue;
    const mult = v.type === "city" ? 2 : 1;
    for (const hid of v.hexes){
      const h = hexes[hid];
      if (h.terrain === "desert") continue;
      out[h.terrain] += pips(h.number) * mult;
    }
  }
  return out;
}

/* A spot is worth more when it covers resources we are short of. */
function vertexValueFor(vid, pid){
  let score = vertexValue(vid);
  const have = production(pid);
  const v = vertices[vid];
  for (const hid of v.hexes){
    const h = hexes[hid];
    if (h.terrain === "desert") continue;
    if (have[h.terrain] === 0) score += W.diversity * 1.4;   // brand-new resource
  }
  return score;
}

/* How threatening is this player? Public information only: visible VP, plus
   an estimate of hidden Feral Kittens from how many cards they hold. */
function threat(q){
  const hiddenGuess = q.cards.length * 0.35;
  return (publicVP(q) + hiddenGuess) * 10
       + totalRes(q) * 0.30
       + q.knights * 0.8
       + q.cards.length * 0.5;
}
function leaderId(exceptId){
  let best = null, bs = -1e9;
  for (const q of S.players){
    if (q.id === exceptId) continue;
    const t = threat(q);
    if (t > bs){ bs = t; best = q.id; }
  }
  return best;
}

/* Breadth-first walk out from a player's road network, so we can tell how
   far away the good open spots are. Opponent buildings block the path. */
function expansionMap(pid){
  const dist = {};
  const q = [];
  for (const e of edges){
    if (e.owner !== pid) continue;
    for (const vid of e.v) if (dist[vid] === undefined){ dist[vid] = 0; q.push(vid); }
  }
  for (const v of vertices){
    if (v.owner === pid && dist[v.id] === undefined){ dist[v.id] = 0; q.push(v.id); }
  }
  while (q.length){
    const at = q.shift();
    const v = vertices[at];
    if (v.owner !== null && v.owner !== pid) continue;     // cannot route through
    for (const eid of v.edges){
      const e = edges[eid];
      if (e.owner !== null && e.owner !== pid) continue;
      const other = e.v[0] === at ? e.v[1] : e.v[0];
      if (dist[other] === undefined){ dist[other] = dist[at] + 1; q.push(other); }
    }
  }
  return dist;
}

/* What the board is still worth to us: EVERY spot we could still settle,
   discounted by how many roads away it is.

   The road picker used to steer by bestExpansion alone — one target vertex,
   and a road scored by whether it shortened the walk to that one spot. Which
   works right up until the target is already reachable, and then every
   candidate scores zero for progress and the bot falls back to picking
   whichever road is longest. That is the "roads into dead ends while the
   settlement spots were somewhere else" of it: with the single target in
   hand, the rest of the board was invisible.

   Summed over everything reachable, a road that opens nothing raises this by
   nothing — so a dead end scores zero instead of scoring its own length. */
function reachValue(pid){
  const dist = expansionMap(pid);
  let total = 0;
  for (const v of vertices){
    const d = dist[v.id];
    if (d === undefined || d > W.roadReachMax) continue;
    if (!canPlaceSettlement(v.id, pid, true)) continue;    // legal ignoring roads
    total += vertexValueFor(v.id, pid) * Math.pow(W.expansionDecay, d);
  }
  return total;
}

/* Does this road lead anywhere at all? Judged at its far end: somewhere to
   build, or somewhere to carry on building towards. A road that answers no to
   both runs into a wall — the board's edge, or the back of somebody else's
   settlement, which nothing may route through. Call with the edge already
   simulated as ours. */
function roadGoesSomewhere(eid, pid){
  const e = edges[eid];
  for (const vid of e.v){
    const v = vertices[vid];
    if (v.owner !== null && v.owner !== pid) continue;     // blocked at this end
    if (v.owner === null && canPlaceSettlement(vid, pid, true)) return true;
    for (const nid of v.edges){
      if (nid === eid) continue;
      if (edges[nid].owner === null) return true;          // still somewhere to go
    }
  }
  return false;
}

/* Best place we could eventually settle, and how many roads away it is. */
function bestExpansion(pid){
  const dist = expansionMap(pid);
  let best = null;
  for (const v of vertices){
    const d = dist[v.id];
    if (d === undefined || d > 4) continue;
    if (!canPlaceSettlement(v.id, pid, true)) continue;    // legal ignoring roads
    const score = vertexValueFor(v.id, pid) * Math.pow(W.expansionDecay, d);
    if (!best || score > best.score) best = { vid: v.id, dist: d, score };
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════
   RESOURCE PLANNING
   ══════════════════════════════════════════════════════════════════════════ */

function shortfall(p, cost){
  const need = {};
  let total = 0;
  for (const r in cost){
    const miss = Math.max(0, cost[r] - p.res[r]);
    if (miss){ need[r] = miss; total += miss; }
  }
  return { need, total };
}

/* What is this bot saving for right now?

   An earlier version asked "is a city legal?" first — which is true whenever
   you own any settlement, so the bot spent every game hoarding ore and wheat
   and never expanded. Instead score each option by what it is worth against
   how many resources we still have to find, and take the most efficient. A
   city we cannot pay for loses to a road we can. */
function planOptions(p){
  const options = [];

  const cityV = vertices.filter(v => canPlaceCity(v.id, p.id));
  if (p.cities < LIMIT.city && cityV.length){
    const best = cityV.reduce((a, b) => vertexValue(b.id) > vertexValue(a.id) ? b : a);
    options.push({ kind:"city", value: W.vpValue + vertexValue(best.id) * 0.45,
                   need: shortfall(p, COST.city).total });
  }

  const exp = bestExpansion(p.id);
  if (p.settlements < LIMIT.settlement && exp){
    if (exp.dist === 0){
      // A settlement is a VP, new production, and a future city site.
      options.push({ kind:"settlement", value: W.vpValue * W.cityBias + exp.score * 0.6,
                     need: shortfall(p, COST.settlement).total });
    } else if (p.roads < LIMIT.road){
      // Roads are only worth what they unlock, discounted by how far away it is.
      options.push({ kind:"road", value: (W.vpValue + exp.score * 0.5) / (exp.dist + 1),
                     need: shortfall(p, COST.road).total });
    }
  }

  // From roughly 5 VP the deck is the best remaining engine: Nopes to protect
  // a win, knights toward Largest Army, and the Imploding Kitten outright.
  const push = publicVP(p) >= W.cardPushVP;
  options.push({ kind:"card", value: W.cardValue * (push ? W.cardPushMult : 1),
                 need: Math.max(0, 3 - uniqueCount(p)) });

  for (const o of options) o.eff = o.value / (1 + o.need * W.needPenalty);
  options.sort((a, b) => b.eff - a.eff);
  return options;
}

function goal(p){ return planOptions(p)[0].kind; }

function goalCost(g){
  // A card costs any 3 different resources; treating that as an empty cost
  // would make every resource look spare, which starves the build plan.
  if (g === "card") return { wood:1, brick:1, sheep:1 };
  return COST[g];
}

/* Which three resources to spend on a card without breaking the build plan.
   Returns null when buying would cost us the thing we are saving for. */
function pickCardPayment(p, g){
  const cost = COST[g] || {};
  const avail = RES.filter(r => p.res[r] > 0);
  if (avail.length < 3) return null;
  avail.sort((a, b) => ((cost[a] || 0) - (cost[b] || 0)) || (p.res[b] - p.res[a]));
  const pay = avail.slice(0, 3);
  if (g !== "card"){
    for (const r of pay){
      if (p.res[r] - 1 < (cost[r] || 0)) return null;   // would break the goal
    }
  }
  return pay;
}

/* Resources we hold beyond what our goal needs. */
function surplus(p, g){
  const cost = goalCost(g);
  const out = {};
  for (const r of RES){
    const keep = cost[r] || 0;
    const spare = p.res[r] - keep;
    if (spare > 0) out[r] = spare;
  }
  return out;
}

/* How close are we to something that actually scores? Roads and cards do not
   count: an earlier version let a road we were one wood short of suppress the
   whole spend-down, and bots sat on 15 cards waiting for it. */
function vpNearest(p){
  const scoring = planOptions(p).filter(o => o.kind === "settlement" || o.kind === "city");
  return scoring.length ? Math.min.apply(null, scoring.map(o => o.need)) : 99;
}

/* Choose a road by simulating it: does it shorten the path to a settlement
   site, or lengthen our longest unbroken run? An edge that does neither is a
   wasted wood and brick, and is never built — that is what produced the
   pointless branches instead of the Longest Road steal. */
function pickRoad(pid){
  const cands = edges.filter(e => roadSpotShown(e.id));
  if (!cands.length) return null;

  const reachBefore = reachValue(pid);
  const lenBefore   = longestRoadFor(pid);

  /* Longest Road is worth DEFENDING as well as taking. The old test asked
     only whether we were close enough to take it from somebody else, so a bot
     holding a five-road run watched a rival build a six and did nothing about
     it — there was no branch in which holding it mattered. Measured against
     the longest run anybody else actually has rather than against the record
     on the card, because the record does not move until somebody passes it. */
  const holder = S.longestRoad.owner;
  let rivalLen = 4;
  for (const q of S.players){
    if (q.id === pid) continue;
    rivalLen = Math.max(rivalLen, longestRoadFor(q.id));
  }
  const contesting = holder === pid ? rivalLen >= lenBefore - 1
                                    : lenBefore >= rivalLen - 2;

  let best = null;
  for (const e of cands){
    e.owner = pid;                              // simulate
    const reachAfter = reachValue(pid);
    const lenAfter   = longestRoadFor(pid);
    const goes       = roadGoesSomewhere(e.id, pid);
    e.owner = null;

    const opened   = reachAfter - reachBefore;  // >0: this edge opens ground up
    const lengthen = lenAfter - lenBefore;      // >0: extends our longest run
    if (opened <= 0 && lengthen <= 0) continue; // pure branch — never build

    let score = opened * W.roadOpens + lengthen * (contesting ? 45 : 15);
    // Nowhere to build at the end of it and nowhere to carry on to. Still
    // worth something while the run itself is worth something — a road into
    // a wall can hold Longest Road — so this is a heavy discount and not a
    // refusal.
    if (!goes) score = score * 0.25 - 10;
    if (contesting && lenAfter > rivalLen) score += 60;   // takes it outright
    if (score <= 0) continue;
    if (!best || score > best.score) best = { id: e.id, score };
  }
  return best ? best.id : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   KITTEN CARD STRATEGY
   ══════════════════════════════════════════════════════════════════════════ */

function uniqueCount(p){ return RES.filter(r => p.res[r] > 0).length; }

/* Is this journal entry worth a Nope? Mirrors the old prompt logic, but
   judged after the fact rather than before. */
function nopeJournalDecision(p, e){
  const actor = S.players[e.actor];
  // Judge by what we held before the action, not by what is left afterwards.
  const had = e.snap ? RES.reduce((n, r) => n + e.snap.res[p.id][r], 0) : totalRes(p);

  // A Noped roll is thrown again, so a seven that is about to halve a big hand
  // is worth a card: five sixths of the rerolls are not sevens. A small cut is
  // not — the Nope is worth more held.
  if (e.kind === "roll"){
    return e.show === "seven" && owesSevenCut(p.id) &&
           Math.floor(had / 2) >= W.sevenAnswerCut;
  }
  if (e.kind === "buy")  return publicVP(actor) >= 8;   // deny a closing player

  // A Nope. Worth answering only when it is OUR turn it just ended, and only
  // when that turn had actually started — a counter-Nope hands it straight
  // back. Refereeing an argument between two other players is not our job.
  if (e.kind === "defend"){
    return !!e.turnBack && e.turnBack.cur === p.id && e.turnBack.phase === "main";
  }

  if (e.card){
    const k = e.card.key;
    const aimedAtUs = e.target === p.id;
    if (k === "explode") return aimedAtUs ? had >= 4 : publicVP(actor) >= 8;
    if (k === "attack")  return aimedAtUs ? had >= 5 : false;
    if (k === "favor")   return aimedAtUs ? had >= 6 : false;
    if (k === "skip")    return aimedAtUs && publicVP(p) >= 6;
    if (k === "alter"){
      return (e.payload && e.payload.hexes || []).some(hid =>
        hexes[hid].verts.some(v => vertices[v].owner === p.id));
    }
    if (k === "knight")  return publicVP(actor) >= 8;
    if (k === "reverse") return false;
  }
  return false;
}

/* Should this bot spend a Nope, and on what?
   Two rules, matching the two legal uses:
     - an attack aimed at us: block it if the loss is meaningful
     - a whole turn: block it if that turn wins the game, or was very large
   Nopes are otherwise HELD, because once anyone nears 10 VP a held Nope is
   worth far more (and the forced-Nope rule will spend it for us anyway). */
function nopeDecision(p, pd){
  const base = pd.base;

  if (base.type === "turn" || base.type === "win"){
    const actor = S.players[base.actor];
    if (publicVP(actor) >= 9) return true;              // about to close it out
    const rec = S.turnRec;
    const built = rec ? rec.edges.length + rec.verts.length + rec.drawn.length : 0;
    if (built >= 3) return true;                        // a huge turn, erase it
    if (publicVP(actor) >= W.nopeHoldVP && built >= 2) return true;
    return false;
  }

  if (base.type !== "card") return false;
  const key = base.card.key;
  if (key === "explode") return totalRes(p) >= 4;       // losing the hand is fatal
  if (key === "attack")  return totalRes(p) >= 5;
  if (key === "skip")    return publicVP(p) >= 6;       // tempo matters late
  if (key === "favor")   return totalRes(p) >= 6;
  if (key === "alter")   return true;                   // they aimed it at our numbers
  return false;
}

/* Which offensive card to play, and at whom. Targeting rule: hit whoever is
   closest to winning, unless we specifically want cards they hold. */
function pickCardPlay(p){
  const playable = p.cards
    .map((c, i) => ({ c, i }))
    .filter(o => {
      const d = KITTEN[o.c.key];
      return d.kind !== "vp" && d.kind !== "response" && o.c.boughtTurn !== S.turnCounter;
    });
  if (!playable.length) return null;

  const lead = leaderId(p.id);
  const richest = S.players.filter(q => q.id !== p.id)
                           .sort((a, b) => totalRes(b) - totalRes(a))[0];
  const g = goal(p);
  const miss = shortfall(p, goalCost(g));

  const has = k => playable.find(o => o.c.key === k);

  // Knight: clear a robber sitting on us, or hit the leader. Also the route
  // to Largest Army, which is 2 VP.
  const robberOnUs = hexes[S.robber].verts.some(v => vertices[v].owner === p.id);
  const kn = has("knight");
  if (kn && (robberOnUs || p.knights >= 2 || Math.random() < 0.5))
    return { idx: kn.i, target: null };

  // Favor: name what we are missing, from whoever holds the most cards.
  const fav = has("favor");
  if (fav && miss.total > 0 && richest && totalRes(richest) >= 3){
    const want = { wood:0, brick:0, sheep:0, wheat:0, ore:0 };
    let left = 3;
    for (const r in miss.need){
      const take = Math.min(miss.need[r], left);
      want[r] += take; left -= take;
      if (!left) break;
    }
    // spend any remainder on whatever we produce least of
    if (left){
      const prod = production(p.id);
      const poor = RES.slice().sort((a, b) => prod[a] - prod[b]);
      for (const r of poor){ if (!left) break; want[r]++; left--; }
    }
    return { idx: fav.i, target: richest.id, payload: { want } };
  }

  // Exploding Kitten: wipe the leader's hand, best when it is fat.
  const exp = has("explode");
  if (exp && lead !== null && totalRes(S.players[lead]) >= 4)
    return { idx: exp.i, target: lead };

  // Attack: make the leader drop three.
  const atk = has("attack");
  if (atk && lead !== null && totalRes(S.players[lead]) >= 3)
    return { idx: atk.i, target: lead };

  // Skip: deny the leader a whole turn.
  const skip = has("skip");
  if (skip && lead !== null && publicVP(S.players[lead]) >= 6)
    return { idx: skip.i, target: lead };

  // Reverse: a free extra turn, always worth taking.
  const rev = has("reverse");
  if (rev) return { idx: rev.i, target: null };

  // Alter the Future: swap a fat number off an opponent onto one of ours.
  const alt = has("alter");
  if (alt) return { idx: alt.i, target: null };

  return null;
}

/* Alter the Future: pick the two tokens to swap. We want a high number on a
   hex we occupy and a low one on a hex only opponents touch. */
function pickAlterPair(pid){
  const numbered = hexes.filter(h => h.number !== null);
  const mine  = numbered.filter(h => h.verts.some(v => vertices[v].owner === pid));
  const yours = numbered.filter(h => h.verts.some(v => vertices[v].owner !== null &&
                                                       vertices[v].owner !== pid) &&
                                     !h.verts.some(v => vertices[v].owner === pid));
  if (!mine.length || !yours.length) return [numbered[0].id, numbered[1].id];
  // our weakest hex ↔ their strongest
  mine.sort((a, b) => pips(a.number) - pips(b.number));
  yours.sort((a, b) => pips(b.number) - pips(a.number));
  if (pips(yours[0].number) <= pips(mine[0].number)) return null;   // no gain
  return [mine[0].id, yours[0].id];
}

/* Where to put the robber: the hex that costs the leader the most and costs
   us nothing. */
function pickRobberHex(pid){
  let best = null;
  for (const h of hexes){
    if (h.id === S.robber) continue;
    if (h.verts.some(v => vertices[v].owner === pid)) continue;   // never rob ourselves
    let score = 0;
    for (const vid of h.verts){
      const o = vertices[vid].owner;
      if (o === null || o === pid) continue;
      const mult = vertices[vid].type === "city" ? 2 : 1;
      const q = S.players[o];
      score += pips(h.number) * mult * (1 + threat(q) / 100) * W.leaderWeight;
      score += totalRes(q) * 0.15;
    }
    if (!best || score > best.score) best = { id: h.id, score };
  }
  // Everything touches us — take the least bad option.
  if (!best){
    const alt = hexes.filter(h => h.id !== S.robber);
    return alt[Math.floor(Math.random() * alt.length)].id;
  }
  return best.id;
}

/* ══════════════════════════════════════════════════════════════════════════
   TRADING
   ══════════════════════════════════════════════════════════════════════════ */

/* Bank/port trade — but ONLY when it completes a build this turn.
   A 4:1 trade burns four resources for one; done speculatively it was eating
   about a fifth of the bot's entire income. Requiring that the trade finish
   the purchase makes it pay for itself. */
function tryBankTrade(p){
  // Consider every plan, not just the top one: if a city is two ore away but a
  // settlement is one wood away, buy the wood.
  for (const plan of planOptions(p)){
    if (plan.kind === "card") continue;
    const cost = goalCost(plan.kind);
    const miss = shortfall(p, cost);
    if (miss.total !== 1) continue;              // must be exactly one short
    const need = Object.keys(miss.need)[0];
    if (S.bank[need] <= 0) continue;

    for (const r of RES){
      if (r === need) continue;
      const rate = tradeRate(p, r);
      const keep = cost[r] || 0;
      if (p.res[r] - rate < keep) continue;      // must not break the same build
      const snapBefore = snapAll();
      take(p, r, rate); give(p, need, 1);
      logMsg("<b>" + p.name + "</b> trades " + rate + " " + RES_NAME[r] +
             " → 1 " + RES_NAME[need] + ".");
      const g1 = { wood:0,brick:0,sheep:0,wheat:0,ore:0 }; g1[r] = rate;
      const g2 = { wood:0,brick:0,sheep:0,wheat:0,ore:0 }; g2[need] = 1;
      // Journalled, so a bot buying the last brick it needs can be Noped like
      // any other action rather than being the one move nobody can answer.
      bankToast(p, g1, g2, snapBefore);
      return true;
    }
  }
  return false;
}

/* Put an offer in front of a human. Their answer arrives asynchronously; the
   driver simply waits while the modal is open. */
/* A bot's offer reaches a person exactly the way another person's does: a
   panel on THEIR screen, addressed to their seat.

   It used to be a bare openModal with no seat on it, which drew on whichever
   machine happened to be running the game. Online that meant the host got a
   dialog for somebody else's trade — another way to be traded with against
   your will — and if the host left it alone the bots waited on an answer
   that could never come, which is the "thinking forever" freeze. */
function proposeToHuman(bot, human, offer, want){
  const fmt = o => RES.filter(r => o[r] > 0).map(r => o[r] + " " + RES_NAME[r]).join(", ") || "nothing";
  const key = "botoffer" + bot.id + "_" + human.id;
  let done = false;

  const decline = function(){
    if (done) return; done = true;
    closePanel(key);
    logMsg("<b>" + human.name + "</b> declines <b>" + bot.name + "</b>'s offer.");
    render();
  };
  const accept = function(){
    if (done) return; done = true;
    closePanel(key);
    // The board may have moved since the offer went out.
    const ok = RES.every(r => bot.res[r] >= offer[r] && human.res[r] >= want[r]);
    if (!ok){ hint("That trade is no longer possible."); render(); return; }
    const snapBefore = snapAll();
    for (const r of RES){
      bot.res[r]   -= offer[r]; human.res[r] += offer[r]; noteGain(human, r, offer[r]);
      human.res[r] -= want[r];  bot.res[r]   += want[r];  noteGain(bot,   r, want[r]);
    }
    logMsg("<b>" + bot.name + "</b> ⇄ <b>" + human.name + "</b>: gave " +
           fmt(offer) + " for " + fmt(want) + ".");
    tradeToast(bot, human, offer, want, snapBefore);
    render();
  };

  openPanel(key, human.id, "Trade offer from " + esc(bot.name),
    '<div class="stack"><div class="tline"><span>You get</span>' + resList(offer) + '</div>' +
    '<div class="tline"><span>You give</span>' + resList(want) + '</div></div>',
    [ { label:"Decline", fn: decline },
      { label:"Accept", cls:"primary", fn: accept } ]);

  // A timed game cannot let an unanswered bot offer consume the whole turn.
  // The panel belongs to the human, but the bot owns the turn and must resume
  // as soon as the offer expires.
  if (S.turnSeconds){
    const gameAtCall = S;
    setTimeout(function(){
      if (S !== gameAtCall || done || !panelBox[key]) return;
      done = true;
      closePanel(key);
      logMsg("<b>" + bot.name + "</b>'s trade offer expires.");
      render();
      if (typeof botTick === "function") botTick();
    }, 3000);
  }
}

/* Offer a 1-for-1 to another player — bot or human. Never trade with whoever
   is about to win. */
function tryPlayerTrade(p){
  const g = goal(p);
  const miss = shortfall(p, goalCost(g));
  if (!miss.total) return false;
  const spare = surplus(p, g);
  const spareList = RES.filter(r => (spare[r] || 0) >= 1);
  if (!spareList.length) return false;
  const lead = leaderId(p.id);

  const needList = Object.keys(miss.need);
  const partners = S.players
    .filter(q => q.id !== p.id && totalRes(q) > 0)
    .filter(q => !(q.id === lead && publicVP(q) >= 8))     // do not feed the winner
    .sort((a, b) => threat(a) - threat(b));                // prefer the weakest

  for (const q of partners){
    for (const need of needList){
      for (const give_ of spareList){
        if (give_ === need) continue;
        const offer = { wood:0, brick:0, sheep:0, wheat:0, ore:0 };
        const want  = { wood:0, brick:0, sheep:0, wheat:0, ore:0 };
        offer[give_] = 1; want[need] = 1;
        if (q.res[need] < 1) continue;
        const ag = agentOf(q.id);
        if (!ag || !ag.considerTrade){
          // A human: ask, and let the driver idle until they answer.
          proposeToHuman(p, q, offer, want);
          return true;
        }
        const accepted = ag.considerTrade(p, q, offer, want);
        if (accepted){
          const snapBefore = snapAll();
          p.res[give_]--; q.res[give_]++; noteGain(q, give_, 1);
          q.res[need]--;  p.res[need]++;  noteGain(p, need, 1);
          logMsg("<b>" + p.name + "</b> ⇄ <b>" + q.name + "</b>: " +
                 RES_NAME[give_] + " for " + RES_NAME[need] + ".");
          tradeToast(p, q, offer, want, snapBefore);
          return true;
        }
      }
    }
  }
  return false;
}

/* Last resort when holding too many cards: convert the deepest pile toward
   whatever our plan actually needs, so a 7 cannot take it. */
function dumpSurplus(p){
  const g = goal(p);
  const cost = COST[g] || {};
  const piles = RES.slice().sort((a, b) => p.res[b] - p.res[a]);
  for (const r of piles){
    const rate = tradeRate(p, r);
    if (p.res[r] < rate) continue;
    if ((cost[r] || 0) > 0 && p.res[r] - rate < cost[r]) continue;
    let want = null;
    for (const n in cost) if (p.res[n] < cost[n] && S.bank[n] > 0){ want = n; break; }
    if (!want) want = RES.filter(x => x !== r && S.bank[x] > 0)
                         .sort((a, b) => p.res[a] - p.res[b])[0];
    if (!want) continue;
    const snapBefore = snapAll();
    take(p, r, rate); give(p, want, 1);
    logMsg("<b>" + p.name + "</b> trades down " + rate + " " + RES_NAME[r] +
           " → 1 " + RES_NAME[want] + ".");
    const g1 = { wood:0,brick:0,sheep:0,wheat:0,ore:0 }; g1[r] = rate;
    const g2 = { wood:0,brick:0,sheep:0,wheat:0,ore:0 }; g2[want] = 1;
    bankToast(p, g1, g2, snapBefore);
    return true;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT
   ══════════════════════════════════════════════════════════════════════════ */

/* The UI refuses board clicks while a bot seat is active, so the bot marks
   its own calls. Wrapping here rather than in the driver keeps it correct no
   matter who invokes the agent (driver, headless harness, tests). */
function acting(fn){
  return function(){
    const prev = window.__botActing;
    window.__botActing = true;
    try { return fn.apply(this, arguments); }
    finally { window.__botActing = prev; }
  };
}

function makeAgent(pid){
  const me = () => S.players[pid];

  const agent = {
    id: pid,
    isBot: true,
    lastTurn: -1,
    offered: false,

    /* ── setup ── */
    setupSettlement(){
      let best = null;
      for (const v of vertices){
        if (!canPlaceSettlement(v.id, pid, true)) continue;
        const score = vertexValue(v.id) + (S.phase === "setup2" ? vertexValueFor(v.id, pid) * 0.5 : 0);
        if (!best || score > best.score) best = { vid: v.id, score };
      }
      return best ? best.vid : null;
    },
    setupRoad(fromVertex){
      // Point the opening road at the best spot we could reach next.
      const legal = edges.filter(e => canPlaceRoad(e.id, pid, fromVertex));
      if (!legal.length) return null;
      let best = null;
      for (const e of legal){
        const other = e.v[0] === fromVertex ? e.v[1] : e.v[0];
        let score = 0;
        for (const nb of vertices[other].adj){
          if (vertices[nb].owner !== null) continue;
          score = Math.max(score, vertexValue(nb));
        }
        if (!best || score > best.score) best = { id: e.id, score };
      }
      return best.id;
    },

    /* ── forced discards ── */
    chooseDiscard(p, n){
      // Shed whatever is furthest from our goal, keeping resource diversity
      // intact because kitten cards need three different types.
      const g = goal(p);
      const cost = goalCost(g);
      const pick = { wood:0, brick:0, sheep:0, wheat:0, ore:0 };
      let left = n;
      const order = RES.slice().sort((a, b) => {
        const ka = (cost[a] || 0), kb = (cost[b] || 0);
        if (ka !== kb) return ka - kb;                 // keep what the goal needs
        return p.res[b] - p.res[a];                    // then dump the biggest pile
      });
      // never drop a type to zero while we still have spares elsewhere
      for (const r of order){
        while (left > 0 && pick[r] < p.res[r] - (p.res[r] > 1 ? 1 : 0)){ pick[r]++; left--; }
      }
      for (const r of order){
        while (left > 0 && pick[r] < p.res[r]){ pick[r]++; left--; }
      }
      return pick;
    },

    /* ── robber ── */
    chooseVictim(victims){
      return victims.slice().sort((a, b) => threat(b) - threat(a))[0];
    },
    /* Worth a Defuse if we would rather be aiming the robber than wearing it.
       This used to be asked before the theft, through a window that told the
       table you were holding a Defuse before you had decided to spend it. The
       robbery is a line in the log now and is answered from there, like
       everything else. */
    defuseRobbery(e){
      const p = me();
      const thief = S.players[e.actor];
      return e.target === p.id || (thief && publicVP(thief) >= 7);
    },

    /* Decide whether to spend a reaction on the one entry still open to it.
       Called by the driver after every action, since there is no prompt to
       wait for any more. The window is a single entry wide — openEntry() is
       either that entry or nothing — so there is never a backlog to sift. */
    react(){
      const p = me();
      const hasNope = p.cards.some(c => c.key === "nope");
      const hasDefuse = p.cards.some(c => c.key === "defuse");
      if (!hasNope && !hasDefuse) return false;

      const e = openEntry();
      if (!e) return false;

      if (hasDefuse && canDefuseEntry(e, p.id)){
        // A robbery has no card behind it — the robber has just landed on a
        // hex we are settled on, with or without taking something.
        if (typeof isRobberEntry === "function" && isRobberEntry(e)){
          if (agent.defuseRobbery(e)){ defuseEntry(e.id, p.id); return true; }
        } else {
          // A seven is Defusable too, and is answered from answerSeven
          // instead — see there for why.
          const k = e.card ? e.card.key : null;
          if (k === "explode" || k === "attack" || k === "favor" || k === "alter"){
            defuseEntry(e.id, p.id);
            return true;
          }
        }
      }
      if (hasNope && canNopeFor(e, p.id) && nopeJournalDecision(p, e)){
        nopeEntry(e.id, p.id);
        return true;
      }
      return false;
    },

    /* Spend a card on the seven rather than pay it — a Nope throws the dice
       again, a Defuse spares this hand and lets the rest of the roll stand.

       Asked by stepSeven, just before this bot is handed its discard, rather
       than left to the driver: a bot pays the instant it is asked, and the
       driver only reacts BETWEEN actions. Without a hook of its own the seven
       would be the one thing at the table a bot could never answer, however
       much it stood to lose. */
    answerSeven(){
      const p = me();
      const e = S.seven ? S.journal.find(x => x.id === S.seven.jid) : null;
      if (!e || !canNopeEntry(e)) return false;
      if (Math.floor(totalRes(p) / 2) < W.sevenAnswerCut) return false;
      // A Defuse is playable the moment it is drawn; everything else waits.
      const fresh = k => p.cards.some(c => c.key === k &&
          (c.boughtTurn !== S.turnCounter ||
           (typeof playableWhenDrawn === "function" && playableWhenDrawn(c))));
      // Defuse first: it costs the table nothing else, where a Nope throws away
      // a roll everybody else may have been happy with.
      if (fresh("defuse") && canDefuseEntry(e, p.id)) return defuseEntry(e.id, p.id);
      if (fresh("nope")   && canNopeFor(e, p.id))    return nopeEntry(e.id, p.id);
      return false;
    },

    /* ── reactions (legacy prompt path, unused) ── */
    respond(pd, elig){
      const p = me();
      if (elig.canDefuse && pd.base.type === "card"){
        const key = pd.base.card.key;
        if (key === "explode" || key === "attack" || key === "favor") return "defuse";
        if (key === "alter") return "defuse";
      }
      if (elig.canNope && nopeDecision(p, pd)) return "nope";
      return null;
    },

    /* Three cards to demand, used when this bot Defuses a Favor. */
    favorWant(from){
      const p = me();
      const want = { wood:0, brick:0, sheep:0, wheat:0, ore:0 };
      const miss = shortfall(p, goalCost(goal(p)));
      let left = 3;
      for (const r in miss.need){
        const t = Math.min(miss.need[r], left);
        want[r] += t; left -= t;
        if (!left) break;
      }
      if (left){
        const prod = production(p.id);
        for (const r of RES.slice().sort((a, b) => prod[a] - prod[b])){
          if (!left) break;
          want[r]++; left--;
        }
      }
      return want;
    },

    /* ── trading ── */
    considerTrade(from, to, offer, want){
      // `to` is us. We receive `offer`, we give `want`.
      const p = me();
      for (const r of RES) if (p.res[r] < want[r]) return false;

      const g = goal(p);
      const cost = goalCost(g);
      const missBefore = shortfall(p, cost).total;
      const after = {};
      for (const r of RES) after[r] = p.res[r] + offer[r] - want[r];
      const missAfter = RES.reduce((s, r) => s + Math.max(0, (cost[r] || 0) - after[r]), 0);

      const uniqBefore = RES.filter(r => p.res[r] > 0).length;
      const uniqAfter  = RES.filter(r => after[r] > 0).length;

      let gain = (missBefore - missAfter) * 2 + (uniqAfter - uniqBefore) * 1.2;
      const totalIn  = RES.reduce((s, r) => s + offer[r], 0);
      const totalOut = RES.reduce((s, r) => s + want[r], 0);
      gain += (totalIn - totalOut) * 0.5;

      // Never hand material to someone about to win.
      if (publicVP(from) >= 8) gain -= 3;
      if (publicVP(from) >= 9) return false;
      return gain > 0;
    },

    /* ── one atomic action; returns true if it did something ── */
    step: acting(function(){
      const p = me();

      if (S.phase === "roll"){ rollDice(); return true; }
      if (S.phase !== "main") return false;

      // one trade offer per turn, per bot
      if (agent.lastTurn !== S.turnCounter){
        agent.lastTurn = S.turnCounter;
        agent.offered = false;
      }

      // 1. cards first — a knight before rolling is already past, but attacks
      //    and Reverse are best used before we commit resources.
      const play = pickCardPlay(p);
      if (play){
        const c = p.cards[play.idx];
        const def = KITTEN[c.key];
        if (def.kind === "board"){
          playCard(play.idx);                       // opens the alter picker
        } else if (def.kind === "target" || play.target !== null){
          const owner = p.cards.indexOf(c);
          if (owner >= 0){
            proposeAction({ type:"card", card:c, idx:owner, actor:pid,
                            target: play.target, payload: play.payload || {} });
          }
        } else {
          playCard(play.idx);
        }
        return true;
      }

      // 2. build in value order
      const cities = vertices.filter(v => vertexSpotShown(v.id) === "city");
      if (cities.length){
        cities.sort((a, b) => vertexValue(b.id) - vertexValue(a.id));
        vertexClick(cities[0].id); vertexClick(cities[0].id);
        return true;
      }
      const setts = vertices.filter(v => vertexSpotShown(v.id) === "settlement");
      if (setts.length){
        setts.sort((a, b) => vertexValueFor(b.id, pid) - vertexValueFor(a.id, pid));
        vertexClick(setts[0].id); vertexClick(setts[0].id);
        return true;
      }

      const g = goal(p);
      const held = totalRes(p);
      // "Very close" means close to a VP — a settlement or a city. A road we
      // cannot quite afford is not a reason to sit on a mountain of cards.
      const nearest = vpNearest(p);
      const flush = (held >= W.handLimit && nearest > W.closeToVP) ||
                    held >= W.handHardCap;
      const pushCards = publicVP(p) >= W.cardPushVP;

      // 3. a bank trade that finishes a build right now
      if (tryBankTrade(p)) return true;

      // 4. one trade offer per turn, to anyone at the table
      if (!agent.offered){
        agent.offered = true;
        if (tryPlayerTrade(p)) return true;
      }

      // 5. roads — only ones that reach a settlement site or build Longest Road
      const roadId = pickRoad(pid);
      if (roadId !== null){ edgeClick(roadId); edgeClick(roadId); return true; }

      // 6. kitten cards — hard once we are in the 5+ VP band, and whenever we
      //    are holding too much to survive a 7.
      if (canBuyKitten() && (flush || pushCards || nearest >= 3)){
        const pay3 = pickCardPayment(p, flush || pushCards ? "card" : g);
        if (pay3){
          for (const r of pay3) take(p, r, 1);
          drawKitten(p);
          return true;
        }
      }

      // 7. Hard floor. Whatever else is pending, a turn must never end on a
      //    mountain of cards: a 7 would take half of it for nothing.
      if (held >= W.handLimit){
        if (canBuyKitten()){
          const pay3 = pickCardPayment(p, "card");
          if (pay3){
            for (const r of pay3) take(p, r, 1);
            drawKitten(p);
            return true;
          }
        }
        if (dumpSurplus(p)) return true;
      }

      return false;
    }),

    /* ── forced board selections owned by this bot ── */
    handleSelect: acting(function(){
      const sel = S.select;
      if (!sel) return false;
      // Twice, like the setup placements below: the robber and the second
      // Alter token both arm on the first click and commit on the second, so
      // a person cannot move either with one stray click.
      if (sel.kind === "robber"){
        const hid = pickRobberHex(sel.actor);
        hexClick(hid); hexClick(hid);
        return true;
      }
      if (sel.kind === "alter"){
        const pair = pickAlterPair(sel.actor);
        const numbered = hexes.filter(h => h.number !== null);
        const a = pair ? pair[0] : numbered[0].id;
        const b = pair ? pair[1] : numbered[1].id;
        hexClick(a); hexClick(b); hexClick(b);
        return true;
      }
      if (sel.kind === "settlement" && sel.setup){
        const vid = agent.setupSettlement();
        if (vid === null) return false;
        vertexClick(vid); vertexClick(vid);
        return true;
      }
      if (sel.kind === "road"){
        const eid = agent.setupRoad(sel.fromVertex);
        if (eid === null) return false;
        edgeClick(eid); edgeClick(eid);
        return true;
      }
      return false;
    })
  };
  return agent;
}

/* ══════════════════════════════════════════════════════════════════════════
   DRIVER
   ══════════════════════════════════════════════════════════════════════════
   A polling step loop rather than chained callbacks: the game's own flow is
   full of asynchronous prompts (discards, steals, response windows), and
   polling stays correct no matter how many of them fire.
   ══════════════════════════════════════════════════════════════════════════ */

let timer = null;
let guard = 0;

function stop(){ if (timer){ clearTimeout(timer); timer = null; } }

/* Putting the table away for good. Distinct from stop(), which is the step
   loop pausing itself between actions and is called before every one of
   them — the taunts have their own clock and must outlive that. */
function stopAll(){ stop(); stopTaunts(); }

function schedule(ms){
  stop();
  timer = setTimeout(tickNow, ms === undefined ? AI_PACE : ms);
}

const IDLE = 320;      // slow poll while a human is doing something

/* Who owns the current forced board selection, if any. During setup the
   select carries no actor, so it belongs to whoever's turn it is. */
function selectOwner(){
  if (!S.select) return null;
  return S.select.actor !== undefined ? S.select.actor : S.cur;
}

/* The driver polls for as long as any bot is seated, rather than stopping
   when it finds itself blocked.

   An earlier version returned without rescheduling whenever a modal was open
   or a response window was resolving. If it happened to tick while a human
   prompt was up — say the discard from a bot's Attack — the loop died there,
   and nothing restarted it when the prompt closed, freezing that bot's turn
   with no way to end it. Polling costs nothing and self-heals from any missed
   wake-up, not just that one path. */
function tickNow(){
  timer = null;
  if (!S || S.phase === "over") return;
  // Online, only the host runs the game. A terminal that still had agents
  // lying about from a local game would drive seats it does not own, and its
  // "clicks" go out as intents — so it would play for the human sitting there.
  if (window.NET && NET.isGuest && NET.isGuest()) return;
  if (!S.players.some(p => agentOf(p.id))) return;      // no bots at this table

  // A human prompt is open. Wait it out.
  //
  // Online, a dialog handed to another player leaves NO overlay on this
  // screen — it was shipped to theirs — so the DOM check alone let the bots
  // carry on playing while somebody was still discarding. That is how a
  // seven could get rolled, the discard shipped out, and the robber never
  // moved: the sequence's continuation was waiting on an answer that arrived
  // several bot actions too late.
  if ((typeof humanPromptOpen === "function" && humanPromptOpen()) || S.pending){
    guard = 0;
    return schedule(IDLE);
  }

  // The three seconds between one turn and the next belong to whoever wants to
  // answer the turn that just ended. Bots wait it out like everybody else,
  // otherwise the next one would roll before anyone could reach for a Nope.
  if (typeof handoverActive === "function" && handoverActive()){
    guard = 0;
    return schedule(IDLE);
  }

  // The Imploding Kitten is still landing. Nobody acts through that, a bot
  // that just drew it least of all - it would spend the reveal playing its
  // turn behind a card covering the middle of the board, and the twenty
  // seconds it is owed have not started yet.
  if (typeof implodeRevealing === "function" && implodeRevealing()){
    guard = 0;
    return schedule(IDLE);
  }

  // A card is still being turned over in the middle of the board. Wait for it.
  // Bots move faster than anybody can read, and playing the next card while
  // the last one is still on screen stacked reveals two and three deep - the
  // queue would drop the middle one and the table would simply never see it.
  // One at a time, so every play gets its moment.
  if (typeof showcaseBusy === "function" && showcaseBusy()){
    guard = 0;
    return schedule(IDLE);
  }

  // A forced board selection may belong to a bot even on a human's turn
  // (a Defused knight hands the robber to whoever defused it).
  const owner = selectOwner();
  if (owner !== null){
    const ag = agentOf(owner);
    if (!ag){ guard = 0; return schedule(IDLE); }       // human owns this prompt
    if (++guard > 500) return schedule(1000);
    // A throw inside a bot must never kill the loop and strand the game;
    // log it, keep polling, and let the guard fall through to End Turn.
    try { ag.handleSelect(); }
    catch (err){ console.error("bot handleSelect failed:", err); return schedule(IDLE); }
    return schedule();
  }

  // Anyone holding a reaction may answer the newest entry, whoever's turn
  // it is. This replaces the response window entirely.
  for (const q of S.players){
    const rb = agentOf(q.id);
    if (!rb || !rb.react) continue;
    let acted = false;
    try { acted = rb.react(); }
    catch (err){ console.error("bot react failed:", err); }
    if (acted) return schedule();
  }

  const ag = agentOf(S.cur);
  if (!ag){ guard = 0; return schedule(IDLE); }         // human's turn — hands off
  if (++guard > 500){ guard = 0; safeEndTurn(); return schedule(IDLE); }

  let acted = false;
  try { acted = ag.step(); }
  catch (err){ console.error("bot step failed:", err); acted = false; }

  if (acted) schedule();
  else { guard = 0; safeEndTurn(); schedule(); }
}

/* Ending a turn can itself open a response window; never let that throw out
   of the driver.

   Note that requestEndTurn now refuses while an answer is still owed — a
   seven part-paid, a robber still to place. This is the driver's escape from a
   bot that cannot act, and it deliberately does NOT get to bypass that: force
   ending a turn mid-seven walked away from the discards and the robber
   together, which is exactly the hole it was papering over. A table that
   genuinely wedges now stops visibly rather than quietly skipping what was
   owed. */
function safeEndTurn(){
  try { requestEndTurn(); }
  catch (err){ console.error("bot end-turn failed:", err); }
}

/* Replaces the stub in the main file. */
window.botTick = function(){
  guard = 0;
  if (!S || S.phase === "over") return;
  if (!S.players.some(p => agentOf(p.id))) return;
  schedule();
};

/* ══════════════════════════════════════════════════════════════════════════
   TAUNTS
   ══════════════════════════════════════════════════════════════════════════
   Bots throw the same emoji people do, out of the same tray, through the same
   pushEmote — so a terminal draws a bot's jeer exactly the way it draws a
   player's, and nothing new had to be taught to travel.

   Everything here reads the JOURNAL, which is the public record: what was
   played, by whom, at whom. No bot looks in a hand to decide whether to
   laugh, so AI.selfCheck's promise is untouched — and it is funnier this way
   round anyway, because then the bots are reacting to what the table saw
   rather than to what they know.

   The tuning is deliberately mean. A bot that has just taken your whole hand
   laughs at you; a bot that has just lost its own hand blames the dice. The
   only thing they are gracious about is losing the game, and only sometimes.
   ══════════════════════════════════════════════════════════════════════════ */

/* Named for what they mean, resolved against the tray at the moment of use:
   pushEmote refuses anything the tray does not hold, and a bot with a wider
   vocabulary than a player is a bot that has been given something extra. */
const JEER    = ["\u{1F639}","\u{1F602}","\u{1F921}","\u{1F480}","\u{1F476}",
                 "\u{1F414}","\u{1F4A9}","\u{1F595}"];
const SMUG    = ["\u{1F60F}","\u{1F9E0}","\u{1F525}","\u{1F971}"];
const HURT    = ["\u{1F62D}","\u{1F631}","\u{1F644}","\u{1F480}"];
const RESPECT = ["\u{1F44F}","\u{1F91D}","\u{1F64F}"];
const BORED   = ["\u{1F971}","\u{1F644}"];

const TAUNT_POLL     = 700;    // ms between looks at the journal
const TAUNT_GAP      = 2200;   // ms the whole table stays quiet after any throw
const TAUNT_COOLDOWN = 9000;   // ms one bot stays quiet after its own
/* Every chance below is multiplied by this. Turned down from 1 because they
   were funny at the old rate and wearing at it — the joke is the timing, and
   timing needs gaps. One number rather than re-tuning a dozen, so the tuning
   underneath still reads as "how much does THIS deserve a laugh". */
const TAUNT_RATE     = 0.7;

let tauntTimer = null;
let seenEntry  = 0;            // newest journal entry any bot has reacted to
let lastTaunt  = 0;            // when anybody last threw one
let sawOver    = false;        // the end has been reacted to
const botQuiet = {};           // pid -> when that bot may throw again

function pickEmoji(list){
  const tray = (typeof EMOJIS !== "undefined") ? EMOJIS : null;
  const ok = tray ? list.filter(e => tray.indexOf(e) >= 0) : list;
  return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
}

/* One throw, if this bot is allowed one and the dice say so. Everything funnels
   through here so the rate limits cannot be got round by adding a trigger. */
function taunt(pid, list, chance){
  if (typeof pushEmote !== "function") return false;
  if (!agentOf(pid)) return false;                         // humans throw their own
  const now = Date.now();
  if (now - lastTaunt < TAUNT_GAP) return false;
  if ((botQuiet[pid] || 0) > now) return false;
  if (Math.random() > (chance === undefined ? 1 : chance) * TAUNT_RATE) return false;
  const e = pickEmoji(list);
  if (!e) return false;
  lastTaunt = now;
  botQuiet[pid] = now + TAUNT_COOLDOWN;
  pushEmote(pid, e);
  return true;
}

/* Every bot except the ones named, in a random order — so the same seat is
   not always the one that gets the joke in first. */
function otherBots(exclude){
  const out = [];
  for (const p of S.players){
    if (!agentOf(p.id)) continue;
    if (exclude.indexOf(p.id) >= 0) continue;
    out.push(p.id);
  }
  for (let i = out.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/* What one line of the record is worth reacting to. At most one throw comes
   out of any entry: the first seat that takes it ends the matter. */
function reactTo(e){
  const actor  = e.actor;
  const target = (e.target === null || e.target === undefined) ? -1 : e.target;

  // Somebody was named and something was done to them: a card with their name
  // on it, a knight's steal, a robbery. Not every one of these carries a card
  // — a robbery is a hex and a victim — so it is the target that decides, not
  // the card. The best joke at the table belongs to whoever threw it; failing
  // that, to whoever was hit; failing that, to anybody watching.
  if (target >= 0 && target !== actor){
    const loud = !!e.card;
    if (taunt(actor, JEER, loud ? 0.75 : 0.5)) return;
    if (taunt(target, HURT, 0.4)) return;
    for (const pid of otherBots([actor, target]))
      if (taunt(pid, JEER, loud ? 0.28 : 0.18)) return;
    return;
  }

  // A card that answered another card. Landing a Nope is the smuggest moment
  // available to anybody, bot or not.
  if (e.kind === "defend" || e.kind === "nope" || e.kind === "defuse"){
    if (taunt(actor, SMUG, 0.7)) return;
    for (const pid of otherBots([actor]))
      if (taunt(pid, JEER, 0.2)) return;
    return;
  }

  if (e.kind === "roll"){
    // A seven: everybody at the table is about to pay, so the roller is the
    // one seat with nothing to be sorry about.
    if (e.show === "seven"){
      if (taunt(actor, JEER, 0.6)) return;
      for (const pid of otherBots([actor]))
        if (taunt(pid, HURT, 0.3)) return;
      return;
    }
    // A roll nobody collected on. Read off the line rather than recomputed:
    // if that wording ever changes this joke goes quiet, and nothing else
    // about the game notices.
    if (String(e.plain || "").indexOf("nobody collects") >= 0){
      for (const pid of otherBots([]))
        if (taunt(pid, BORED, 0.3)) return;
    }
    return;
  }

  // Somebody bought a card, built something, took Longest Road off somebody.
  // Mild, and rare, or the strip is nothing but faces.
  if (e.kind === "buy" || e.kind === "big"){
    for (const pid of otherBots([actor]))
      if (taunt(pid, JEER, 0.12)) return;
  }
}

/* The end of the game, which is the one moment worth breaking the rate limit
   for: everyone gets to say something about it. */
function reactToEnd(){
  const winner = S.winner;
  const bots = otherBots([]);
  bots.forEach((pid, i) => {
    // Staggered, so it reads as a table reacting rather than one event. Thinned
    // by the same rate as everything else — not every seat has something to
    // say about it.
    if (pid !== winner && Math.random() > TAUNT_RATE) return;
    setTimeout(() => {
      if (!S || S.phase !== "over") return;
      const list = pid === winner ? SMUG
                 : (winner !== null && winner !== undefined && !agentOf(winner))
                     ? (Math.random() < 0.45 ? RESPECT : HURT)   // a human won
                     : HURT;
      const e = pickEmoji(list);
      if (e) pushEmote(pid, e);
    }, 400 + i * 650);
  });
}

function tauntTick(){
  if (!S || typeof pushEmote !== "function") return;
  // Online, only the host decides anything — including who is laughing.
  if (window.NET && NET.isGuest && NET.isGuest()) return;
  if (!S.players.some(p => agentOf(p.id))) return;

  const j = S.journal || [];
  // A fresh game, or one applied from elsewhere: the ids went backwards, so
  // nothing here has been seen. Catch up silently rather than react to a
  // whole game at once.
  if (j.length && j[j.length - 1].id < seenEntry){
    seenEntry = j[j.length - 1].id;
    return;
  }

  if (S.phase === "over"){
    if (!sawOver){ sawOver = true; reactToEnd(); }
    return;
  }
  sawOver = false;

  // Nothing to say during the opening placements — there is nothing to laugh
  // at yet, and six faces before the first roll is just noise.
  const quiet = !S.turnCounter || String(S.phase).indexOf("setup") === 0;

  for (const e of j){
    if (e.id <= seenEntry) continue;
    seenEntry = e.id;
    if (quiet || e.noped) continue;
    try { reactTo(e); } catch (err){ console.error("taunt failed:", err); }
  }
}

function startTaunts(){
  if (!tauntTimer) tauntTimer = setInterval(tauntTick, TAUNT_POLL);
  // Whatever is already on the record happened before anybody was watching.
  seenEntry = (S && S.journal && S.journal.length) ? S.journal[S.journal.length - 1].id : 0;
  sawOver = false;
}
function stopTaunts(){
  if (tauntTimer){ clearInterval(tauntTimer); tauntTimer = null; }
}

/* Somebody typed something. Bots cannot read it and would not care if they
   could, which is roughly the response it deserves. */
function heard(seat){
  if (!S || typeof pushEmote !== "function") return;
  if (window.NET && NET.isGuest && NET.isGuest()) return;
  if (agentOf(seat)) return;                       // bots do not answer bots
  const bots = otherBots([]);
  if (!bots.length) return;
  if (Math.random() > 0.4 * TAUNT_RATE) return;
  // A beat late, so it reads as an answer rather than an echo.
  setTimeout(() => {
    if (S) taunt(bots[0], Math.random() < 0.75 ? JEER : BORED, 1);
  }, 900 + Math.random() * 1400);
}

/* ══════════════════════════════════════════════════════════════════════════
   PUBLIC API
   ══════════════════════════════════════════════════════════════════════════ */

window.AI = {
  W,
  /* Seat 0 is the human by default; everyone else becomes a bot. */
  enable(humanSeats){
    const humans = humanSeats === undefined ? [0] : humanSeats;
    window.AGENTS = {};
    for (const p of S.players){
      if (humans.indexOf(p.id) === -1) window.AGENTS[p.id] = makeAgent(p.id);
    }
    logMsg("Bots enabled for " +
           S.players.filter(p => agentOf(p.id)).map(p => p.name).join(", ") + ".");
    startTaunts();
    render();
    window.botTick();
  },
  disable(){ window.AGENTS = {}; stopAll(); render(); },
  stop: stopAll, makeAgent,
  /* Called by the chat when somebody says something. */
  heard,
  pace(ms){ AI_PACE = ms; },

  /* Internals, exposed for diagnosis and weight tuning. */
  _dbg: { goal, planOptions, pickCardPayment, tryBankTrade, tryPlayerTrade,
          pickRoad, vpNearest, bestExpansion, expansionMap, reachValue,
          roadGoesSomewhere, longestRoadFor, dumpSurplus, shortfall,
          vertexValue, vertexValueFor, threat, production },

  /* Fairness assertion: the bot must not consult hidden information. */
  selfCheck(){
    const src = [vertexValue, vertexValueFor, threat, pickCardPlay, pickRobberHex,
                 nopeDecision, tryPlayerTrade].map(f => f.toString()).join("\n");
    const leaks = [];
    if (/\.cards\s*\[\s*\d/.test(src))           leaks.push("indexes another hand");
    if (/cards\.(find|filter|some)\([^)]*key/.test(src)) leaks.push("inspects card identities");
    if (/S\.deck\[/.test(src) || /S\.deck\.find/.test(src)) leaks.push("peeks at the deck");
    return { fair: leaks.length === 0, leaks };
  }
};

})();
