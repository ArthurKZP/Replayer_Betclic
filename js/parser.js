/*
 * Parseur d'historiques de mains Betclic Poker (export "Hands_Export").
 *
 * Transforme le texte brut en un objet "hand" normalisé, indépendant de
 * l'affichage, consommé ensuite par le moteur (engine.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Replayer = root.Replayer || {};
    Object.assign(root.Replayer, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SECTION_RE = /^\*{3}\s*(.+?)\s*\*{3}\s*(.*)$/;
  const TIME_PREFIX_RE = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*/;
  const AMOUNT_SRC = '[€$£]?\\s*\\d[\\d\\s.,]*\\s*[€$£]?';

  /** Convertit "€1,234.50", "2,50 €", "1500" en nombre (arrondi au centime). */
  function parseAmount(input) {
    if (input == null) return null;
    let t = String(input).replace(/[€$£\s  ]/g, '');
    const m = t.match(/-?\d[\d.,]*/);
    if (!m) return null;
    t = m[0].replace(/[.,]$/, '');
    const dots = (t.match(/\./g) || []).length;
    const commas = (t.match(/,/g) || []).length;
    if (dots && commas) {
      t = t.lastIndexOf(',') > t.lastIndexOf('.')
        ? t.replace(/\./g, '').replace(',', '.')
        : t.replace(/,/g, '');
    } else if (commas) {
      const decimals = t.length - t.lastIndexOf(',') - 1;
      t = commas > 1 || decimals === 3 ? t.replace(/,/g, '') : t.replace(',', '.');
    } else if (dots > 1) {
      t = t.replace(/\./g, '');
    }
    const n = parseFloat(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function lastAmount(text) {
    const all = String(text).match(new RegExp(AMOUNT_SRC, 'g'));
    return all ? parseAmount(all[all.length - 1]) : null;
  }

  /** Normalise une carte : "10h" -> "Th", "AS" -> "As". Renvoie null si invalide. */
  function normalizeCard(raw) {
    let c = String(raw).trim();
    if (!c) return null;
    c = c.replace(/^10/, 'T');
    const rank = c[0].toUpperCase();
    const suit = (c[1] || '').toLowerCase();
    if (!/[2-9TJQKA]/.test(rank) || !/[shdc]/.test(suit)) return null;
    return rank + suit;
  }

  function parseCardList(text) {
    return String(text || '')
      .split(/[\s,]+/)
      .map(normalizeCard)
      .filter(Boolean);
  }

  function bracketGroups(text) {
    const groups = [];
    String(text).replace(/\[([^\]]*)\]/g, (_, inner) => {
      groups.push(inner);
      return '';
    });
    return groups;
  }

  function detectCurrency(text) {
    const m = String(text).match(/[€$£]/);
    return m ? m[0] : '';
  }

  function streetKey(title) {
    const t = title.toUpperCase().replace(/[^A-Z]/g, '');
    if (t === 'HEADER') return 'header';
    if (t === 'PLAYERS') return 'players';
    if (t === 'HOLECARDS') return 'holecards';
    if (t === 'PREFLOP') return 'preflop';
    if (t.startsWith('FLOP')) return 'flop';
    if (t.startsWith('TURN')) return 'turn';
    if (t.startsWith('RIVER')) return 'river';
    if (t.startsWith('SHOWDOWN')) return 'showdown';
    if (t === 'SUMMARY') return 'summary';
    return 'other';
  }

  /** Trouve le joueur dont le nom préfixe `text` (le plus long gagne). */
  function matchPlayerPrefix(text, names, separators) {
    let best = null;
    for (const name of names) {
      if (!text.startsWith(name)) continue;
      const next = text.slice(name.length, name.length + 1);
      if (next === '' || separators.includes(next)) {
        if (!best || name.length > best.length) best = name;
      }
    }
    return best;
  }

  /** Interprète le texte d'une action ("Raises to €12.50", "Folds"...). */
  function parseActionText(text) {
    const t = text.trim();
    const lower = t.toLowerCase();
    const allIn = /all[\s-]?in|tapis/.test(lower);
    let m;

    if ((m = lower.match(/^posts?\s+(?:the\s+)?(small blind|sb)\b/))) {
      return { type: 'post_sb', amount: lastAmount(t), allIn };
    }
    if ((m = lower.match(/^posts?\s+(?:the\s+)?(big blind|bb)\b/))) {
      return { type: 'post_bb', amount: lastAmount(t), allIn };
    }
    if (/^posts?\s+(?:an?\s+)?ante\b/.test(lower)) {
      return { type: 'post_ante', amount: lastAmount(t), allIn };
    }
    if (/^posts?\s+(?:a\s+)?straddle\b/.test(lower)) {
      return { type: 'post_straddle', amount: lastAmount(t), allIn };
    }
    if (/^posts?\b/.test(lower)) {
      return { type: 'post', amount: lastAmount(t), dead: /dead/.test(lower), allIn };
    }
    if (/^folds?\b/.test(lower)) return { type: 'fold' };
    if (/^checks?\b/.test(lower)) return { type: 'check' };
    if (/^calls?\b/.test(lower)) return { type: 'call', amount: lastAmount(t), allIn };
    if (/^bets?\b/.test(lower)) return { type: 'bet', amount: lastAmount(t), allIn };
    if (/^raises?\b/.test(lower)) {
      const to = t.match(new RegExp('\\bto\\s+(' + AMOUNT_SRC + ')', 'i'));
      if (to) return { type: 'raise', to: parseAmount(to[1]), allIn };
      return { type: 'raise', amount: lastAmount(t), raiseBy: true, allIn };
    }
    if (/^(?:goes\s+)?all[\s-]?in\b|^tapis\b/.test(lower)) {
      return { type: 'allin', amount: lastAmount(t), allIn: true };
    }
    if (/^(?:returns?|gets back|uncalled|is returned|receives back)\b/.test(lower)) {
      return { type: 'return', amount: lastAmount(t) };
    }
    if (/^shows?\b/.test(lower)) {
      const groups = bracketGroups(t);
      const label = (t.match(/\(([^)]*)\)/) || [])[1] || '';
      return {
        type: 'show',
        cards: parseCardList(groups[0]),
        handName: label.trim(),
        bestCards: parseCardList(groups[1]),
      };
    }
    if (/^mucks?\b|^doesn't show|^does not show/.test(lower)) return { type: 'muck' };
    if (/^(?:wins|won|collects?|collected|takes)\b/.test(lower)) {
      return { type: 'win', amount: lastAmount(t), pot: potLabel(t) };
    }
    if (/^sits?\s+in\b|^is back|^returns to the table/.test(lower)) return { type: 'sitin' };
    if (/^sits?\s+out\b|^is sitting out|^leaves|^joins|^is disconnected|^is connected|^has timed out|^time bank/.test(lower)) {
      return { type: 'noise' };
    }
    return { type: 'other' };
  }

  function potLabel(text) {
    const lower = String(text).toLowerCase();
    const side = lower.match(/side\s*pot\s*[-#]?\s*(\d+)?/);
    if (side) return side[1] ? 'side' + side[1] : 'side';
    if (/main\s*pot/.test(lower)) return 'main';
    return 'pot';
  }

  function parseHeader(lines) {
    const header = {};
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      header[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return header;
  }

  function parsePlayers(lines) {
    const players = [];
    const re = /^Seat\s+(\d+)\s*:\s*(.+)\s+\(([^()]*\d[^()]*)\)\s*(?:\[([^\]]*)\])?\s*(.*)$/i;
    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      const tags = (m[4] || '').split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase());
      players.push({
        seat: parseInt(m[1], 10),
        name: m[2].trim(),
        stack: parseAmount(m[3]) || 0,
        tags,
        isHero: tags.includes('HERO'),
        isButton: tags.includes('BTN') || tags.includes('BUTTON') || tags.includes('D'),
        isSB: tags.includes('SB'),
        isBB: tags.includes('BB'),
        sittingOut: /sitting out|sit out/i.test(m[5] || ''),
      });
    }
    return players;
  }

  function guessMaxSeats(header, players) {
    const name = `${header['Game Name'] || ''} ${header['Table Name'] || ''} ${header['Max Players'] || ''}`;
    const m = name.match(/(\d{1,2})\s*-?\s*max/i) || name.match(/^\s*(\d{1,2})\s*$/);
    const maxSeat = Math.max(0, ...players.map((p) => p.seat));
    let n = m ? parseInt(m[1], 10) : 0;
    if (!n || n < maxSeat) {
      n = maxSeat <= 2 ? 2 : maxSeat <= 6 ? 6 : maxSeat <= 9 ? 9 : 10;
    }
    return Math.min(Math.max(n, 2), 10);
  }

  /** Découpe un export contenant plusieurs mains. */
  function splitHands(text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
    const chunks = normalized.split(/(?=^\*{3}\s*HEADER\s*\*{3})/im);
    return chunks.map((c) => c.trim()).filter((c) => /\*{3}\s*PLAYERS\s*\*{3}/i.test(c));
  }

  function parseHand(text) {
    const raw = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '').trim();
    const lines = raw.split('\n').map((l) => l.trim());
    const sections = [];
    let current = { key: 'header', title: 'HEADER', extra: '', lines: [] };
    sections.push(current);
    for (const line of lines) {
      if (!line) continue;
      const m = line.match(SECTION_RE);
      if (m) {
        current = { key: streetKey(m[1]), title: m[1], extra: m[2] || '', lines: [] };
        sections.push(current);
      } else {
        current.lines.push(line);
      }
    }

    const byKey = (k) => sections.filter((s) => s.key === k);
    const header = parseHeader(byKey('header').flatMap((s) => s.lines));
    const players = parsePlayers(byKey('players').flatMap((s) => s.lines));
    if (!players.length) {
      throw new Error('Aucun joueur trouvé : vérifiez que le texte est un historique de main Betclic complet.');
    }
    const names = players.map((p) => p.name);

    const currency = detectCurrency(header['Blinds'] || '') || detectCurrency(header['Total Pot'] || '') ||
      detectCurrency(byKey('players').flatMap((s) => s.lines).join(' '));
    const blindParts = String(header['Blinds'] || header['Stakes'] || '').split('/').map(parseAmount);
    let sb = blindParts[0] || 0;
    let bb = blindParts[1] || 0;
    const ante = blindParts[2] || parseAmount(header['Ante']) || 0;

    const holeCards = {};
    for (const line of byKey('holecards').flatMap((s) => s.lines)) {
      const name = matchPlayerPrefix(line, names, [':', ' ']);
      const groups = bracketGroups(line);
      if (name && groups.length) holeCards[name] = parseCardList(groups[0]);
    }

    const streets = [];
    const extras = []; // show / muck / win hors des rues
    const boardByStreet = {};

    for (const section of sections) {
      if (!['preflop', 'flop', 'turn', 'river', 'showdown', 'summary', 'other'].includes(section.key)) continue;
      const isStreet = ['preflop', 'flop', 'turn', 'river'].includes(section.key);
      const street = isStreet ? { name: section.key, board: [], actions: [] } : null;
      if (street && section.key !== 'preflop') {
        street.board = parseCardList(bracketGroups(section.extra).join(' '));
        boardByStreet[section.key] = street.board;
      }

      for (const line of section.lines) {
        let rest = line;
        let time = null;
        const tm = rest.match(TIME_PREFIX_RE);
        if (tm) {
          time = tm[1];
          rest = rest.slice(tm[0].length);
        }

        const uncalled = rest.match(new RegExp('^uncalled bet\\s*\\(?\\s*(' + AMOUNT_SRC + ')\\s*\\)?\\s*returned to\\s+(.+)$', 'i'));
        if (uncalled) {
          const who = matchPlayerPrefix(uncalled[2].trim(), names, []);
          if (who) {
            const action = { type: 'return', player: who, amount: parseAmount(uncalled[1]), time, raw: line };
            (street ? street.actions : extras).push(Object.assign(action, { section: section.key }));
          }
          continue;
        }

        const player = matchPlayerPrefix(rest, names, [':', ' ']);
        if (!player) continue;
        const actionText = rest.slice(player.length).replace(/^\s*:\s*/, '').trim();
        const parsed = parseActionText(actionText);
        if (parsed.type === 'noise') continue;
        const action = Object.assign({ player, time, raw: line, section: section.key }, parsed);

        if (street && !['show', 'muck', 'win'].includes(parsed.type)) {
          street.actions.push(action);
        } else if (['show', 'muck', 'win'].includes(parsed.type)) {
          extras.push(action);
        }
      }
      if (street) streets.push(street);
    }

    // Les gains : on privilégie les lignes hors SUMMARY (évite les doublons façon PokerStars).
    const winsOutside = extras.filter((a) => a.type === 'win' && a.section !== 'summary');
    const winsSummary = extras.filter((a) => a.type === 'win' && a.section === 'summary');
    const wins = (winsOutside.length ? winsOutside : winsSummary).map((a) => ({
      player: a.player,
      amount: a.amount || 0,
      pot: a.pot || 'pot',
    }));

    const shows = [];
    const seenShow = new Set();
    for (const a of extras) {
      if (a.type !== 'show' || seenShow.has(a.player)) continue;
      seenShow.add(a.player);
      shows.push({ player: a.player, cards: a.cards, handName: a.handName, bestCards: a.bestCards });
      if (a.cards && a.cards.length && !holeCards[a.player]) holeCards[a.player] = a.cards;
    }
    const mucks = extras.filter((a) => a.type === 'muck').map((a) => a.player);

    // Blindes absentes de l'en-tête : on les déduit des posts.
    const pre = streets.find((s) => s.name === 'preflop');
    if (pre) {
      if (!sb) sb = (pre.actions.find((a) => a.type === 'post_sb') || {}).amount || 0;
      if (!bb) bb = (pre.actions.find((a) => a.type === 'post_bb') || {}).amount || 0;
    }

    let hero = players.find((p) => p.isHero);
    const button = players.find((p) => p.isButton);

    const board = boardByStreet.river || boardByStreet.turn || boardByStreet.flop || [];

    return {
      raw,
      site: header['Site'] || 'Betclic',
      gameMode: header['Game Mode'] || '',
      gameType: header['Game Type'] || '',
      gameName: header['Game Name'] || '',
      gameId: header['Game ID'] || '',
      handId: header['Hand ID'] || '',
      tableId: header['Table ID'] || '',
      dateTime: header['Date & Time'] || header['Date'] || '',
      header,
      currency,
      sb,
      bb,
      ante,
      totalPot: parseAmount(header['Total Pot']),
      rake: parseAmount(header['Rake']) || 0,
      maxSeats: guessMaxSeats(header, players),
      players,
      heroName: hero ? hero.name : null,
      buttonSeat: button ? button.seat : null,
      holeCards,
      streets,
      board,
      shows,
      mucks,
      wins,
    };
  }

  function parseHands(text) {
    const chunks = splitHands(text);
    const hands = [];
    const errors = [];
    for (const chunk of chunks) {
      try {
        hands.push(parseHand(chunk));
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (!chunks.length) {
      // Pas de "*** HEADER ***" : on tente quand même le texte entier.
      try {
        hands.push(parseHand(text));
      } catch (e) {
        errors.push(e.message);
      }
    }
    return { hands, errors };
  }

  return { parseAmount, normalizeCard, parseCardList, parseActionText, parseHand, parseHands, splitHands };
});
