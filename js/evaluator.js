/*
 * Évaluateur de mains Texas Hold'em (5 à 7 cartes) avec descriptions en français.
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

  const RANKS = '23456789TJQKA';
  const SINGULAR = { A: 'As', K: 'Roi', Q: 'Dame', J: 'Valet', T: '10' };
  const PLURAL = { A: 'As', K: 'Rois', Q: 'Dames', J: 'Valets', T: '10' };
  const CATEGORY_NAMES = [
    'Hauteur', 'Paire', 'Deux paires', 'Brelan', 'Quinte',
    'Couleur', 'Full', 'Carré', 'Quinte flush',
  ];

  const value = (card) => RANKS.indexOf(card[0]) + 2;
  const rankChar = (v) => RANKS[v - 2];
  const one = (v) => SINGULAR[rankChar(v)] || rankChar(v);
  const many = (v) => PLURAL[rankChar(v)] || rankChar(v);
  const de = (word) => (/^[AEIOUY]/i.test(word) ? "d'" + word : 'de ' + word);
  const aux = (word) => 'aux ' + word;

  function evaluate5(cards) {
    const vals = cards.map(value).sort((a, b) => b - a);
    const flush = cards.every((c) => c[1] === cards[0][1]);
    const counts = new Map();
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

    let straightHigh = 0;
    const uniq = [...new Set(vals)];
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5;
    }

    if (straightHigh && flush) return [8, straightHigh];
    if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
    if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
    if (flush) return [5, ...vals];
    if (straightHigh) return [4, straightHigh];
    if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map((g) => g[0])];
    if (groups[0][1] === 2 && groups[1][1] === 2) return [2, groups[0][0], groups[1][0], groups[2][0]];
    if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map((g) => g[0])];
    return [0, ...vals];
  }

  function compareScores(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  function combinations(arr, k) {
    const out = [];
    const pick = (start, acc) => {
      if (acc.length === k) {
        out.push(acc.slice());
        return;
      }
      for (let i = start; i <= arr.length - (k - acc.length); i++) {
        acc.push(arr[i]);
        pick(i + 1, acc);
        acc.pop();
      }
    };
    pick(0, []);
    return out;
  }

  function describe(score) {
    const [cat, a, b] = score;
    switch (cat) {
      case 8: return a === 14 ? 'Quinte flush royale' : `Quinte flush hauteur ${one(a)}`;
      case 7: return `Carré ${de(many(a))}`;
      case 6: return `Full ${aux(many(a))} par les ${many(b)}`;
      case 5: return `Couleur hauteur ${one(a)}`;
      case 4: return `Quinte hauteur ${one(a)}`;
      case 3: return `Brelan ${de(many(a))}`;
      case 2: return `Deux paires, ${many(a)} et ${many(b)}`;
      case 1: return `Paire ${de(many(a))}`;
      default: return `Hauteur ${one(a)}`;
    }
  }

  /** Cartes qui "font" la main (utile pour les surligner). */
  function keyCards(cards, score) {
    const cat = score[0];
    if ([4, 5, 6, 8].includes(cat)) return cards.slice();
    if (cat === 0) return cards.filter((c) => value(c) === score[1]);
    const counts = {};
    cards.forEach((c) => { counts[value(c)] = (counts[value(c)] || 0) + 1; });
    return cards.filter((c) => counts[value(c)] >= 2);
  }

  /**
   * Meilleure main de 5 cartes parmi 2 à 7 cartes.
   * Avec moins de 5 cartes (préflop), on décrit simplement paire / hauteur.
   */
  function bestHand(cards) {
    const list = (cards || []).filter(Boolean);
    if (list.length < 2) return null;
    if (list.length < 5) {
      const vals = list.map(value).sort((x, y) => y - x);
      const pair = vals.find((v, i) => vals.indexOf(v) !== i);
      const score = pair ? [1, pair] : [0, ...vals];
      return { score, category: score[0], name: CATEGORY_NAMES[score[0]], description: describe(score), cards: list, key: pair ? list.filter((c) => value(c) === pair) : [] };
    }
    let best = null;
    for (const combo of combinations(list, 5)) {
      const score = evaluate5(combo);
      if (!best || compareScores(score, best.score) > 0) best = { score, cards: combo };
    }
    return {
      score: best.score,
      category: best.score[0],
      name: CATEGORY_NAMES[best.score[0]],
      description: describe(best.score),
      cards: best.cards,
      key: keyCards(best.cards, best.score),
    };
  }

  const ENGLISH_NAMES = {
    'high card': 'Hauteur', 'one pair': 'Paire', pair: 'Paire', 'two pair': 'Deux paires', 'two pairs': 'Deux paires',
    'three of a kind': 'Brelan', trips: 'Brelan', set: 'Brelan', straight: 'Quinte', flush: 'Couleur',
    'full house': 'Full', 'four of a kind': 'Carré', quads: 'Carré', 'straight flush': 'Quinte flush',
    'royal flush': 'Quinte flush royale',
  };

  function translateHandName(name) {
    if (!name) return '';
    return ENGLISH_NAMES[String(name).trim().toLowerCase()] || name;
  }

  return { bestHand, compareScores, translateHandName, HAND_CATEGORY_NAMES: CATEGORY_NAMES };
});
