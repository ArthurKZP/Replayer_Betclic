'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseHand, parseHands, parseAmount } = require('../js/parser.js');
const { buildTimeline, computePots, describeEvent } = require('../js/engine.js');
const { bestHand } = require('../js/evaluator.js');

const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'samples', 'betclic-exemple.txt'), 'utf8');

const stackOf = (step, name) => step.players.find((p) => p.name === name).stack;

test('parseAmount gère les formats courants', () => {
  assert.equal(parseAmount('€2.50'), 2.5);
  assert.equal(parseAmount('2,50 €'), 2.5);
  assert.equal(parseAmount('€1,234.56'), 1234.56);
  assert.equal(parseAmount('1 500'), 1500);
  assert.equal(parseAmount('1.234,5'), 1234.5);
  assert.equal(parseAmount('(€568.45)'), 568.45);
});

test("la main d'exemple Betclic est entièrement lue", () => {
  const h = parseHand(SAMPLE);
  assert.equal(h.handId, '01M3JB4H4V2H363FS9ETEQ7AY7');
  assert.equal(h.sb, 2.5);
  assert.equal(h.bb, 5);
  assert.equal(h.currency, '€');
  assert.equal(h.maxSeats, 6);
  assert.equal(h.heroName, 'VlCTORlOUS');
  assert.equal(h.buttonSeat, 3);
  assert.equal(h.players.length, 6);
  assert.deepEqual(h.holeCards.VlCTORlOUS, ['9s', '9h']);
  assert.deepEqual(h.holeCards.Amyris, ['Ah', 'Qc']);
  assert.deepEqual(h.board, ['Th', 'Ts', '6c', '7c', '7s']);
  assert.deepEqual(h.streets.map((s) => s.name), ['preflop', 'flop', 'turn', 'river']);
  assert.equal(h.shows.length, 2);
  assert.deepEqual(h.wins, [{ player: 'VlCTORlOUS', amount: 206, pot: 'main' }]);
  // Les "Sits in" sont conservés comme bruit mais ne comptent pas comme actions de jeu.
  const pre = h.streets[0].actions.filter((a) => a.type !== 'sitin');
  assert.deepEqual(pre.map((a) => a.type), ['post_sb', 'post_bb', 'fold', 'fold', 'raise', 'fold', 'raise', 'fold', 'call']);
});

test('la chronologie reproduit les montants de la main', () => {
  const tl = buildTimeline(parseHand(SAMPLE));
  const { steps } = tl;
  assert.equal(steps.length, 19);
  assert.equal(steps[0].event.kind, 'start');
  assert.equal(stackOf(steps[0], 'VlCTORlOUS'), 497.5);
  assert.equal(stackOf(steps[0], 'LAB00N'), 563.45);

  const flop = steps[tl.streetStart.flop];
  assert.equal(flop.pot, 105);
  assert.deepEqual(flop.board, ['Th', 'Ts', '6c']);

  const showdown = steps[tl.streetStart.showdown];
  assert.equal(showdown.pot, 210);
  assert.ok(showdown.players.find((p) => p.name === 'Amyris').revealed);

  const end = steps[steps.length - 1];
  assert.equal(end.event.kind, 'win');
  assert.equal(end.event.totalPot, 210);
  assert.equal(end.event.rake, 4);
  assert.equal(stackOf(end, 'VlCTORlOUS'), 603.5);
  assert.equal(stackOf(end, 'Amyris'), 422.5);

  const net = Object.fromEntries(tl.results.map((r) => [r.name, r.net]));
  assert.equal(net.VlCTORlOUS, 103.5);
  assert.equal(net.Amyris, -102.5);
  assert.equal(net.LAB00N, -5);

  assert.equal(tl.positions.VlCTORlOUS, 'SB');
  assert.equal(tl.positions.Amyris, 'CO');
  assert.equal(tl.positions.Cidfaf, 'BTN');
  assert.equal(tl.positions.LeCadreSUP, 'UTG');
});

test('les décisions du héros sont repérées avec le montant à payer', () => {
  const tl = buildTimeline(parseHand(SAMPLE));
  const heroSteps = tl.steps.filter((s) => s.decision && s.decision.player === 'VlCTORlOUS');
  assert.deepEqual(heroSteps.map((s) => s.event.type), ['raise', 'bet', 'check', 'check']);
  assert.equal(heroSteps[0].decision.toCall, 10);
  assert.equal(heroSteps[0].decision.pot, 20);
  assert.equal(heroSteps[1].decision.facingBet, false);
});

