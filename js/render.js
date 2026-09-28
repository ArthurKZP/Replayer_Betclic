/*
 * Rendu de la table : positions des sièges, cartes, jetons et animations.
 */
(function (root) {
  'use strict';

  const R = (root.Replayer = root.Replayer || {});

  const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const rankLabel = (r) => (r === 'T' ? '10' : r);
  const AVATAR_TONES = ['#4a2f3a', '#2f3b4a', '#46382a', '#2d4538', '#3e2f4c', '#4b2a2a', '#2c3f45', '#433d2b'];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function cardHTML(card, cls) {
    const extra = cls ? ' ' + cls : '';
    if (!card) return `<div class="card back${extra}"></div>`;
    const r = card[0];
    const s = card[1];
    return `<div class="card face s-${s}${extra}" data-card="${card}" aria-label="${rankLabel(r)}${SUIT_SYMBOLS[s]}"><span class="c-rank">${rankLabel(r)}</span><span class="c-mini">${SUIT_SYMBOLS[s]}</span><span class="c-suit">${SUIT_SYMBOLS[s]}</span></div>`;
  }

  function miniCardsHTML(cards) {
    return `<span class="mini-cards">${(cards || [])
      .map((c) => `<span class="mini-card s-${c[1]}">${rankLabel(c[0])}${SUIT_SYMBOLS[c[1]]}</span>`)
      .join('')}</span>`;
  }

  function cardText(cards) {
    return (cards || []).map((c) => rankLabel(c[0]) + SUIT_SYMBOLS[c[1]]).join(' ');
  }

  function initials(name) {
    const clean = String(name).replace(/[^A-Za-z0-9À-ÿ]/g, '');
    return (clean.slice(0, 2) || '?').toUpperCase();
  }

  function tone(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_TONES[h % AVATAR_TONES.length];
  }

  function chipClass(amount, bb) {
    const x = bb > 0 ? amount / bb : amount;
    if (x < 1) return 'c-white';
    if (x < 5) return 'c-red';
    if (x < 25) return 'c-black';
    return 'c-gold';
  }

  function chipsHTML(amount, bb) {
    if (!(amount > 0)) return '';
    const x = bb > 0 ? amount / bb : amount;
    const n = x < 2 ? 1 : x < 10 ? 2 : 3;
    const cls = chipClass(amount, bb);
    let out = '<span class="chips">';
    for (let i = 0; i < n; i++) {
      const c = i === n - 1 ? cls : i === 0 && n === 3 ? 'c-red' : cls;
      out += `<span class="chip ${c}" style="top:${-i * 18}%"></span>`;
    }
    return out + '</span>';
  }

  /* ---------------------------------------------------------------------------
   * Géométrie : positions en % de la zone de table.
   * ------------------------------------------------------------------------- */
  function geometry(maxSeats, portrait, aspect) {
    const rx = portrait ? 36 : 41.5;
    const ry = portrait ? 37 : 36;
    const cy = portrait ? 48.5 : 50;
    const p = portrait ? 2.8 : 3.2; // superellipse : colle les sièges au bord de la table
    const seats = [];
    for (let v = 0; v < maxSeats; v++) {
      const a = ((90 + (v * 360) / maxSeats) * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = 50 + rx * Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
      const y = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
      seats.push({ x, y });
    }
    const center = { x: 50, y: 47 };
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const bets = seats.map((pt, v) => {
      let t = portrait ? 0.38 : 0.4;
      if (v === 0) t = portrait ? 0.5 : 0.59; // sous le tableau, au-dessus des cartes du héros
      else if (Math.abs(pt.x - 50) < 12 && pt.y < center.y) t = portrait ? 0.4 : 0.44; // siège du haut
      else if (portrait && pt.y < center.y) t = 0.56; // sièges hauts latéraux : sous leur plaque
      return lerp(pt, center, t);
    });
    const dealers = seats.map((pt) => {
      const base = lerp(pt, center, portrait ? 0.3 : 0.26);
      // Décalage perpendiculaire (en tenant compte du ratio de la zone).
      const dx = (center.x - pt.x) * aspect;
      const dy = center.y - pt.y;
      const len = Math.hypot(dx, dy) || 1;
      const k = portrait ? 9 : 7;
      return { x: base.x + ((-dy / len) * k) / aspect, y: base.y + (dx / len) * k * (portrait ? 0.7 : 1) };
    });
    return {
      seats,
      bets,
      dealers,
      center,
      pot: { x: 50, y: portrait ? 58.5 : 34.5 },
      board: { x: 50, y: center.y },
    };
  }

  /* ---------------------------------------------------------------------------
   * Vue de la table
   * ------------------------------------------------------------------------- */
  class TableView {
    constructor(opts) {
      this.area = opts.area;
      this.wrap = opts.wrap;
      this.onSeatClick = opts.onSeatClick || (() => {});
      this.boardEl = this.wrap.querySelector('.board');
      this.potEl = this.wrap.querySelector('.pot');
      this.seatsEl = this.wrap.querySelector('.seats');
      this.betsEl = this.wrap.querySelector('.bets');
      this.dealerEl = this.wrap.querySelector('.dealer');
      this.fxEl = this.wrap.querySelector('.fx');
      this.seatEls = new Map();
      this.betEls = new Map();
      this.portrait = false;
    }

    /** Prépare la table pour une main donnée. */
    setup(timeline, viewerName, fmt) {
      this.timeline = timeline;
      this.hand = timeline.hand;
      this.viewerName = viewerName;
      this.fmt = fmt;
      const viewer = this.hand.players.find((p) => p.name === viewerName);
      this.viewerSeat = viewer ? viewer.seat : Math.min(...this.hand.players.map((p) => p.seat));
      this.maxSeats = this.hand.maxSeats;
      this.buildSeats();
      this.layout();
    }

    visualIndex(seat) {
      return (((seat - this.viewerSeat) % this.maxSeats) + this.maxSeats) % this.maxSeats;
    }

    buildSeats() {
      this.seatsEl.innerHTML = '';
      this.betsEl.innerHTML = '';
      this.seatEls.clear();
      this.betEls.clear();
      this.boardEl.innerHTML = '<div class="slot"></div>'.repeat(5);
      const occupied = new Map(this.hand.players.map((p) => [p.seat, p]));
      for (let seat = 1; seat <= this.maxSeats; seat++) {
        const p = occupied.get(seat);
        const el = document.createElement('div');
        el.className = 'seat';
        el.dataset.seat = String(seat);
        if (!p) {
          el.classList.add('empty');
          el.innerHTML = '<div class="avatar">Libre</div>';
        } else {
          if (p.name === this.viewerName) el.classList.add('viewer');
          el.style.setProperty('--av-bg', `radial-gradient(circle at 35% 30%, ${tone(p.name)}, #141115)`);
          el.innerHTML = `
            <div class="hole"></div>
            <div class="avatar">${esc(initials(p.name))}<span class="pos-badge" hidden></span>
              <button class="seat-btn" type="button" aria-label="Voir la main depuis le siège de ${esc(p.name)}" title="Voir depuis ce siège"></button>
            </div>
            <div class="plate">
              <span class="p-name">${esc(p.name)}${p.name === this.hand.heroName ? '<span class="you">VOUS</span>' : ''}</span>
              <span class="p-stack"></span>
            </div>
            <div class="act" hidden></div>
            <div class="hand-hint" hidden></div>`;
          el.querySelector('.seat-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.onSeatClick(p.name);
          });
          const bet = document.createElement('div');
          bet.className = 'bet';
          bet.hidden = true;
          this.betsEl.appendChild(bet);
          this.betEls.set(p.name, bet);
        }
        this.seatsEl.appendChild(el);
        this.seatEls.set(seat, el);
      }
    }

    /** Calcule la taille de la table selon la place disponible. */
    layout() {
      const areaWidth = this.area.clientWidth || 800;
      const portrait = areaWidth < 620;
      const ratio = portrait ? 0.64 : 1.62;
      let w = areaWidth;
      let h = w / ratio;
      if (portrait) {
        // La table + les contrôles tiennent sur un écran de téléphone.
        h = Math.min(h, Math.max(w * 1.2, window.innerHeight - 330));
      } else {
        const maxH = Math.max(360, window.innerHeight - 300);
        if (h > maxH) {
          h = maxH;
          w = h * ratio;
        }
      }
      this.wrap.style.width = Math.round(w) + 'px';
      this.wrap.style.height = Math.round(h) + 'px';
      const u = portrait ? Math.min(w / 56, h / 88) : Math.min(w / 100, h / 62);
      this.wrap.style.setProperty('--u', u.toFixed(2) + 'px');
      this.wrap.classList.toggle('portrait', portrait);
      this.portrait = portrait;
      this.geo = geometry(this.maxSeats || 6, portrait, w / h);
      this.positionStatic();
    }

    seatPoint(seat) {
      return this.geo.seats[this.visualIndex(seat)];
    }

    positionStatic() {
      if (!this.hand) return;
      for (const [seat, el] of this.seatEls) {
        const pt = this.seatPoint(seat);
        el.style.left = pt.x + '%';
        el.style.top = pt.y + '%';
      }
      for (const p of this.hand.players) {
        const b = this.betEls.get(p.name);
        const pt = this.geo.bets[this.visualIndex(p.seat)];
        b.style.left = pt.x + '%';
        b.style.top = pt.y + '%';
      }
      this.potEl.style.left = this.geo.pot.x + '%';
      this.potEl.style.top = this.geo.pot.y + '%';
      this.boardEl.style.top = this.geo.board.y + '%';
      const btn = this.timeline && this.timeline.buttonSeat;
      if (btn != null) {
        const pt = this.geo.dealers[this.visualIndex(btn)];
        this.dealerEl.hidden = false;
        this.dealerEl.style.left = pt.x + '%';
        this.dealerEl.style.top = pt.y + '%';
      } else {
        this.dealerEl.hidden = true;
      }
    }

    /**
     * Affiche un état. `prev` sert à animer la transition (étape suivante).
     * opts : { animate, speed, showAll, fourColor, viewerHand }
     */
    render(state, prev, opts) {
      const o = opts || {};
      const animate = !!(o.animate && prev);
      const dur = (ms) => Math.round(ms / (o.speed || 1));
      const isEnd = state.event.kind === 'win';
      const winnerCards = new Set();
      if (isEnd) {
        state.players.filter((p) => p.isWinner && p.bestCards).forEach((p) => p.bestCards.forEach((c) => winnerCards.add(c)));
      }
      const highlight = isEnd && winnerCards.size > 0 && state.players.some((p) => p.isWinner && p.revealed);

      // --- Board
      const slots = this.boardEl.children;
      for (let i = 0; i < 5; i++) {
        const card = state.board[i];
        const slot = slots[i];
        const current = slot.firstElementChild && slot.firstElementChild.dataset.card;
        const cls = [];
        if (highlight && card) cls.push(winnerCards.has(card) ? 'key' : 'dim');
        if (card !== current || slot.dataset.cls !== cls.join(' ')) {
          const isNew = animate && card && (!prev.board[i] || prev.board[i] !== card);
          slot.innerHTML = card ? cardHTML(card, cls.concat(isNew ? ['deal'] : []).join(' ')) : '';
          slot.dataset.cls = cls.join(' ');
          if (isNew) {
            const c = slot.firstElementChild;
            c.style.animationDelay = dur((i - prev.board.length) * 110) + 'ms';
            c.style.animationDuration = dur(450) + 'ms';
          }
        }
      }

      // --- Pot
      const potShown = state.pot > 0;
      this.potEl.hidden = !potShown;
      if (potShown) {
        const side = state.pots && state.pots.length > 1
          ? `<div class="side-pots">${state.pots.map((p, i) => `<span>${i === 0 ? 'Principal' : 'Annexe ' + i} · ${esc(this.fmt(p.amount))}</span>`).join('')}</div>`
          : '';
        this.potEl.innerHTML = `<div class="pot-main">${chipsHTML(state.pot, this.hand.bb)}
          <div class="pot-total"><span class="lbl">Pot</span><span class="tabular">${esc(this.fmt(state.pot))}</span></div></div>${side}`;
      }

      // --- Sièges
      const prevBy = new Map(((prev && prev.players) || []).map((p) => [p.name, p]));
      for (const p of state.players) {
        const el = this.seatEls.get(p.seat);
        const before = prevBy.get(p.name);
        const isViewer = p.name === this.viewerName;
        el.classList.toggle('is-folded', p.folded);
        el.classList.toggle('is-out', !p.dealt);
        el.classList.toggle('is-actor', state.actor === p.name);
        el.classList.toggle('is-winner', !!p.isWinner && isEnd);

        el.querySelector('.p-stack').textContent = p.allIn && p.stack <= 0 ? 'Tapis' : this.fmt(p.stack);

        const badge = el.querySelector('.pos-badge');
        badge.hidden = !p.position;
        badge.textContent = p.position || '';

        // Étiquette d'action
        const act = el.querySelector('.act');
        const a = p.action;
        if (a && a.label && !(a.type === 'fold' && !isViewer && state.actor !== p.name)) {
          act.hidden = false;
          act.className = 'act a-' + a.type;
          act.textContent = a.type === 'win' ? `+${this.fmt(a.amount)}` : a.label;
        } else {
          act.hidden = true;
        }

        // Cartes privatives
        const hole = el.querySelector('.hole');
        const known = p.cards && p.cards.length;
        const showFace = known && (isViewer || p.revealed || o.showAll);
        let html = '';
        let key = '';
        if (p.dealt && (!p.folded || (isViewer && known))) {
          const cards = showFace ? p.cards : [null, null];
          key = (showFace ? cards.join('') : 'backs') + (p.folded ? '-f' : '');
          const dimCls = p.folded ? 'dim' : '';
          html = cards
            .map((c) => {
              let cls = dimCls;
              if (highlight && c && p.isWinner) cls = winnerCards.has(c) ? 'key' : 'dim';
              else if (highlight && c && p.revealed && !p.isWinner) cls = 'dim';
              return cardHTML(c, cls);
            })
            .join('');
          key += highlight ? '-h' + (p.isWinner ? 'w' : 'l') : '';
        }
        if (hole.dataset.key !== key) {
          const flipping = animate && before && showFace && !(before.revealed || isViewer || o.showAll) && p.revealed;
          const dealing = !!o.animate && state.event.kind === 'start';
          hole.innerHTML = html;
          hole.dataset.key = key;
          if (flipping) hole.querySelectorAll('.card').forEach((c) => c.classList.add('flip'));
          if (dealing) {
            hole.querySelectorAll('.card').forEach((c, i) => {
              c.classList.add('deal');
              c.style.animationDelay = dur(this.visualIndex(p.seat) * 60 + i * 260) + 'ms';
              c.style.animationDuration = dur(420) + 'ms';
            });
          }
        }
        if (animate && before && !before.folded && p.folded && !isViewer) {
          this.flyFoldedCards(p, dur);
        }

        // Force de main
        const hint = el.querySelector('.hand-hint');
        let hintText = '';
        if ((state.street === 'showdown' || isEnd) && p.revealed && p.handName) hintText = p.handName;
        else if (isViewer && o.viewerHand && !p.folded) hintText = o.viewerHand;
        hint.hidden = !hintText;
        hint.textContent = hintText;

        // Mises
        const bet = this.betEls.get(p.name);
        if (p.bet > 0) {
          bet.hidden = false;
          bet.innerHTML = `${chipsHTML(p.bet, this.hand.bb)}<span class="bet-amt tabular">${esc(this.fmt(p.bet))}</span>`;
        } else {
          bet.hidden = true;
        }

        if (animate && before) {
          if (p.bet > before.bet + 0.001) this.flyChips(this.seatPoint(p.seat), this.geo.bets[this.visualIndex(p.seat)], p.bet - before.bet, dur(320));
          if (before.bet > 0.001 && p.bet < 0.001 && state.pot > prev.pot - 0.001) {
            this.flyChips(this.geo.bets[this.visualIndex(p.seat)], this.geo.pot, before.bet, dur(380));
          }
          if (p.won > before.won + 0.001) {
            this.flyChips(this.geo.pot, this.seatPoint(p.seat), p.won - before.won, dur(650), dur(250));
            this.floatText(this.seatPoint(p.seat), '+' + this.fmt(p.won - before.won), dur(1600));
          }
        }
      }
    }

    flyChips(from, to, amount, duration, delay) {
      if (!this.fxEl.animate) return;
      const el = document.createElement('div');
      el.className = 'fly';
      el.innerHTML = chipsHTML(amount, this.hand.bb);
      el.style.left = from.x + '%';
      el.style.top = from.y + '%';
      this.fxEl.appendChild(el);
      const anim = el.animate(
        [
          { left: from.x + '%', top: from.y + '%', opacity: 1 },
          { left: to.x + '%', top: to.y + '%', opacity: 1, offset: 0.85 },
          { left: to.x + '%', top: to.y + '%', opacity: 0 },
        ],
        { duration, delay: delay || 0, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' }
      );
      anim.onfinish = () => el.remove();
      anim.oncancel = () => el.remove();
    }

    flyFoldedCards(p, dur) {
      if (!this.fxEl.animate) return;
      const from = this.seatPoint(p.seat);
      const to = this.geo.center;
      const el = document.createElement('div');
      el.className = 'fly';
      el.style.setProperty('--cw', 'calc(var(--u) * 4.2)');
      el.innerHTML = `<div style="display:flex">${cardHTML(null)}${cardHTML(null, '')}</div>`;
      el.querySelectorAll('.card').forEach((c, i) => {
        c.style.setProperty('--cw', 'calc(var(--u) * 4.2)');
        if (i) c.style.marginLeft = 'calc(var(--u) * -1.4)';
      });
      this.fxEl.appendChild(el);
      const anim = el.animate(
        [
          { left: from.x + '%', top: from.y - 4 + '%', opacity: 1, transform: 'translate(-50%,-50%) scale(1)' },
          { left: to.x + '%', top: to.y + '%', opacity: 0, transform: 'translate(-50%,-50%) scale(.6) rotate(25deg)' },
        ],
        { duration: dur(420), easing: 'ease-in', fill: 'both' }
      );
      anim.onfinish = () => el.remove();
      anim.oncancel = () => el.remove();
    }

    floatText(at, text, duration) {
      if (!this.fxEl.animate) return;
      const el = document.createElement('div');
      el.className = 'float-win';
      el.textContent = text;
      el.style.left = at.x + '%';
      el.style.top = at.y + '%';
      this.fxEl.appendChild(el);
      const anim = el.animate(
        [
          { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
          { transform: 'translate(-50%,-160%) scale(1)', opacity: 1, offset: 0.25 },
          { transform: 'translate(-50%,-200%) scale(1)', opacity: 1, offset: 0.8 },
          { transform: 'translate(-50%,-240%) scale(1)', opacity: 0 },
        ],
        { duration, easing: 'ease-out', fill: 'both' }
      );
      anim.onfinish = () => el.remove();
      anim.oncancel = () => el.remove();
    }

    clearFx() {
      this.fxEl.getAnimations && this.fxEl.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      this.fxEl.innerHTML = '';
    }
  }

  Object.assign(R, { TableView, cardHTML, miniCardsHTML, cardText, esc, SUIT_SYMBOLS });
})(typeof self !== 'undefined' ? self : this);
