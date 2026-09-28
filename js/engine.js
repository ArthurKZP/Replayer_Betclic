/*
 * Moteur du replayer : transforme une main parsée en une chronologie
 * d'états de table (un état par étape affichable).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./evaluator.js'));
  } else {
    root.Replayer = root.Replayer || {};
    Object.assign(root.Replayer, factory(root.Replayer));
  }
})(typeof self !== 'undefined' ? self : this, function (evaluator) {
  'use strict';

  const r2 = (n) => Math.round(n * 100) / 100;
  const EPS = 0.001;

  const ACTION_LABELS = {
    post_sb: 'SB', post_bb: 'BB', post_ante: 'Ante', post_straddle: 'Straddle', post: 'Blinde',
    fold: 'Couché', check: 'Parole', call: 'Suit', bet: 'Mise', raise: 'Relance', allin: 'Tapis',
  };
  const DECISION_TYPES = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];
  const STREET_NAMES = { preflop: 'Préflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Abattage' };

  const MIDDLE_POSITIONS = {
    0: [], 1: ['UTG'], 2: ['UTG', 'CO'], 3: ['UTG', 'HJ', 'CO'], 4: ['UTG', 'LJ', 'HJ', 'CO'],
    5: ['UTG', 'MP', 'LJ', 'HJ', 'CO'], 6: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
    7: ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'],
  };

  function computePositions(players, buttonSeat) {
    const dealt = players.filter((p) => p.dealt).sort((a, b) => a.seat - b.seat);
    const n = dealt.length;
    const out = {};
    if (n < 2 || buttonSeat == null) return out;
    let idx = dealt.findIndex((p) => p.seat === buttonSeat);
    if (idx < 0) {
      // Bouton sur un siège vide : le "bouton" effectif est le dernier siège avant lui.
      idx = dealt.reduce((best, p, i) => (p.seat < buttonSeat ? i : best), n - 1);
    }
    const order = [];
    for (let k = 1; k <= n; k++) order.push(dealt[(idx + k) % n]);
    if (n === 2) {
      out[order[1].name] = 'BTN';
      out[order[0].name] = 'BB';
      return out;
    }
    out[order[0].name] = 'SB';
    out[order[1].name] = 'BB';
    out[order[n - 1].name] = 'BTN';
    const middle = MIDDLE_POSITIONS[n - 3] || [];
    for (let k = 0; k < n - 3; k++) out[order[2 + k].name] = middle[k] || 'MP';
    return out;
  }

  /** Pots principal / annexes à partir des contributions totales. */
  function computePots(players) {
    const live = players.filter((p) => !p.folded && p.invested > EPS);
    const levels = [...new Set(live.map((p) => r2(p.invested)))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of players) amount += Math.max(0, Math.min(p.invested, level) - Math.min(p.invested, prev));
      const eligible = live.filter((p) => p.invested >= level - EPS).map((p) => p.name);
      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length) last.amount = r2(last.amount + amount);
      else pots.push({ amount: r2(amount), eligible });
      prev = level;
    }
    // Contributions de joueurs couchés au-delà du dernier niveau.
    const extra = players.reduce((s, p) => s + Math.max(0, p.invested - prev), 0);
    if (extra > EPS && pots.length) pots[pots.length - 1].amount = r2(pots[pots.length - 1].amount + extra);
    return pots;
  }

  function buildTimeline(hand) {
    const acting = new Set();
    hand.streets.forEach((s) => s.actions.forEach((a) => acting.add(a.player)));

    let buttonSeat = hand.buttonSeat;
    const players = hand.players.map((p) => ({
      name: p.name,
      seat: p.seat,
      stack: p.stack,
      startStack: p.stack,
      bet: 0,
      invested: 0,
      folded: false,
      allIn: false,
      isHero: p.name === hand.heroName,
      dealt: !p.sittingOut && (acting.has(p.name) || p.name === hand.heroName || !!hand.holeCards[p.name]),
      cards: hand.holeCards[p.name] ? hand.holeCards[p.name].slice() : null,
      revealed: false,
      action: null,
      won: 0,
      isWinner: false,
      handName: null,
      bestCards: null,
    }));
    const byName = new Map(players.map((p) => [p.name, p]));

    if (buttonSeat == null) {
      const sbName = (hand.players.find((p) => p.isSB) || {}).name ||
        ((hand.streets[0] || { actions: [] }).actions.find((a) => a.type === 'post_sb') || {}).player;
      const sb = sbName && byName.get(sbName);
      if (sb) {
        const dealt = players.filter((p) => p.dealt).sort((a, b) => a.seat - b.seat);
        const i = dealt.indexOf(sb);
        buttonSeat = dealt.length === 2 ? sb.seat : dealt[(i - 1 + dealt.length) % dealt.length].seat;
      }
    }
    const positions = computePositions(players, buttonSeat);
    players.forEach((p) => { p.position = positions[p.name] || ''; });

    const st = { street: 'preflop', board: [], pot: 0, players, actor: null, pots: null };
    const steps = [];

    const snapshot = () => JSON.parse(JSON.stringify({
      street: st.street, board: st.board, pot: st.pot, players: st.players, actor: st.actor, pots: st.pots,
    }));
    const push = (event, extra) => {
      const s = Object.assign(snapshot(), { event }, extra || {});
      s.index = steps.length;
      steps.push(s);
      return s;
    };
    const maxBet = () => Math.max(0, ...players.map((p) => p.bet));

    function commit(p, amount) {
      const amt = r2(Math.max(0, Math.min(amount, p.stack)));
      p.stack = r2(p.stack - amt);
      p.bet = r2(p.bet + amt);
      p.invested = r2(p.invested + amt);
      if (p.stack <= EPS) p.allIn = true;
      return amt;
    }

    /** Applique une action ; renvoie l'événement, ou null si elle n'a pas d'effet visible. */
    function apply(a) {
      const p = byName.get(a.player);
      if (!p) return null;
      const before = maxBet();
      let added = 0;
      switch (a.type) {
        case 'post_ante': {
          const amt = r2(Math.min(a.amount || 0, p.stack));
          p.stack = r2(p.stack - amt);
          p.invested = r2(p.invested + amt);
          st.pot = r2(st.pot + amt);
          added = amt;
          if (p.stack <= EPS) p.allIn = true;
          break;
        }
        case 'post':
          if (a.dead) {
            const amt = r2(Math.min(a.amount || 0, p.stack));
            p.stack = r2(p.stack - amt);
            p.invested = r2(p.invested + amt);
            st.pot = r2(st.pot + amt);
            added = amt;
            break;
          }
        // falls through
        case 'post_sb':
        case 'post_bb':
        case 'post_straddle':
        case 'bet':
          added = commit(p, a.amount || 0);
          break;
        case 'call':
          added = commit(p, a.amount != null ? a.amount : before - p.bet);
          break;
        case 'raise': {
          let to = a.to;
          if (to == null) to = a.amount > before ? a.amount : before + (a.amount || 0);
          added = commit(p, to - p.bet);
          break;
        }
        case 'allin':
          added = commit(p, p.stack);
          break;
        case 'fold':
          p.folded = true;
          break;
        case 'check':
          break;
        case 'return': {
          const amt = r2(Math.min(a.amount || 0, p.bet));
          p.bet = r2(p.bet - amt);
          p.stack = r2(p.stack + amt);
          p.invested = r2(p.invested - amt);
          p.allIn = p.stack <= EPS;
          return { kind: 'return', player: p.name, amount: amt };
        }
        default:
          return null;
      }
      const type = p.allIn && ['call', 'bet', 'raise', 'allin'].includes(a.type) ? 'allin' : a.type;
      p.action = { type, label: ACTION_LABELS[type] || '', amount: p.bet };
      return {
        kind: 'action', type, originalType: a.type, player: p.name, amount: added, to: p.bet,
        street: st.street, time: a.time || null, raw: a.raw || '',
      };
    }

    /** Ramasse les mises dans le pot (avec restitution de la mise non suivie). */
    function collect() {
      const returned = [];
      const sorted = players.slice().sort((a, b) => b.bet - a.bet);
      if (sorted[0] && sorted[0].bet - ((sorted[1] && sorted[1].bet) || 0) > EPS) {
        const top = sorted[0];
        const excess = r2(top.bet - ((sorted[1] && sorted[1].bet) || 0));
        top.bet = r2(top.bet - excess);
        top.stack = r2(top.stack + excess);
        top.invested = r2(top.invested - excess);
        top.allIn = top.stack <= EPS;
        returned.push({ player: top.name, amount: excess });
      }
      let total = 0;
      for (const p of players) {
        total += p.bet;
        p.bet = 0;
      }
      st.pot = r2(st.pot + total);
      return returned;
    }

    function clearLabels() {
      for (const p of players) {
        if (p.folded) p.action = null;
        else if (p.allIn) p.action = { type: 'allin', label: 'Tapis', amount: 0 };
        else p.action = null;
      }
    }

    // --- Début de main : blindes/antes regroupées ---------------------------
    const preflop = hand.streets.find((s) => s.name === 'preflop') || { name: 'preflop', board: [], actions: [] };
    const posts = [];
    let start = 0;
    for (; start < preflop.actions.length; start++) {
      const a = preflop.actions[start];
      if (a.type.startsWith('post')) {
        const ev = apply(a);
        if (ev) posts.push(ev);
      } else if (a.type === 'sitin' || a.type === 'other') {
        continue;
      } else {
        break;
      }
    }
    push({ kind: 'start', posts, street: 'preflop' }, { anim: 'deal' });

    // --- Rues -----------------------------------------------------------------
    for (const street of hand.streets) {
      let actions = street.actions;
      if (street.name === 'preflop') {
        actions = preflop.actions.slice(start);
      } else {
        const returned = collect();
        const prevBoard = st.board;
        st.street = street.name;
        st.board = street.board.length ? street.board.slice() : prevBoard;
        st.actor = null;
        clearLabels();
        const newCards = st.board.slice(prevBoard.length);
        push({ kind: 'street', street: street.name, cards: newCards, board: st.board.slice(), returned });
      }
      for (const a of actions) {
        const decisionPlayer = byName.get(a.player);
        let decision = null;
        if (decisionPlayer && DECISION_TYPES.includes(a.type)) {
          const toCall = r2(Math.max(0, maxBet() - decisionPlayer.bet));
          decision = {
            player: decisionPlayer.name,
            toCall: Math.min(toCall, decisionPlayer.stack),
            stack: decisionPlayer.stack,
            pot: r2(st.pot + players.reduce((s, p) => s + p.bet, 0)),
            facingBet: toCall > EPS,
          };
        }
        const ev = apply(a);
        if (!ev) continue;
        st.actor = a.player;
        push(ev, decision ? { decision } : null);
      }
    }

    // --- Abattage ----------------------------------------------------------------
    const finalBoard = st.board.slice();
    const shows = (hand.shows || []).filter((s) => byName.has(s.player));
    let collected = false;
    if (shows.length) {
      const returned = collect();
      collected = true;
      st.street = 'showdown';
      st.actor = null;
      clearLabels();
      for (const s of shows) {
        const p = byName.get(s.player);
        if (s.cards && s.cards.length) p.cards = s.cards.slice();
        p.revealed = true;
        const best = p.cards ? evaluator.bestHand(p.cards.concat(finalBoard)) : null;
        p.handName = best && finalBoard.length >= 3 ? best.description : evaluator.translateHandName(s.handName) || (best && best.description);
        p.bestCards = s.bestCards && s.bestCards.length ? s.bestCards : best ? best.cards : null;
        p.action = { type: 'show', label: 'Montre', amount: 0 };
      }
      const pots = computePots(players);
      st.pots = pots.length > 1 ? pots : null;
      push({ kind: 'showdown', players: shows.map((s) => s.player), returned });
    }

    // --- Gains ------------------------------------------------------------------
    const wins = (hand.wins || []).filter((w) => byName.has(w.player));
    if (wins.length) {
      const returned = collected ? [] : collect();
      const totalPot = st.pot;
      st.actor = null;
      if (!collected) clearLabels();
      const merged = new Map();
      for (const w of wins) {
        const p = byName.get(w.player);
        p.stack = r2(p.stack + w.amount);
        p.won = r2(p.won + w.amount);
        p.isWinner = true;
        merged.set(p.name, r2((merged.get(p.name) || 0) + w.amount));
      }
      for (const [name, amount] of merged) {
        const p = byName.get(name);
        p.action = { type: 'win', label: 'Gagne', amount };
      }
      const paid = r2([...merged.values()].reduce((s, v) => s + v, 0));
      const rake = r2(Math.max(0, totalPot - paid));
      st.pot = 0;
      st.pots = null;
      st.street = shows.length ? 'showdown' : st.street;
      push({
        kind: 'win',
        winners: [...merged].map(([player, amount]) => ({ player, amount, handName: byName.get(player).handName })),
        totalPot,
        rake,
        returned,
      });
    }

    const results = players.map((p) => ({ name: p.name, net: r2(p.stack - p.startStack), won: p.won }));
    const streetStart = {};
    steps.forEach((s, i) => {
      const key = s.event.kind === 'showdown' || s.event.kind === 'win' ? 'showdown' : s.street;
      if (streetStart[key] == null) streetStart[key] = i;
    });

    return { hand, steps, results, streetStart, buttonSeat, positions };
  }

  /**
   * Phrase française décrivant un événement.
   * `fmt(amount)` formate un montant (en € ou en BB).
   */
  function describeEvent(ev, fmt, cardText) {
    const f = fmt || ((n) => String(n));
    const c = cardText || ((cards) => cards.join(' '));
    switch (ev.kind) {
      case 'start': {
        const blinds = ev.posts.filter((p) => p.type !== 'post_ante');
        return blinds.length
          ? 'Distribution — ' + blinds.map((p) => `${p.player} paie ${p.type === 'post_sb' ? 'la petite blinde' : p.type === 'post_bb' ? 'la grosse blinde' : 'une blinde'} (${f(p.amount)})`).join(', ')
          : 'Distribution des cartes';
      }
      case 'street': {
        const ret = (ev.returned || []).map((r) => ` · ${f(r.amount)} rendus à ${r.player}`).join('');
        return `${STREET_NAMES[ev.street] || ev.street} : ${c(ev.cards.length ? ev.cards : ev.board)}${ret}`;
      }
      case 'action':
        switch (ev.type) {
          case 'fold': return `${ev.player} se couche`;
          case 'check': return `${ev.player} checke`;
          case 'call': return `${ev.player} suit ${f(ev.amount)}`;
          case 'bet': return `${ev.player} mise ${f(ev.amount)}`;
          case 'raise': return `${ev.player} relance à ${f(ev.to)}`;
          case 'allin':
            return ev.originalType === 'call'
              ? `${ev.player} suit à tapis (${f(ev.amount)})`
              : `${ev.player} fait tapis (${f(ev.to)})`;
          case 'post_sb': return `${ev.player} paie la petite blinde (${f(ev.amount)})`;
          case 'post_bb': return `${ev.player} paie la grosse blinde (${f(ev.amount)})`;
          case 'post_ante': return `${ev.player} paie l'ante (${f(ev.amount)})`;
          case 'post_straddle': return `${ev.player} straddle (${f(ev.amount)})`;
          default: return `${ev.player} paie ${f(ev.amount)}`;
        }
      case 'return':
        return `${f(ev.amount)} rendus à ${ev.player}`;
      case 'showdown':
        return 'Abattage';
      case 'win':
        return ev.winners
          .map((w) => `${w.player} remporte ${f(w.amount)}${w.handName ? ' avec ' + w.handName : ''}`)
          .join(' · ');
      default:
        return '';
    }
  }

  return { buildTimeline, describeEvent, computePots, computePositions, STREET_NAMES, ACTION_LABELS };
});
