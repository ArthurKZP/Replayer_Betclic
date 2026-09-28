/*
 * Contrôleur de l'application : import, lecture, réglages, mode décision, partage.
 */
(function (root) {
  'use strict';

  const R = root.Replayer;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = R.esc;

  const STORAGE_SETTINGS = 'replayer.settings.v1';
  const STORAGE_RECENT = 'replayer.recent.v1';

  const storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* stockage indisponible : on ignore */
      }
    },
  };

  const settings = Object.assign(
    { unit: 'money', fourColor: false, showAll: false, decisionMode: false, felt: 'rouge', speed: 1 },
    storage.get(STORAGE_SETTINGS, {})
  );

  const app = {
    hands: [],
    handIndex: 0,
    timeline: null,
    step: 0,
    playing: false,
    timer: null,
    viewer: null,
    answered: new Map(), // index d'étape -> { choice, match }
    pendingDecision: null,
  };

  const table = new R.TableView({
    area: $('#tableArea'),
    wrap: $('#tableWrap'),
    onSeatClick: (name) => setViewer(name),
  });

  /* ---------- Formatage -------------------------------------------------- */

  function fmtNumber(v, maxDec) {
    const abs = Math.abs(v);
    const dec = Math.abs(abs - Math.round(abs)) > 0.004 ? maxDec : 0;
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(abs);
  }

  function fmtWith(hand, unit, v) {
    if (!hand) return String(v);
    const sign = v < 0 ? '−' : '';
    if (unit === 'bb' && hand.bb > 0) {
      const x = Math.abs(v) / hand.bb;
      const dec = Math.abs(x - Math.round(x)) > 0.04 ? 1 : 0;
      return sign + new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(x) + ' BB';
    }
    const n = fmtNumber(v, 2);
    if (hand.currency === '€') return sign + n + ' €';
    if (hand.currency) return sign + hand.currency + n;
    return sign + n;
  }

  function fmt(v) {
    return fmtWith(app.timeline && app.timeline.hand, settings.unit, v);
  }

  function fmtSigned(v, hand, unit) {
    const f = hand ? (x) => fmtWith(hand, unit || 'money', x) : fmt;
    if (Math.abs(v) < 0.005) return f(0);
    return (v > 0 ? '+' : '') + f(v);
  }

  function fmtDate(raw) {
    const m = String(raw || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(\(?UTC\)?)?/i);
    if (!m) return raw || '';
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}${m[7] ? 'Z' : ''}`;
    const d = new Date(iso);
    if (isNaN(d)) return raw;
    return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function shortId(id) {
    return id ? '…' + String(id).slice(-6) : '';
  }

  function eventHTML(ev) {
    if (ev.kind === 'street') {
      const label = R.STREET_NAMES[ev.street] || ev.street;
      const ret = (ev.returned || []).map((r) => ` · ${esc(fmt(r.amount))} rendus à ${esc(r.player)}`).join('');
      return `${esc(label)} ${R.miniCardsHTML(ev.cards.length ? ev.cards : ev.board)}${ret}`;
    }
    if (ev.kind === 'showdown') {
      const st = app.timeline.steps[app.step];
      const parts = st.players
        .filter((p) => p.revealed)
        .map((p) => `${esc(p.name)} ${R.miniCardsHTML(p.cards)}`);
      return 'Abattage · ' + parts.join(' · ');
    }
    return esc(R.describeEvent(ev, fmt, R.cardText));
  }

  function shortAction(ev) {
    switch (ev.type) {
      case 'fold': return 'Couché';
      case 'check': return 'Parole';
      case 'call': return 'Suit ' + fmt(ev.amount);
      case 'bet': return 'Mise ' + fmt(ev.amount);
      case 'raise': return 'Relance à ' + fmt(ev.to);
      case 'allin': return 'Tapis ' + fmt(ev.originalType === 'call' ? ev.amount : ev.to);
      case 'post_sb': return 'SB ' + fmt(ev.amount);
      case 'post_bb': return 'BB ' + fmt(ev.amount);
      case 'post_ante': return 'Ante ' + fmt(ev.amount);
      case 'post_straddle': return 'Straddle ' + fmt(ev.amount);
      default: return fmt(ev.amount);
    }
  }

  /* ---------- Chargement --------------------------------------------------- */

  function loadText(text, opts) {
    const { hands, errors } = R.parseHands(text);
    if (!hands.length) {
      throw new Error(errors[0] || "Aucune main reconnue. Copiez l'historique complet, à partir de « *** HEADER *** ».");
    }
    app.hands = hands;
    selectHand((opts && opts.index) || 0, opts);
    if (!(opts && opts.skipRecent)) rememberHands(hands);
    return hands;
  }

  function selectHand(index, opts) {
    stop();
    app.handIndex = Math.max(0, Math.min(index, app.hands.length - 1));
    const hand = app.hands[app.handIndex];
    app.timeline = R.buildTimeline(hand);
    app.answered = new Map();
    app.viewer = hand.heroName || (hand.players[0] && hand.players[0].name);
    table.setup(app.timeline, app.viewer, fmt);
    buildViewerSelect();
    renderHandStrip();
    buildLog();
    $('#scrubber').max = String(app.timeline.steps.length - 1);
    hideDecision();
    app.step = 0;
    showStep(0, null, true); // avec l'animation de distribution
    if (!(opts && opts.noSync)) syncAddressBar();
  }

  function setViewer(name) {
    if (!app.timeline || name === app.viewer) return;
    app.viewer = name;
    table.setup(app.timeline, app.viewer, fmt);
    $('#viewerSelect').value = name;
    buildLog();
    showStep(app.step, null, false);
    toast(`Vue depuis le siège de ${name}`);
  }

  /* ---------- Navigation ------------------------------------------------------ */

  function viewerHandText(state) {
    const me = state.players.find((p) => p.name === app.viewer);
    if (!me || !me.cards || me.folded) return '';
    const best = R.bestHand(me.cards.concat(state.board));
    if (!best) return '';
    if (state.board.length === 0 && best.category === 0) return '';
    return best.description;
  }

  function showStep(i, prev, animate) {
    const state = app.timeline.steps[i];
    if (!animate) table.clearFx();
    table.render(state, prev, {
      animate,
      speed: settings.speed,
      showAll: settings.showAll,
      viewerHand: viewerHandText(state),
    });
    $('#eventText').innerHTML = eventHTML(state.event);
    $('#eventCount').textContent = `${i + 1} / ${app.timeline.steps.length}`;
    const scrub = $('#scrubber');
    scrub.value = String(i);
    const max = app.timeline.steps.length - 1;
    scrub.style.setProperty('--fill', (max ? (i / max) * 100 : 100) + '%');
    $('#btnFirst').disabled = $('#btnPrev').disabled = i === 0;
    $('#btnNext').disabled = $('#btnLast').disabled = i === max;
    updateStreetChips(i);
    updateLog(i);
    renderResult(i);
  }

  function goTo(i, animate) {
    const steps = app.timeline.steps;
    const target = Math.max(0, Math.min(i, steps.length - 1));
    const prev = animate && target === app.step + 1 ? steps[app.step] : null;
    hideDecision();
    app.step = target;
    showStep(target, prev, !!prev);
  }

  function next() {
    const steps = app.timeline.steps;
    if (app.step >= steps.length - 1) {
      stop();
      return false;
    }
    const upcoming = steps[app.step + 1];
    if (settings.decisionMode && upcoming.decision && upcoming.decision.player === app.viewer && !app.answered.has(upcoming.index)) {
      askDecision(upcoming);
      return false;
    }
    goTo(app.step + 1, true);
    return true;
  }

  function delayFor(state) {
    const ev = state.event;
    let ms = 1100;
    if (ev.kind === 'start') ms = 1300;
    else if (ev.kind === 'street') ms = 1500;
    else if (ev.kind === 'showdown') ms = 2000;
    else if (ev.type === 'fold') ms = 750;
    return ms / settings.speed;
  }

  function schedule() {
    clearTimeout(app.timer);
    if (!app.playing) return;
    app.timer = setTimeout(() => {
      if (!app.playing) return;
      if (next()) schedule();
      else if (!app.pendingDecision) stop();
    }, delayFor(app.timeline.steps[app.step]));
  }

  function play() {
    if (!app.timeline) return;
    if (app.step >= app.timeline.steps.length - 1) {
      app.answered = new Map();
      goTo(0, false);
    }
    app.playing = true;
    updatePlayButton();
    schedule();
  }

  function stop() {
    app.playing = false;
    clearTimeout(app.timer);
    updatePlayButton();
  }

  function togglePlay() {
    if (app.pendingDecision) return;
    if (app.playing) stop();
    else play();
  }

  function updatePlayButton() {
    const btn = $('#btnPlay');
    btn.setAttribute('aria-label', app.playing ? 'Pause' : 'Lecture');
    $('#playIcon').innerHTML = app.playing
      ? '<path d="M7 5h4v14H7zm6 0h4v14h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
  }

  function updateStreetChips(i) {
    const starts = app.timeline.streetStart;
    const state = app.timeline.steps[i];
    const currentKey = state.event.kind === 'showdown' || state.event.kind === 'win' ? 'showdown' : state.street;
    $$('.street-chip').forEach((chip) => {
      const key = chip.dataset.street;
      chip.disabled = starts[key] == null;
      chip.setAttribute('aria-current', String(key === currentKey));
    });
  }

  /* ---------- Mode décision ----------------------------------------------------- */

  function categoryOf(ev) {
    if (ev.type === 'fold') return 'fold';
    if (ev.type === 'check' || ev.type === 'call' || (ev.type === 'allin' && ev.originalType === 'call')) return 'passive';
    return 'aggr';
  }

  function askDecision(step) {
    const d = step.decision;
    app.pendingDecision = step;
    const wasPlaying = app.playing;
    stop();
    app.pendingDecision.resume = wasPlaying;
    const options = d.facingBet
      ? [
          { cat: 'fold', label: 'Se coucher', cls: 'd-fold' },
          { cat: 'passive', label: d.toCall >= d.stack ? 'Suivre (tapis)' : 'Suivre', sub: fmt(d.toCall), cls: 'd-passive' },
        ].concat(d.stack > d.toCall ? [{ cat: 'aggr', label: 'Relancer', cls: 'd-aggr' }] : [])
      : [
          { cat: 'passive', label: 'Parole', cls: 'd-passive' },
          { cat: 'aggr', label: 'Miser', cls: 'd-aggr' },
        ];
    $('#decisionTitle').textContent = 'À vous de jouer';
    $('#decisionInfo').textContent = `Pot ${fmt(d.pot)}${d.facingBet ? ' · ' + fmt(d.toCall) + ' à payer' : ''} · Tapis ${fmt(d.stack)}`;
    const box = $('#decisionActions');
    box.innerHTML = options
      .map((o) => `<button type="button" class="${o.cls}" data-cat="${o.cat}" data-label="${esc(o.label + (o.sub ? ' ' + o.sub : ''))}">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`)
      .join('');
    box.hidden = false;
    $('#decisionFeedback').hidden = true;
    $('#decision').hidden = false;
    box.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => answerDecision(b.dataset.cat, b.dataset.label))
    );
    box.querySelector('button').focus({ preventScroll: true });
  }

  function answerDecision(cat, label) {
    const step = app.pendingDecision;
    if (!step) return;
    const actual = categoryOf(step.event);
    const match = cat === actual;
    app.answered.set(step.index, { cat, match });
    $('#decisionActions').hidden = true;
    $('#decisionFeedback').hidden = false;
    $('#decisionCompare').innerHTML = `Votre choix : <strong>${esc(label)}</strong> · Joué : <strong>${esc(shortAction(step.event))}</strong>`;
    const verdict = $('#decisionVerdict');
    verdict.className = 'verdict ' + (match ? 'ok' : 'ko');
    verdict.textContent = match ? 'Même décision que dans la main' : 'Décision différente de la main jouée';
    $('#decisionContinue').focus({ preventScroll: true });
  }

  function continueAfterDecision() {
    const step = app.pendingDecision;
    if (!step) return;
    const resume = step.resume;
    app.pendingDecision = null;
    goTo(step.index, true);
    if (resume) {
      app.playing = true;
      updatePlayButton();
      schedule();
    }
  }

  function hideDecision() {
    $('#decision').hidden = true;
    app.pendingDecision = null;
  }

  /* ---------- Panneaux ------------------------------------------------------------ */

  function renderHandStrip() {
    const h = app.timeline.hand;
    const parts = [];
    parts.push(`<strong>${esc(h.gameName || h.gameType || 'Texas Hold\'em')}</strong>`);
    if (h.gameMode) parts.push(esc(h.gameMode));
    if (h.bb) parts.push(`Blindes ${esc(fmtMoneyRaw(h.sb, h))} / ${esc(fmtMoneyRaw(h.bb, h))}`);
    if (h.dateTime) parts.push(`<span class="strip-date">${esc(fmtDate(h.dateTime))}</span>`);
    if (h.handId) parts.push(`<span title="${esc(h.handId)}">Main ${esc(shortId(h.handId))}</span>`);
    let html = parts.join('<span class="sep" aria-hidden="true"></span>');
    if (app.hands.length > 1) {
      html += `<span class="hand-nav">
        <button type="button" id="handPrev" aria-label="Main précédente" ${app.handIndex === 0 ? 'disabled' : ''}>‹</button>
        <span class="tabular">Main ${app.handIndex + 1} / ${app.hands.length}</span>
        <button type="button" id="handNext" aria-label="Main suivante" ${app.handIndex === app.hands.length - 1 ? 'disabled' : ''}>›</button>
      </span>`;
    }
    $('#handStrip').innerHTML = html;
    const prevBtn = $('#handPrev');
    const nextBtn = $('#handNext');
    if (prevBtn) prevBtn.addEventListener('click', () => selectHand(app.handIndex - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => selectHand(app.handIndex + 1));
  }

  function fmtMoneyRaw(v, hand) {
    const n = fmtNumber(v, 2);
    if (hand.currency === '€') return n + ' €';
    return (hand.currency || '') + n;
  }

  function buildViewerSelect() {
    const sel = $('#viewerSelect');
    sel.innerHTML = app.timeline.hand.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => `<option value="${esc(p.name)}">Siège ${p.seat} · ${esc(p.name)}${p.name === app.timeline.hand.heroName ? ' (vous)' : ''}</option>`)
      .join('');
    sel.value = app.viewer;
  }

  function buildLog() {
    const tl = app.timeline;
    const posOf = new Map(tl.steps[0].players.map((p) => [p.name, p.position || '']));
    const hero = tl.hand.heroName;
    const row = (step, name, text, type) =>
      `<button type="button" class="log-row" data-step="${step}">
        <span class="lr-pos">${esc(posOf.get(name) || '')}</span>
        <span class="lr-name${name === hero ? ' hero' : ''}">${esc(name)}</span>
        <span class="lr-act t-${type}">${text}</span>
      </button>`;
    let html = '';
    tl.steps.forEach((s, i) => {
      const ev = s.event;
      if (ev.kind === 'start') {
        html += `<div class="log-street" data-step="${i}"><span>Préflop</span></div>`;
        ev.posts.forEach((p) => { html += row(i, p.player, esc(shortAction(p)), p.type); });
      } else if (ev.kind === 'street') {
        html += `<div class="log-street" data-step="${i}"><span>${esc(R.STREET_NAMES[ev.street])} ${R.miniCardsHTML(ev.board)}</span><span class="pot-at">Pot ${esc(fmt(s.pot))}</span></div>`;
      } else if (ev.kind === 'action') {
        html += row(i, ev.player, esc(shortAction(ev)), ev.type);
      } else if (ev.kind === 'return') {
        html += row(i, ev.player, esc('Rendu ' + fmt(ev.amount)), 'call');
      } else if (ev.kind === 'showdown') {
        html += `<div class="log-street" data-step="${i}"><span>Abattage</span><span class="pot-at">Pot ${esc(fmt(s.pot))}</span></div>`;
        s.players.filter((p) => p.revealed).forEach((p) => {
          html += row(i, p.name, `${R.miniCardsHTML(p.cards)}`, 'show');
        });
      } else if (ev.kind === 'win') {
        if (!tl.steps.some((x) => x.event.kind === 'showdown')) {
          html += `<div class="log-street" data-step="${i}"><span>Fin de main</span></div>`;
        }
        ev.winners.forEach((w) => { html += row(i, w.player, esc('Gagne ' + fmt(w.amount)), 'win'); });
      }
    });
    const log = $('#log');
    log.innerHTML = html;
    log.querySelectorAll('.log-row').forEach((el) =>
      el.addEventListener('click', () => {
        stop();
        goTo(parseInt(el.dataset.step, 10), false);
      })
    );
  }

  function updateLog(i) {
    const log = $('#log');
    let current = null;
    log.querySelectorAll('[data-step]').forEach((el) => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.toggle('current', s === i);
      el.classList.toggle('future', s > i && !settings.decisionMode);
      el.classList.toggle('hidden-future', s > i && settings.decisionMode);
      if (s === i && !current) current = el;
    });
    if (current && log.scrollHeight > log.clientHeight + 4) {
      const top = current.offsetTop - log.offsetTop;
      if (top < log.scrollTop || top > log.scrollTop + log.clientHeight - 40) {
        log.scrollTo({ top: Math.max(0, top - 60), behavior: 'smooth' });
      }
    }
  }

  function renderResult(i) {
    const tl = app.timeline;
    const body = $('#resultBody');
    const last = tl.steps.length - 1;
    if (i < last) {
      body.innerHTML = `<p class="result-hidden">Le résultat s'affiche à la fin de la main (${last - i} étape${last - i > 1 ? 's' : ''} restante${last - i > 1 ? 's' : ''}).</p>`;
      return;
    }
    const final = tl.steps[last];
    const netOf = (name) => (tl.results.find((r) => r.name === name) || { net: 0 }).net;
    const viewer = app.viewer;
    const vNet = netOf(viewer);
    const cls = (n) => (n > 0.004 ? 'pos' : n < -0.004 ? 'neg' : 'zero');
    let html = `<div class="result-hero"><span>${esc(viewer)}${viewer === tl.hand.heroName ? ' (vous)' : ''}</span><span class="big net ${cls(vNet)}">${esc(fmtSigned(vNet))}</span></div>`;
    html += '<ul class="result-list">';
    tl.results
      .filter((r) => r.name !== viewer)
      .sort((a, b) => b.net - a.net)
      .forEach((r) => {
        html += `<li><span>${esc(r.name)}</span><span class="net ${cls(r.net)}">${esc(fmtSigned(r.net))}</span></li>`;
      });
    html += '</ul>';
    const winEv = final.event.kind === 'win' ? final.event : null;
    const notes = [];
    if (winEv) notes.push(`Pot ${fmt(winEv.totalPot)}${winEv.rake > 0 ? ` · Rake ${fmt(winEv.rake)}` : ''}`);
    if (app.answered.size) {
      const ok = [...app.answered.values()].filter((a) => a.match).length;
      notes.push(`Mode décision : ${ok}/${app.answered.size} décision${app.answered.size > 1 ? 's' : ''} identique${ok > 1 ? 's' : ''}`);
    }
    if (notes.length) html += `<p class="result-note">${notes.map(esc).join(' · ')}</p>`;
    body.innerHTML = html;
  }

  /* ---------- Réglages -------------------------------------------------------------- */

  function applySettings() {
    document.documentElement.classList.toggle('four-color', settings.fourColor);
    document.documentElement.dataset.felt = settings.felt;
    $('#optFourColor').checked = settings.fourColor;
    $('#optShowAll').checked = settings.showAll;
    $('#optDecision').checked = settings.decisionMode;
    $$('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === settings.unit)));
    $$('[data-felt]').forEach((b) => {
      if (b.classList.contains('swatch')) b.setAttribute('aria-pressed', String(b.dataset.felt === settings.felt));
    });
    $$('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(parseFloat(b.dataset.speed) === settings.speed)));
  }

  function saveSettings() {
    storage.set(STORAGE_SETTINGS, settings);
  }

  function refresh() {
    if (!app.timeline) return;
    renderHandStrip();
    buildLog();
    showStep(app.step, null, false);
  }

  /* ---------- Import ------------------------------------------------------------------ */

  const dialog = $('#importDialog');

  function openImport() {
    stop();
    $('#importError').hidden = true;
    $('#handChoice').hidden = true;
    renderRecent();
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
    $('#importText').focus();
  }

  function closeImport() {
    if (dialog.close) dialog.close();
    else dialog.removeAttribute('open');
  }

  function showImportError(msg) {
    const el = $('#importError');
    el.textContent = msg;
    el.hidden = false;
  }

  function handSummary(h) {
    const heroCards = h.heroName && h.holeCards[h.heroName];
    const tl = R.buildTimeline(h);
    const heroRes = h.heroName ? (tl.results.find((r) => r.name === h.heroName) || {}).net : null;
    return { heroCards, heroRes };
  }

  function handItemHTML(h, attrs) {
    const { heroCards, heroRes } = handSummary(h);
    const res = heroRes != null ? fmtSigned(heroRes, h) : '';
    const cls = heroRes > 0.004 ? 'pos' : heroRes < -0.004 ? 'neg' : 'zero';
    return `<li><button type="button" class="hand-item" ${attrs}>
      ${heroCards ? R.miniCardsHTML(heroCards) : '<span class="mini-cards"></span>'}
      <span class="hi-meta"><strong>${esc(h.gameName || h.gameType || 'Main')}</strong> · ${esc(fmtDate(h.dateTime))} · ${esc(shortId(h.handId))}</span>
      <span class="net ${cls} tabular">${esc(res)}</span>
    </button></li>`;
  }

  function submitImport(text) {
    const value = (text != null ? text : $('#importText').value).trim();
    if (!value) {
      showImportError("Collez d'abord un historique de main, ou choisissez un fichier .txt.");
      return;
    }
    let result;
    try {
      result = R.parseHands(value);
    } catch (e) {
      showImportError(e.message);
      return;
    }
    if (!result.hands.length) {
      showImportError(result.errors[0] || "Aucune main reconnue. Copiez l'historique complet, à partir de « *** HEADER *** ».");
      return;
    }
    if (result.hands.length === 1) {
      loadText(value);
      closeImport();
      toast('Main chargée');
      return;
    }
    // Plusieurs mains : on propose de choisir.
    const list = $('#handChoiceList');
    $('#handChoiceTitle').textContent = `${result.hands.length} mains trouvées · choisissez celle à rejouer`;
    list.innerHTML = result.hands.map((h, i) => handItemHTML(h, `data-index="${i}"`)).join('');
    $('#handChoice').hidden = false;
    list.querySelectorAll('.hand-item').forEach((b) =>
      b.addEventListener('click', () => {
        loadText(value, { index: parseInt(b.dataset.index, 10) });
        closeImport();
      })
    );
  }

  function readFiles(files) {
    const list = Array.from(files || []).filter((f) => /\.txt$/i.test(f.name) || f.type.startsWith('text'));
    if (!list.length) {
      showImportError('Seuls les fichiers texte (.txt) sont acceptés.');
      return;
    }
    Promise.all(list.map((f) => f.text())).then((texts) => {
      const all = texts.join('\n\n');
      $('#importText').value = all;
      submitImport(all);
    });
  }

  function rememberHands(hands) {
    const recent = storage.get(STORAGE_RECENT, []);
    for (const h of hands.slice(0, 20).reverse()) {
      const key = h.handId || h.raw.slice(0, 80);
      const idx = recent.findIndex((r) => r.key === key);
      if (idx >= 0) recent.splice(idx, 1);
      recent.unshift({ key, raw: h.raw });
    }
    storage.set(STORAGE_RECENT, recent.slice(0, 12));
  }

  function renderRecent() {
    const recent = storage.get(STORAGE_RECENT, []);
    const block = $('#recentBlock');
    const hands = [];
    for (const r of recent) {
      try {
        hands.push(R.parseHand(r.raw));
      } catch (e) {
        /* entrée illisible : ignorée */
      }
    }
    block.hidden = !hands.length;
    if (!hands.length) return;
    const list = $('#recentList');
    list.innerHTML = hands.map((h, i) => handItemHTML(h, `data-recent="${i}"`)).join('');
    list.querySelectorAll('.hand-item').forEach((b) =>
      b.addEventListener('click', () => {
        const h = hands[parseInt(b.dataset.recent, 10)];
        loadText(h.raw, { skipRecent: false });
        closeImport();
      })
    );
  }

  /* ---------- Partage -------------------------------------------------------------------- */

  const shareDialog = $('#shareDialog');
  let copyResetTimer = null;

  function isFramed() {
    try {
      return window.top !== window.self;
    } catch (e) {
      return true;
    }
  }

  /** Siège à transmettre dans le lien : seulement si la vue n'est pas celle du héros. */
  function sharedSeat() {
    const hand = app.timeline.hand;
    const p = hand.players.find((x) => x.name === app.viewer);
    return p && p.name !== hand.heroName ? p.seat : 0;
  }

  async function refreshShareLink() {
    const fromStep = $('#shareFromStep').checked;
    const url = await R.shareUrl(app.timeline.hand.raw, { step: fromStep ? app.step : 0, seat: sharedSeat() });
    $('#shareUrl').value = url;
    $('#shareOpen').href = url;
    return url;
  }

  async function openShare() {
    if (!app.timeline) return;
    stop();
    const total = app.timeline.steps.length;
    const current = app.timeline.steps[app.step];
    const stepBox = $('#shareFromStep');
    stepBox.checked = false;
    stepBox.disabled = app.step === 0;
    $('#shareStepInfo').textContent = app.step === 0
      ? 'Avancez dans la main pour choisir une action de départ'
      : `Action ${app.step + 1} / ${total} · ${R.describeEvent(current.event, fmt, R.cardText)}`;
    const note = $('#shareNote');
    if (R.isHostedPage()) {
      note.hidden = true;
    } else {
      const host = R.PUBLIC_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
      note.innerHTML = `Le lien ouvre la version en ligne du replayer : <strong>${esc(host)}</strong>.`;
      note.hidden = false;
    }
    $('#shareNative').hidden = !(navigator.share && !isFramed());
    $('#shareCopy').textContent = 'Copier le lien';
    try {
      await refreshShareLink();
    } catch (e) {
      toast('Impossible de créer le lien sur ce navigateur');
      return;
    }
    if (shareDialog.showModal) shareDialog.showModal();
    else shareDialog.setAttribute('open', '');
    $('#shareCopy').focus();
  }

  function closeShare() {
    if (shareDialog.close) shareDialog.close();
    else shareDialog.removeAttribute('open');
  }

  async function copyShareLink() {
    const input = $('#shareUrl');
    const btn = $('#shareCopy');
    try {
      await navigator.clipboard.writeText(input.value);
      btn.textContent = 'Lien copié ✓';
    } catch (e) {
      input.focus();
      input.select();
      btn.textContent = 'Lien sélectionné : copiez-le';
    }
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => { btn.textContent = 'Copier le lien'; }, 2500);
  }

  async function nativeShare() {
    const hand = app.timeline.hand;
    const heroCards = hand.heroName && hand.holeCards[hand.heroName];
    const text = [heroCards ? R.cardText(heroCards) : '', hand.gameName].filter(Boolean).join(' · ');
    try {
      await navigator.share({ title: 'Une main de poker à rejouer', text, url: $('#shareUrl').value });
    } catch (e) {
      if (e && e.name !== 'AbortError') copyShareLink();
    }
  }

  /**
   * Sur la version en ligne, la barre d'adresse devient le lien de la main
   * (comme un lien de partage). Hors ligne, on retire un ancien lien devenu faux.
   */
  let syncCounter = 0;
  async function syncAddressBar() {
    const mine = ++syncCounter;
    try {
      if (R.isHostedPage()) {
        const url = await R.shareUrl(app.timeline.hand.raw);
        if (mine === syncCounter && url.split('#')[0] === location.href.split('#')[0]) history.replaceState(null, '', url);
      } else if (R.parseShareHash(location.hash)) {
        history.replaceState(null, '', location.href.split('#')[0]);
      }
    } catch (e) {
      /* l'adresse reste telle quelle */
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---------- Événements -------------------------------------------------------------------- */

  function bind() {
    $('#btnPlay').addEventListener('click', togglePlay);
    $('#btnNext').addEventListener('click', () => { stop(); next(); });
    $('#btnPrev').addEventListener('click', () => { stop(); goTo(app.step - 1, false); });
    $('#btnFirst').addEventListener('click', () => { stop(); app.answered = new Map(); goTo(0, false); });
    $('#btnLast').addEventListener('click', () => { stop(); goTo(app.timeline.steps.length - 1, false); });
    $('#scrubber').addEventListener('input', (e) => { stop(); goTo(parseInt(e.target.value, 10), false); });
    $$('.street-chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        const idx = app.timeline.streetStart[chip.dataset.street];
        if (idx == null) return;
        stop();
        goTo(idx, false);
      })
    );
    $$('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        settings.speed = parseFloat(b.dataset.speed);
        saveSettings();
        applySettings();
        if (app.playing) schedule();
      })
    );
    $$('[data-unit]').forEach((b) =>
      b.addEventListener('click', () => {
        settings.unit = b.dataset.unit;
        saveSettings();
        applySettings();
        refresh();
      })
    );
    $$('.swatch').forEach((b) =>
      b.addEventListener('click', () => {
        settings.felt = b.dataset.felt;
        saveSettings();
        applySettings();
      })
    );
    $('#optFourColor').addEventListener('change', (e) => { settings.fourColor = e.target.checked; saveSettings(); applySettings(); });
    $('#optShowAll').addEventListener('change', (e) => { settings.showAll = e.target.checked; saveSettings(); applySettings(); refresh(); });
    $('#optDecision').addEventListener('change', (e) => {
      settings.decisionMode = e.target.checked;
      saveSettings();
      applySettings();
      if (settings.decisionMode) toast('Mode décision : la lecture s\'arrête avant chacune de vos actions');
      refresh();
    });
    $('#viewerSelect').addEventListener('change', (e) => setViewer(e.target.value));
    $('#decisionContinue').addEventListener('click', continueAfterDecision);
    // Un tap sur la table avance d'une action (pratique sur téléphone).
    $('#tableWrap').addEventListener('click', () => {
      if (!app.timeline || app.pendingDecision) return;
      stop();
      next();
    });

    $('#btnImport').addEventListener('click', openImport);
    $('#btnShare').addEventListener('click', openShare);
    $('#shareClose').addEventListener('click', closeShare);
    $('#shareCopy').addEventListener('click', copyShareLink);
    $('#shareNative').addEventListener('click', nativeShare);
    $('#shareFromStep').addEventListener('change', () => { refreshShareLink().catch(() => {}); });
    $('#shareForm').addEventListener('submit', (e) => e.preventDefault());
    $('#shareUrl').addEventListener('focus', (e) => e.target.select());
    shareDialog.addEventListener('click', (e) => { if (e.target === shareDialog) closeShare(); });
    $('#importClose').addEventListener('click', closeImport);
    $('#importForm').addEventListener('submit', (e) => {
      e.preventDefault();
      submitImport();
    });
    $('#importSample').addEventListener('click', () => {
      $('#importText').value = R.SAMPLE_HAND;
      $('#importError').hidden = true;
    });
    $('#importFile').addEventListener('change', (e) => readFiles(e.target.files));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) closeImport(); });

    const dz = $('#dropzone');
    ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('drag')));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) readFiles(e.dataTransfer.files);
    });
    // Dépôt d'un fichier n'importe où sur la page.
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      if (dialog.open || shareDialog.open) return;
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) {
        openImport();
        readFiles(e.dataTransfer.files);
      }
    });
    // Coller une main directement sur la page.
    document.addEventListener('paste', (e) => {
      if (dialog.open || shareDialog.open || /^(TEXTAREA|INPUT)$/.test((e.target && e.target.tagName) || '')) return;
      const text = e.clipboardData && e.clipboardData.getData('text');
      if (text && /\*{3}\s*PLAYERS\s*\*{3}/i.test(text)) {
        try {
          loadText(text);
          toast('Main collée et chargée');
        } catch (err) {
          toast(err.message);
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (dialog.open || shareDialog.open || e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && e.target.type !== 'range') return;
      if (!app.timeline) return;
      if (app.pendingDecision) return;
      if (e.key === ' ' || e.key === 'k') {
        if (tag === 'BUTTON') return;
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stop();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stop();
        goTo(app.step - 1, false);
      } else if (e.key === 'Home') {
        e.preventDefault();
        stop();
        goTo(0, false);
      } else if (e.key === 'End') {
        e.preventDefault();
        stop();
        goTo(app.timeline.steps.length - 1, false);
      }
    });

    let resizeRaf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (!app.timeline) return;
        table.layout();
        showStep(app.step, null, false);
      });
    });

    window.addEventListener('hashchange', loadFromHash);
  }

  async function loadFromHash() {
    const link = R.parseShareHash(location.hash);
    if (!link) return false;
    let text;
    try {
      text = await R.decodeHand(link.token);
      loadText(text, { skipRecent: true, noSync: true });
    } catch (e) {
      toast('Ce lien de main est illisible ou incomplet : demandez un nouveau lien');
      return false;
    }
    if (link.seat) {
      const p = app.timeline.hand.players.find((x) => x.seat === link.seat);
      if (p) setViewer(p.name);
    }
    if (link.step) goTo(Math.min(link.step, app.timeline.steps.length - 1), false);
    return true;
  }

  async function init() {
    applySettings();
    bind();
    if (root.REPLAYER_NO_SHARE) $('#btnShare').hidden = true;
    const fromLink = await loadFromHash();
    if (!fromLink) loadText(R.SAMPLE_HAND, { skipRecent: true, noSync: true });
  }

  init();
})(typeof self !== 'undefined' ? self : this);