test('descriptions françaises des événements', () => {
  const tl = buildTimeline(parseHand(SAMPLE));
  const f = (n) => `${n} €`;
  const texts = tl.steps.map((s) => describeEvent(s.event, f));
  assert.ok(texts.includes('Amyris relance à 12.5 €'));
  assert.ok(texts.includes('Amyris suit 37.5 €'));
  assert.ok(texts.includes('VlCTORlOUS mise 52.5 €'));
  assert.equal(texts[texts.length - 1], 'VlCTORlOUS remporte 206 € avec Deux paires, 10 et 9');
});

const ALLIN_HAND = `*** HEADER ***
Site: Betclic.fr
Game Mode: Cash Game
Game Type: NL Texas Hold'em
Game Name: NLHE 0.5/1 6 max
Hand ID: TESTALLIN
Date & Time: 2026-09-27 20:00:00 (UTC)
Blinds: €0.50/€1.00
Total Pot: €230.00
Rake: €0.00
*** PLAYERS ***
Seat 1: Court (€30.00) [BTN]
Seat 2: Moyen (€100.00) [SB]
Seat 3: Hero (€150.00) [BB Hero]
*** HOLE CARDS ***
Hero: [Ac Ad]
*** PRE-FLOP ***
20:00:00 - Moyen: Posts SB €0.50
20:00:00 - Hero: Posts BB €1.00
20:00:02 - Court: Raises to €30.00 (all-in)
20:00:04 - Moyen: Raises to €100.00 and is all-in
20:00:06 - Hero: Calls €99.00
*** FLOP *** [2c 7d 9h]
*** TURN *** [2c 7d 9h Js]
*** RIVER *** [2c 7d 9h Js 3s]
*** SHOWDOWN ***
Hero shows [Ac Ad] (One Pair) [Ac Ad Js 9h 7d]
Moyen shows [Kc Kd] (One Pair) [Kc Kd Js 9h 7d]
Court shows [Qc Qd] (One Pair) [Qc Qd Js 9h 7d]
*** SUMMARY ***
Hero wins main pot of €90.00
Hero wins side pot 1 of €140.00
`;

test('tapis multiples : pots annexes et gains cumulés', () => {
  const h = parseHand(ALLIN_HAND);
  const tl = buildTimeline(h);
  const showdown = tl.steps[tl.streetStart.showdown];
  assert.equal(showdown.pot, 230);
  assert.deepEqual(showdown.pots.map((p) => p.amount), [90, 140]);
  const end = tl.steps[tl.steps.length - 1];
  assert.equal(stackOf(end, 'Hero'), 280);
  assert.equal(stackOf(end, 'Court'), 0);
  const court = end.players.find((p) => p.name === 'Court');
  assert.ok(court.allIn);
  const moyenStep = tl.steps.find((s) => s.event.player === 'Moyen' && s.event.kind === 'action' && s.event.type === 'allin');
  assert.ok(moyenStep, 'la relance à tapis est marquée comme tapis');
  const showdownHand = showdown.players.find((p) => p.name === 'Hero').handName;
  assert.equal(showdownHand, "Paire d'As");
});

const WALK_HAND = `*** HEADER ***
Site: Betclic.fr
Game Mode: Cash Game
Game Type: NL Texas Hold'em
Game Name: NLHE 0.5/1 6 max
Hand ID: TESTFOLD
Date & Time: 2026-09-27 20:05:00 (UTC)
Blinds: €0.50/€1.00
Total Pot: €3.50
Rake: €0.00
*** PLAYERS ***
Seat 1: Alpha (€100.00) [BTN Hero]
Seat 2: Bravo (€100.00) [SB]
Seat 4: Charlie (€100.00) [BB]
*** HOLE CARDS ***
Alpha: [Kh Qh]
*** PRE-FLOP ***
20:05:00 - Bravo: Posts SB €0.50
20:05:00 - Charlie: Posts BB €1.00
20:05:02 - Alpha: Raises to €3.00
20:05:03 - Bravo: Folds
20:05:04 - Charlie: Calls €2.00
*** FLOP *** [Kd 8c 2s]
20:05:08 - Charlie: Checks
20:05:10 - Alpha: Bets €4.00
20:05:12 - Charlie: Folds
*** SUMMARY ***
Alpha wins main pot of €6.50
`;

test('main gagnée sans abattage : la mise non suivie est rendue', () => {
  const h = parseHand(WALK_HAND);
  assert.equal(h.maxSeats, 6);
  const tl = buildTimeline(h);
  const end = tl.steps[tl.steps.length - 1];
  assert.equal(end.event.kind, 'win');
  assert.deepEqual(end.event.returned, [{ player: 'Alpha', amount: 4 }]);
  assert.equal(end.event.totalPot, 6.5);
  assert.equal(stackOf(end, 'Alpha'), 103.5);
  assert.equal(tl.streetStart.showdown, tl.steps.length - 1);
});

test('plusieurs mains dans un même export', () => {
  const { hands, errors } = parseHands(SAMPLE + '\n\n' + WALK_HAND + '\n' + ALLIN_HAND);
  assert.deepEqual(errors, []);
  assert.deepEqual(hands.map((h) => h.handId), ['01M3JB4H4V2H363FS9ETEQ7AY7', 'TESTFOLD', 'TESTALLIN']);
});

test('texte invalide : message clair', () => {
  const { hands, errors } = parseHands('bonjour');
  assert.equal(hands.length, 0);
  assert.match(errors[0], /Aucun joueur/);
});

test('évaluateur : catégories et descriptions', () => {
  const d = (cards) => bestHand(cards.split(' ')).description;
  assert.equal(d('9s 9h Th Ts 6c 7c 7s'), 'Deux paires, 10 et 9');
  assert.equal(d('Ah Qc Th Ts 6c 7c 7s'), 'Deux paires, 10 et 7');
  assert.equal(d('Ah Kh Qh Jh Th 2c 3d'), 'Quinte flush royale');
  assert.equal(d('Ah 2c 3d 4s 5h Kd Kc'), 'Quinte hauteur 5');
  assert.equal(d('7h 7d 7c Ts Td 2c 3d'), 'Full aux 7 par les 10');
  assert.equal(d('Ah Ad Ac As 2c 3d 4h'), "Carré d'As");
  assert.equal(d('2h 5h 9h Jh Kh Ac Ad'), 'Couleur hauteur Roi');
  assert.equal(d('Qc Qd'), 'Paire de Dames');
  assert.equal(d('Ac Kd 7h 5s 2c'), 'Hauteur As');
});

test('computePots sépare les pots selon les tapis', () => {
  const pots = computePots([
    { name: 'A', invested: 30, folded: false },
    { name: 'B', invested: 100, folded: false },
    { name: 'C', invested: 100, folded: false },
    { name: 'D', invested: 10, folded: true },
  ]);
  assert.deepEqual(pots, [
    { amount: 100, eligible: ['A', 'B', 'C'] },
    { amount: 140, eligible: ['B', 'C'] },
  ]);
});

const share = require('../js/share.js');

test('lien de partage : la main fait l\'aller-retour sans perte', async () => {
  const url = await share.shareUrl(SAMPLE, { base: 'https://exemple.fr/replayer/', step: 9, seat: 2 });
  assert.match(url, /^https:\/\/exemple\.fr\/replayer\/#m=z[A-Za-z0-9_-]+&s=9&v=2$/);
  assert.ok(url.length < 1500, `lien trop long (${url.length} caractères)`);
  const link = share.parseShareHash(url.slice(url.indexOf('#')));
  assert.equal(link.step, 9);
  assert.equal(link.seat, 2);
  const text = await share.decodeHand(link.token);
  assert.equal(text, SAMPLE);
  assert.equal(parseHand(text).handId, '01M3JB4H4V2H363FS9ETEQ7AY7');
});

test('lien de partage : options absentes et fragments invalides', async () => {
  const url = await share.shareUrl('abc', { base: 'https://exemple.fr/' });
  assert.doesNotMatch(url, /[&](s|v)=/);
  assert.deepEqual(share.parseShareHash(url.slice(url.indexOf('#'))), { token: url.split('#m=')[1], step: null, seat: null });
  assert.equal(share.parseShareHash('#section'), null);
  assert.equal(share.parseShareHash(''), null);
});

test('lien de partage : adresse publique quand la page est locale ou intégrée', () => {
  const at = (href) => new URL(href);
  assert.equal(share.shareBase(at('file:///C:/Replayer/index.html'), false), share.PUBLIC_URL);
  assert.equal(share.shareBase(at('http://localhost:8080/'), false), share.PUBLIC_URL);
  assert.equal(share.shareBase(at('https://arthurkzp.github.io/Replayer_Betclic/'), true), share.PUBLIC_URL);
  assert.equal(share.shareBase(at('https://mon-site.fr/poker/index.html#m=abc'), false), 'https://mon-site.fr/poker/index.html');
  assert.equal(share.PUBLIC_URL, 'https://arthurkzp.github.io/Replayer_Betclic/');
});
