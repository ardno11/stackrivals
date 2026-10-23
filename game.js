(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Konstanty
  // ---------------------------------------------------------------------------
  const COLS = 10;
  const ROWS = 40; // 20 řad pro každého hráče
  const HALF = ROWS / 2;

  const EMPTY = 0;
  const WALL_P1 = 1; // zeď vzniklá z plné řady hráče 1
  const WALL_P2 = 2; // zeď vzniklá z plné řady hráče 2
  // Kostky hráčů se ukládají jako hráč * 10 + index typu (10–16 resp. 20–26).

  const LOCK_DELAY = 500;
  const MAX_LOCK_RESETS = 15;
  const FLASH_TIME = 1100;

  // Síla útoku podle počtu řad dokončených jednou kostkou.
  const PUSH_POWER = [0, 1, 2, 4, 6];

  const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  };

  function rotateCW(m) {
    const n = m.length;
    const r = [];
    for (let y = 0; y < n; y++) {
      r.push([]);
      for (let x = 0; x < n; x++) r[y].push(m[n - 1 - x][y]);
    }
    return r;
  }

  function rotateCCW(m) {
    const n = m.length;
    const r = [];
    for (let y = 0; y < n; y++) {
      r.push([]);
      for (let x = 0; x < n; x++) r[y].push(m[x][n - 1 - y]);
    }
    return r;
  }

  function emptyRow() { return new Array(COLS).fill(EMPTY); }
  function wallRow(v) { return new Array(COLS).fill(v); }

  // ---------------------------------------------------------------------------
  // Herní logika (nezávislá na vykreslování)
  // ---------------------------------------------------------------------------
  class Game {
    constructor(rng) {
      this.rng = rng || Math.random;
      this.speedUp = false; // plynulé zrychlování s délkou hry (výchozí vypnuto)
      this.reset();
    }

    reset() {
      this.grid = Array.from({ length: ROWS }, emptyRow);
      // Zeď uprostřed zabírá řady [wallTop, wallBot). Hráč 1 vlastní [0, wallTop),
      // hráč 2 vlastní [wallBot, ROWS).
      this.wallTop = HALF;
      this.wallBot = HALF;
      this.elapsed = 0;
      this.state = 'ready'; // ready | playing | paused | over
      this.winner = null;
      this.reason = '';
      this.flash = null;
      this.players = [this.makePlayer(1), this.makePlayer(2)];
      for (const p of this.players) this.spawn(p);
    }

    makePlayer(id) {
      const dir = id === 1 ? 1 : -1; // směr pádu ke středu
      return {
        id, dir, edgeDir: -dir,
        bag: [], piece: null, nextType: null,
        lockTime: 0, lockResets: 0, dropAcc: 0,
        sent: 0,
      };
    }

    opponent(p) { return this.players[p.id === 1 ? 1 : 0]; }

    start() { if (this.state === 'ready') this.state = 'playing'; }

    togglePause() {
      if (this.state === 'playing') this.state = 'paused';
      else if (this.state === 'paused') this.state = 'playing';
    }

    space(p) { return p.id === 1 ? this.wallTop : ROWS - this.wallBot; }

    level() { return this.speedUp ? 1 + Math.floor(this.elapsed / 45000) : 1; }

    dropInterval() {
      if (!this.speedUp) return 850;
      return Math.max(90, 850 * Math.pow(0.82, this.elapsed / 45000));
    }

    drawFromBag(p) {
      if (p.bag.length === 0) {
        p.bag = TYPES.slice();
        for (let i = p.bag.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [p.bag[i], p.bag[j]] = [p.bag[j], p.bag[i]];
        }
      }
      return p.bag.pop();
    }

    // Matice kostky; pro hráče 2 zrcadlená svisle, aby „padala“ nahoru stejně přirozeně.
    shapeFor(p, type) {
      const m = SHAPES[type].map(r => r.slice());
      return p.id === 2 ? m.reverse() : m;
    }

    makePiece(p, type) {
      const matrix = this.shapeFor(p, type);
      const rows = [];
      matrix.forEach((r, y) => { if (r.some(Boolean)) rows.push(y); });
      const minRow = Math.min(...rows);
      const maxRow = Math.max(...rows);
      return {
        type,
        matrix,
        x: Math.floor((COLS - matrix.length) / 2),
        y: p.id === 1 ? -minRow : ROWS - 1 - maxRow,
      };
    }

    spawn(p) {
      if (p.nextType === null) p.nextType = this.drawFromBag(p);
      const type = p.nextType;
      p.nextType = this.drawFromBag(p);
      p.piece = this.makePiece(p, type);
      p.lockTime = 0;
      p.lockResets = 0;
      p.dropAcc = 0;
      if (this.collides(p, p.piece.matrix, p.piece.x, p.piece.y)) {
        this.lose(p, 'noRoom');
      }
    }

    inRegion(p, gy) {
      return p.id === 1 ? gy >= 0 && gy < this.wallTop : gy >= this.wallBot && gy < ROWS;
    }

    collides(p, matrix, x, y) {
      for (let my = 0; my < matrix.length; my++) {
        for (let mx = 0; mx < matrix.length; mx++) {
          if (!matrix[my][mx]) continue;
          const gx = x + mx;
          const gy = y + my;
          if (gx < 0 || gx >= COLS) return true;
          if (!this.inRegion(p, gy)) return true;
          if (this.grid[gy][gx] !== EMPTY) return true;
        }
      }
      return false;
    }

    isGrounded(p) {
      const pc = p.piece;
      return this.collides(p, pc.matrix, pc.x, pc.y + p.dir);
    }

    ghostY(p) {
      const pc = p.piece;
      let y = pc.y;
      while (!this.collides(p, pc.matrix, pc.x, y + p.dir)) y += p.dir;
      return y;
    }

    afterManipulation(p) {
      if (p.lockResets < MAX_LOCK_RESETS && p.lockTime > 0) {
        p.lockTime = 0;
        p.lockResets++;
      }
    }

    canAct(p) { return this.state === 'playing' && p.piece; }

    move(p, dx) {
      if (!this.canAct(p)) return false;
      const pc = p.piece;
      if (this.collides(p, pc.matrix, pc.x + dx, pc.y)) return false;
      pc.x += dx;
      this.afterManipulation(p);
      return true;
    }

    // dir = 1 po směru hodinových ručiček, -1 proti směru.
    rotate(p, dir = 1) {
      if (!this.canAct(p)) return false;
      const pc = p.piece;
      const m = dir < 0 ? rotateCCW(pc.matrix) : rotateCW(pc.matrix);
      const e = p.edgeDir;
      const d = p.dir;
      const kicks = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, e], [-1, e], [1, e], [0, d], [0, 2 * d]];
      for (const [kx, ky] of kicks) {
        if (!this.collides(p, m, pc.x + kx, pc.y + ky)) {
          pc.matrix = m;
          pc.x += kx;
          pc.y += ky;
          this.afterManipulation(p);
          return true;
        }
      }
      return false;
    }

    stepToMiddle(p) {
      const pc = p.piece;
      if (this.collides(p, pc.matrix, pc.x, pc.y + p.dir)) return false;
      pc.y += p.dir;
      p.lockTime = 0;
      return true;
    }

    softDrop(p) {
      if (!this.canAct(p)) return false;
      const moved = this.stepToMiddle(p);
      if (moved) p.dropAcc = 0;
      return moved;
    }

    hardDrop(p) {
      if (!this.canAct(p)) return;
      while (this.stepToMiddle(p)) { /* posun až ke středu */ }
      this.lockPiece(p);
    }

    lockPiece(p) {
      const pc = p.piece;
      const value = p.id * 10 + TYPES.indexOf(pc.type);
      pc.matrix.forEach((r, my) => r.forEach((c, mx) => {
        if (c) this.grid[pc.y + my][pc.x + mx] = value;
      }));
      p.piece = null;

      const lines = this.countFullRows(p);
      if (lines > 0) {
        const power = PUSH_POWER[lines];
        for (let i = 0; i < power && this.state === 'playing'; i++) {
          this.pushStep(p, this.findFullRow(p));
        }
        this.flash = { player: p.id, lines, power, time: FLASH_TIME };
      }
      if (this.state === 'playing') this.spawn(p);
    }

    countFullRows(p) {
      let n = 0;
      const [from, to] = p.id === 1 ? [0, this.wallTop] : [this.wallBot, ROWS];
      for (let y = from; y < to; y++) if (this.grid[y].every(c => c !== EMPTY)) n++;
      return n;
    }

    // Plnou řadu hledáme od středu směrem k okraji hráče.
    findFullRow(p) {
      const full = y => this.grid[y].every(c => c !== EMPTY);
      if (p.id === 1) {
        for (let y = this.wallTop - 1; y >= 0; y--) if (full(y)) return y;
      } else {
        for (let y = this.wallBot; y < ROWS; y++) if (full(y)) return y;
      }
      return -1;
    }

    // Odstraní řadu r z poloviny hráče; kostky nad ní se sesunou ke středu.
    removeRow(p, r) {
      const g = this.grid;
      if (p.id === 1) {
        for (let y = r; y > 0; y--) g[y] = g[y - 1];
        g[0] = emptyRow();
      } else {
        for (let y = r; y < ROWS - 1; y++) g[y] = g[y + 1];
        g[ROWS - 1] = emptyRow();
      }
    }

    // Jedna jednotka útoku. Spotřebuje plnou řadu hráče (pokud ji ještě má – bonusové
    // jednotky ji nemají). Má-li soupeř ve středu zeď, jedna její řada zanikne a hráčova
    // polovina se o řadu zvětší. Jinak přibude hráčova zeď a soupeř je zatlačen o řadu.
    pushStep(p, row) {
      const g = this.grid;
      const opp = this.opponent(p);
      p.sent++;
      if (row !== -1) this.removeRow(p, row);

      const adjacent = p.id === 1 ? this.wallTop : this.wallBot - 1;
      const oppWall = p.id === 1 ? WALL_P2 : WALL_P1;
      if (this.wallBot > this.wallTop && g[adjacent][0] === oppWall) {
        this.removeRow(p, adjacent);
        if (p.id === 1) this.wallTop++;
        else this.wallBot--;
        return;
      }

      if (p.id === 1) {
        if (g[ROWS - 1].some(c => c !== EMPTY)) {
          this.lose(opp, 'pushed');
          return;
        }
        for (let y = ROWS - 1; y > this.wallTop; y--) g[y] = g[y - 1];
        g[this.wallTop] = wallRow(WALL_P1);
        this.wallBot++;
      } else {
        if (g[0].some(c => c !== EMPTY)) {
          this.lose(opp, 'pushed');
          return;
        }
        for (let y = 0; y < this.wallBot - 1; y++) g[y] = g[y + 1];
        g[this.wallBot - 1] = wallRow(WALL_P2);
        this.wallTop--;
      }

      // Padající kostka soupeře je zatlačena spolu s jeho polovinou, pokud překáží.
      const pc = opp.piece;
      if (pc && this.collides(opp, pc.matrix, pc.x, pc.y)) {
        if (!this.collides(opp, pc.matrix, pc.x, pc.y + opp.edgeDir)) {
          pc.y += opp.edgeDir;
        } else {
          this.lose(opp, 'pushed');
        }
      }
    }

    lose(p, reason) {
      this.state = 'over';
      this.winner = this.opponent(p).id;
      this.reason = reason;
    }

    update(dt) {
      if (this.flash) {
        this.flash.time -= dt;
        if (this.flash.time <= 0) this.flash = null;
      }
      if (this.state !== 'playing') return;
      this.elapsed += dt;
      const interval = this.dropInterval();

      for (const p of this.players) {
        if (this.state !== 'playing') break;
        if (!p.piece) continue;

        p.dropAcc += dt;
        while (p.dropAcc >= interval) {
          p.dropAcc -= interval;
          if (!this.stepToMiddle(p)) { p.dropAcc = 0; break; }
        }

        if (this.isGrounded(p)) {
          p.lockTime += dt;
          if (p.lockTime >= LOCK_DELAY) this.lockPiece(p);
        } else {
          p.lockTime = 0;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Vykreslování a ovládání (jen v prohlížeči)
  // ---------------------------------------------------------------------------
  // Vzhledy. Hráči se liší odstínem i jasem, aby je šlo rozeznat i při poruše barevného vidění:
  // protanopie/deuteranopie plete červenou se zelenou, tritanopie modrou se žlutou,
  // monochromacie nevidí barvy vůbec (rozhoduje jen jas a vzorek na kostkách hráče 2).
  const THEMES = {
    classic: {
      blocks: {
        1: ['#4fc3f7', '#80deea', '#7986cb', '#26c6da', '#42a5f5', '#5c6bc0', '#4dd0e1'],
        2: ['#ef5350', '#ffb74d', '#ec407a', '#ff7043', '#f44336', '#ff8a65', '#ffa726'],
      },
      walls: { [WALL_P1]: '#2f4d73', [WALL_P2]: '#73303d' },
      bg: ['#0b0e17', '#0f1a33', '#2a1119'],
      accent: { 1: '#4fc3f7', 2: '#ff7043' },
      pattern: false,
    },
    protanopia: {
      blocks: {
        1: ['#4fc3f7', '#64b5f6', '#42a5f5', '#2196f3', '#5c9bff', '#7aa7ff', '#3d8bfd'],
        2: ['#ffd54f', '#ffca28', '#ffee58', '#fdd835', '#ffe082', '#f9c846', '#fff176'],
      },
      walls: { [WALL_P1]: '#3b6fb8', [WALL_P2]: '#b89a1e' },
      bg: ['#060607', '#141a26', '#26220f'],
      accent: { 1: '#4fc3f7', 2: '#ffd54f' },
      pattern: true,
    },
    tritanopia: {
      blocks: {
        1: ['#26c6da', '#4dd0e1', '#00bcd4', '#80deea', '#26a69a', '#4db6ac', '#00acc1'],
        2: ['#ef5350', '#e53935', '#ff6f61', '#f06292', '#d81b60', '#ff8a80', '#ec407a'],
      },
      walls: { [WALL_P1]: '#1f8a94', [WALL_P2]: '#b0343d' },
      bg: ['#060707', '#10191a', '#251214'],
      accent: { 1: '#26c6da', 2: '#ef5350' },
      pattern: true,
    },
    monochromacy: {
      blocks: {
        1: ['#f5f5f5', '#eeeeee', '#e0e0e0', '#fafafa', '#e8e8e8', '#d6d6d6', '#f0f0f0'],
        2: ['#6e6e6e', '#777777', '#808080', '#686868', '#737373', '#7b7b7b', '#6a6a6a'],
      },
      walls: { [WALL_P1]: '#9e9e9e', [WALL_P2]: '#4a4a4a' },
      bg: ['#0c0c0c', '#2a2a2a', '#000000'],
      accent: { 1: '#f5f5f5', 2: '#9a9a9a' },
      pattern: true,
    },
  };
  let theme = THEMES.classic;

  function cellColor(v) {
    if (v === WALL_P1 || v === WALL_P2) return theme.walls[v];
    return theme.blocks[Math.floor(v / 10)][v % 10];
  }

  function drawBlock(ctx, px, py, s, color, pattern) {
    ctx.fillStyle = color;
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
    const b = Math.max(2, Math.round(s * 0.14));
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(px + 1, py + 1, s - 2, b);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px + 1, py + s - 1 - b, s - 2, b);
    if (pattern) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      const i = Math.round(s * 0.3);
      ctx.strokeRect(px + i + 0.5, py + i + 0.5, s - 2 * i - 1, s - 2 * i - 1);
    }
  }

  // Vykreslí jednu buňku podle hodnoty v mřížce (kostka hráče nebo zeď).
  function drawCell(ctx, px, py, s, v) {
    if (v === WALL_P1 || v === WALL_P2) drawWall(ctx, px, py, s, cellColor(v));
    else drawBlock(ctx, px, py, s, cellColor(v), theme.pattern && Math.floor(v / 10) === 2);
  }

  function drawWall(ctx, px, py, s, color) {
    ctx.fillStyle = color;
    ctx.fillRect(px, py + 1, s, s - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(px, py + Math.floor(s / 2), s, 1);
  }

  function initUI() {
    const game = new Game();
    global.game = game;

    const app = document.getElementById('app');
    // Plátno 1 je pohled hráče 1. Plátno 2 je pohled hráče 2 – stejná hrací plocha,
    // jen svisle převrácená, aby mu kostky padaly shora (zobrazuje se jen v režimu dvou polí).
    const views = [
      { canvas: document.getElementById('board'), flip: false },
      { canvas: document.getElementById('board2'), flip: true },
    ];
    for (const v of views) v.ctx = v.canvas.getContext('2d');
    const nextCanvases = { 1: document.getElementById('next1'), 2: document.getElementById('next2') };
    const overlay = document.getElementById('overlay');
    const el = id => document.getElementById(id);
    const { t } = global.I18N;
    global.I18N.apply();
    let cell = 20;
    let dual = false;

    function resize() {
      const boards = dual ? 2 : 1;
      // Šířka bočních panelů, mezer a okrajů (viz style.css).
      const chrome = 2 * (document.body.classList.contains('touch') ? 130 : 200) + (boards + 1) * 24 + 24 + boards * 4;
      const byHeight = Math.floor((window.innerHeight - 30) / ROWS);
      const byWidth = Math.floor((window.innerWidth - chrome) / (boards * COLS));
      cell = Math.max(10, Math.min(28, byHeight, byWidth));
      for (const v of views) {
        v.canvas.width = COLS * cell;
        v.canvas.height = ROWS * cell;
      }
      const n = Math.round(cell * 0.9) * 4;
      for (const c of Object.values(nextCanvases)) { c.width = n; c.height = n; }
    }
    window.addEventListener('resize', resize);

    // --- Ovládání s vlastním opakováním kláves (aby mohli držet klávesy oba hráči) ---
    const KEYMAP = {
      KeyA: [1, 'left'], KeyD: [1, 'right'], KeyS: [1, 'soft'], KeyW: [1, 'rotate'], Space: [1, 'hard'],
      ArrowLeft: [2, 'left'], ArrowRight: [2, 'right'], ArrowUp: [2, 'soft'], ArrowDown: [2, 'rotate'],
      Enter: [2, 'hard'], NumpadEnter: [2, 'hard'],
    };
    // V režimu dvou polí padají hráči 2 kostky na obrazovce dolů, proto šipky prohodíme.
    const KEYMAP_DUAL = { ...KEYMAP, ArrowUp: [2, 'rotate'], ArrowDown: [2, 'soft'] };
    const DAS = { left: 160, right: 160, soft: 0 };
    const ARR = { left: 50, right: 50, soft: 35 };
    const held = new Map(); // code -> { player, action, timer }

    function setDual(value) {
      dual = value;
      app.classList.toggle('dual', dual);
      held.clear();
      resize();
    }
    setDual(false);

    // --- Jména hráčů ---
    const NAMES_KEY = 'stack-rivals-player-names';
    const DEFAULT_NAMES = ['', ''];
    const defaultName = i => t('player' + (i + 1));
    const isDefaultName = s => /^(Hráč|Player) [12]$/.test(s);
    let names = DEFAULT_NAMES.slice();
    try {
      const saved = JSON.parse(localStorage.getItem(NAMES_KEY));
      if (Array.isArray(saved)) names = DEFAULT_NAMES.map((d, i) => (typeof saved[i] === 'string' && !isDefaultName(saved[i]) ? saved[i] : d));
    } catch (e) { /* bez úložiště nebo poškozená data */ }

    let tournament = null; // { dual, players, rounds, current, started, message }
    let matchNames = null; // jména aktuálního zápasu turnaje
    const nameOf = i => (matchNames ? matchNames[i] : names[i].trim() || defaultName(i));
    const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nameInputs = [el('nameInput1'), el('nameInput2')];

    function applyNames() {
      el('name1').textContent = nameOf(0);
      el('name2').textContent = nameOf(1);
      try { localStorage.setItem(NAMES_KEY, JSON.stringify(names)); } catch (e) { /* bez úložiště */ }
    }
    nameInputs.forEach((input, i) => {
      input.value = names[i];
      input.addEventListener('input', () => { names[i] = input.value; applyNames(); });
    });
    el('resetNames').addEventListener('click', () => {
      names = DEFAULT_NAMES.slice();
      nameInputs.forEach((input, i) => { input.value = names[i]; });
      applyNames();
    });
    applyNames();

    // --- Hlavní menu ---
    const menu = el('menu');
    const menuOpen = () => !menu.hidden;

    let currentView = 'main';
    function showView(name) {
      currentView = name;
      for (const section of menu.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== name;
      const first = menu.querySelector(`[data-view="${name}"] button, [data-view="${name}"] input`);
      if (first) first.focus({ preventScroll: true });
      menu.scrollTop = 0;
    }

    function showMenu() {
      game.reset();
      held.clear();
      menu.hidden = false;
      showView('main');
    }

    function startGame(mode) {
      setDual(mode === 'dual');
      game.reset();
      game.start();
      menu.hidden = true;
      if (document.activeElement) document.activeElement.blur();
    }

    menu.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.go) showView(btn.dataset.go);
      else if (btn.dataset.start) startGame(btn.dataset.start);
      else if (btn.dataset.look) { appearance.look = btn.dataset.look; applyAppearance(); }
      else if (btn.dataset.cb) { appearance.cb = btn.dataset.cb; applyAppearance(); }
    });
    showView('main');

    menu.addEventListener('click', e => {
      const btn = e.target.closest('[data-lang]');
      if (btn) global.I18N.setLang(btn.dataset.lang);
    });
    global.I18N.onChange(() => {
      applyNames();
      renderTournamentSetup();
      lastOverlay = null;
    });

    // --- Turnaj (pavouk, vyřazovací) ---    const MIN_PLAYERS = 2;
    const MAX_PLAYERS = 16;
    const BYE = -1;
    let tCount = 4;
    let tDual = false;
    const tNameValues = new Array(MAX_PLAYERS).fill('');
    const tNamesBox = el('tNames');

    function renderTournamentSetup() {
      el('tCount').textContent = tCount;
      tNamesBox.innerHTML = '';
      for (let i = 0; i < tCount; i++) {
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 16;
        input.autocomplete = 'off';
        input.placeholder = t('playerN', { n: i + 1 });
        input.value = tNameValues[i];
        input.addEventListener('input', () => { tNameValues[i] = input.value; });
        tNamesBox.appendChild(input);
      }
      for (const b of menu.querySelectorAll('[data-tmode]')) b.classList.toggle('active', (b.dataset.tmode === 'dual') === tDual);
    }

    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    // Zápasy bez soupeře (volný los) rovnou postupují; vítěz zápasu postupuje do dalšího kola.
    function propagate(t) {
      for (let r = 0; r < t.rounds.length; r++) {
        for (let i = 0; i < t.rounds[r].length; i++) {
          const m = t.rounds[r][i];
          if (m.winner === null && m.a !== null && m.b !== null && (m.a === BYE || m.b === BYE)) m.winner = m.a === BYE ? 1 : 0;
          if (m.winner !== null && r + 1 < t.rounds.length) {
            t.rounds[r + 1][i >> 1][i % 2 ? 'b' : 'a'] = m.winner === 0 ? m.a : m.b;
          }
        }
      }
    }

    function createTournament() {
      const players = [];
      for (let i = 0; i < tCount; i++) players.push(tNameValues[i].trim() || t('playerN', { n: i + 1 }));
      let size = 2;
      while (size < players.length) size *= 2;
      const matchCount = size / 2;
      const byes = size - players.length;
      const ids = shuffle(players.map((_, i) => i));
      const byeMatches = new Set(shuffle([...Array(matchCount).keys()]).slice(0, byes));
      const first = [];
      for (let i = 0; i < matchCount; i++) {
        first.push({ a: ids.pop(), b: byeMatches.has(i) ? BYE : ids.pop(), winner: null });
      }
      const rounds = [first];
      for (let n = matchCount / 2; n >= 1; n /= 2) {
        rounds.push(Array.from({ length: n }, () => ({ a: null, b: null, winner: null })));
      }
      tournament = { dual: tDual, players, rounds, current: null, started: false, message: '' };
      propagate(tournament);
    }

    function nextMatch() {
      for (const round of tournament.rounds) {
        for (const m of round) {
          if (m.winner === null && m.a !== null && m.b !== null && m.a !== BYE && m.b !== BYE) return m;
        }
      }
      return null;
    }

    function roundName(r, total) {
      const fromEnd = total - 1 - r;
      return [t('bracket.final'), t('bracket.semi'), t('bracket.quarter'), t('bracket.r16')][fromEnd] || t('bracket.round', { n: r + 1 });
    }

    function renderBracket() {
      const tr = tournament;
      const champion = tr.rounds[tr.rounds.length - 1][0].winner !== null ? tr.rounds[tr.rounds.length - 1][0] : null;
      const next = champion ? null : nextMatch();
      const slot = (m, side) => {
        const id = side === 0 ? m.a : m.b;
        if (id === BYE) return `<div class="slot bye">${t('bracket.bye')}</div>`;
        if (id === null) return '<div class="slot empty">?</div>';
        let cls = 'slot';
        if (m.winner !== null) cls += m.winner === side ? ' won' : ' lost';
        return `<div class="${cls}">${escapeHtml(tr.players[id])}</div>`;
      };
      const last = tr.rounds.length - 1;
      const champName = champion ? tr.players[champion.winner === 0 ? champion.a : champion.b] : null;
      el('bracket').innerHTML = tr.rounds.map((round, r) =>
        `<div class="round${r === last ? ' final' : ''}"><h4>${roundName(r, tr.rounds.length)}</h4><div class="matches">` +
        round.map(m => `<div class="cell${m.winner !== null ? ' done' : ''}"><div class="match${m === next ? ' next' : ''}">${slot(m, 0)}${slot(m, 1)}</div></div>`).join('') +
        '</div></div>').join('') +
        `<div class="round champ"><h4>${t('bracket.winner')}</h4><div class="matches"><div class="cell">` +
        `<div class="match champion"><div class="slot ${champName ? 'won' : 'empty'}">${champName ? escapeHtml(champName) : '?'}</div></div>` +
        '</div></div></div>';

      el('bracketTitle').textContent = champion ? t('bracket.over') : t('bracket.title');
      let msg = tr.message;
      if (champion) msg = t('bracket.champion', { name: tr.players[champion.winner === 0 ? champion.a : champion.b] });
      else if (next) msg = (msg ? msg + ' ' : '') + t('bracket.upNext', { a: tr.players[next.a], b: tr.players[next.b] });
      el('bracketMsg').textContent = msg;
      el('bracketMsg').classList.toggle('champion', !!champion);
      el('bracketAction').textContent = champion ? t('bracket.mainMenu') : (tr.started ? t('bracket.nextMatch') : t('bracket.start'));
      el('bracketCancel').hidden = !!champion;
    }

    function startMatch() {
      const m = nextMatch();
      if (!m) return;
      tournament.current = m;
      tournament.started = true;
      matchNames = [tournament.players[m.a], tournament.players[m.b]];
      applyNames();
      setDual(tournament.dual);
      game.reset();
      game.start();
      menu.hidden = true;
      if (document.activeElement) document.activeElement.blur();
    }

    function finishMatch() {
      const m = tournament.current;
      const side = game.winner - 1;
      const winner = tournament.players[side === 0 ? m.a : m.b];
      const loser = tournament.players[side === 0 ? m.b : m.a];
      m.winner = side;
      tournament.current = null;
      tournament.message = t('bracket.advances', { winner, loser });
      propagate(tournament);
      matchNames = null;
      applyNames();
      game.reset();
      held.clear();
      menu.hidden = false;
      showView('bracket');
      renderBracket();
    }

    function endTournament() {
      tournament = null;
      matchNames = null;
      applyNames();
      showMenu();
    }

    menu.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.go === 'tsetup') renderTournamentSetup();
      else if (btn.dataset.count) {
        tCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, tCount + Number(btn.dataset.count)));
        renderTournamentSetup();
      } else if (btn.dataset.tmode) { tDual = btn.dataset.tmode === 'dual'; renderTournamentSetup(); }
      else if (btn.id === 'tCreate') { createTournament(); showView('bracket'); renderBracket(); }
      else if (btn.id === 'bracketAction') {
        if (nextMatch()) startMatch();
        else endTournament();
      } else if (btn.id === 'bracketCancel') {
        if (confirm(t('confirm.cancelTournament'))) endTournament();
      }
    });

    // --- Vzhled ---
    const APPEARANCE_KEY = 'stack-rivals-appearance';
    const appearance = { look: 'classic', cb: 'protanopia' };
    try {
      const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY));
      if (saved && (saved.look === 'classic' || saved.look === 'colorblind')) appearance.look = saved.look;
      if (saved && THEMES[saved.cb] && saved.cb !== 'classic') appearance.cb = saved.cb;
    } catch (e) { /* bez úložiště nebo poškozená data */ }

    const cbBox = el('cbTypes');
    for (const btn of cbBox.querySelectorAll('[data-cb]')) {
      const accent = THEMES[btn.dataset.cb].accent;
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.innerHTML = `<i style="background:${accent[1]}"></i><i style="background:${accent[2]}"></i>`;
      btn.prepend(sw);
    }

    function applyAppearance() {
      theme = appearance.look === 'classic' ? THEMES.classic : THEMES[appearance.cb];
      const root = document.documentElement.style;
      root.setProperty('--p1', theme.accent[1]);
      root.setProperty('--p2', theme.accent[2]);
      for (const b of menu.querySelectorAll('[data-look]')) b.classList.toggle('active', b.dataset.look === appearance.look);
      for (const b of cbBox.querySelectorAll('[data-cb]')) b.classList.toggle('active', b.dataset.cb === appearance.cb);
      cbBox.hidden = appearance.look !== 'colorblind';
      try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); } catch (e) { /* bez úložiště */ }
    }
    applyAppearance();

    // --- Postupné zrychlování ---
    const SPEED_KEY = 'stack-rivals-speed-up-v2';
    try { if (localStorage.getItem(SPEED_KEY) === 'on') game.speedUp = true; } catch (e) { /* bez úložiště */ }
    function applySpeedUp() {
      for (const b of menu.querySelectorAll('[data-speed]')) b.classList.toggle('active', (b.dataset.speed === 'on') === game.speedUp);
      try { localStorage.setItem(SPEED_KEY, game.speedUp ? 'on' : 'off'); } catch (e) { /* bez úložiště */ }
    }
    menu.addEventListener('click', e => {
      const btn = e.target.closest('[data-speed]');
      if (!btn) return;
      game.speedUp = btn.dataset.speed === 'on';
      applySpeedUp();
    });
    applySpeedUp();

    // --- Padající kostky na pozadí menu ---
    const bgCanvas = el('menuBg');
    const bgCtx = bgCanvas.getContext('2d');
    const bgPieces = [];
    let bgSpawnTimer = 0;

    function resizeBg() {
      bgCanvas.width = window.innerWidth;
      bgCanvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeBg);
    resizeBg();

    function spawnBgPiece(anywhere) {
      const i = Math.floor(Math.random() * TYPES.length);
      let matrix = SHAPES[TYPES[i]];
      for (let r = Math.floor(Math.random() * 4); r > 0; r--) matrix = rotateCW(matrix);
      const s = 18 + Math.floor(Math.random() * 16);
      const player = Math.random() < 0.5 ? 1 : 2;
      bgPieces.push({
        matrix, s,
        v: player * 10 + i,
        x: Math.round(Math.random() * Math.max(0, bgCanvas.width - matrix.length * s) / s) * s,
        y: anywhere ? Math.random() * bgCanvas.height : -matrix.length * s,
        speed: 25 + Math.random() * 55,
      });
    }
    for (let i = 0; i < 18; i++) spawnBgPiece(true);

    function updateBg(dt) {
      bgSpawnTimer += dt;
      if (bgSpawnTimer > 450 && bgPieces.length < 30) { bgSpawnTimer = 0; spawnBgPiece(false); }
      for (let i = bgPieces.length - 1; i >= 0; i--) {
        const p = bgPieces[i];
        p.y += p.speed * dt / 1000;
        if (p.y > bgCanvas.height) bgPieces.splice(i, 1);
      }
      bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
      bgCtx.globalAlpha = 0.3;
      for (const p of bgPieces) {
        p.matrix.forEach((r, my) => r.forEach((c, mx) => {
          if (c) drawCell(bgCtx, p.x + mx * p.s, Math.round(p.y) + my * p.s, p.s, p.v);
        }));
      }
      bgCtx.globalAlpha = 1;
    }

    function act(pid, action) {
      const p = game.players[pid - 1];
      switch (action) {
        case 'left': game.move(p, -1); break;
        case 'right': game.move(p, 1); break;
        case 'soft': game.softDrop(p); break;
        // Převrácený pohled obrací směr otáčení, takže hráč 2 otáčí opačně,
        // aby se mu kostka na obrazovce točila po směru hodinových ručiček.
        case 'rotate': game.rotate(p, dual && pid === 2 ? -1 : 1); break;
        case 'hard': game.hardDrop(p); break;
      }
    }

    overlay.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn || game.state === 'playing') return;
      btn.blur();
      if (btn.dataset.action === 'resume') game.togglePause();
      else if (btn.dataset.action === 'restart') { game.reset(); game.start(); }
      else if (btn.dataset.action === 'menu') {
        if (tournament) { if (confirm(t('confirm.endTournament'))) endTournament(); }
        else showMenu();
      } else if (btn.dataset.action === 'continue') finishMatch();
      else if (btn.dataset.mode) setDual(btn.dataset.mode === 'dual');
    });

    window.addEventListener('keydown', e => {
      if (!menuOpen() && (KEYMAP[e.code] || e.code === 'KeyP')) setTouch(false);
      if (menuOpen()) {
        if (e.code === 'Escape' && currentView !== 'bracket') showView('main');
        return;
      }
      const mapped = (dual ? KEYMAP_DUAL : KEYMAP)[e.code];
      if (mapped || ['KeyP', 'KeyR', 'KeyM', 'Escape'].includes(e.code)) e.preventDefault();

      if (e.code === 'KeyM') {
        if (!e.repeat && game.state !== 'playing' && !tournament) setDual(!dual);
        return;
      }
      if (e.code === 'KeyP' || e.code === 'Escape') { if (!e.repeat) game.togglePause(); return; }
      if (e.code === 'KeyR' && (game.state === 'paused' || (game.state === 'over' && !tournament))) {
        game.reset();
        game.start();
        return;
      }
      if (!mapped || e.repeat) return;
      const [pid, action] = mapped;
      act(pid, action);
      if (action in DAS) held.set(e.code, { pid, action, timer: DAS[action] || ARR[action] });
    });
    window.addEventListener('keyup', e => held.delete(e.code));
    window.addEventListener('blur', () => held.clear());

    function processHeld(dt) {
      if (game.state !== 'playing') return;
      for (const h of held.values()) {
        h.timer -= dt;
        while (h.timer <= 0) {
          act(h.pid, h.action);
          h.timer += ARR[h.action];
        }
      }
    }

    function formatTime(ms) {
      const total = Math.floor(ms / 1000);
      const s = String(total % 60).padStart(2, '0');
      const m = Math.floor(total / 60) % 60;
      const h = Math.floor(total / 3600);
      return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
    }

    // --- Vykreslení ---
    function render() {
      renderBoard(views[0]);
      if (dual) renderBoard(views[1]);

      renderNext(game.players[0], false);
      renderNext(game.players[1], dual);

      el('sent1').textContent = game.players[0].sent;
      el('sent2').textContent = game.players[1].sent;
      el('space1').textContent = game.space(game.players[0]);
      el('space2').textContent = game.space(game.players[1]);
      el('level').textContent = game.level();
      el('time').textContent = formatTime(game.elapsed);

      renderOverlay();
    }

    // Vykreslí celou hrací plochu; při flip je svisle převrácená (řada 0 dole).
    function renderBoard({ canvas, ctx, flip }) {
      const s = cell;
      const W = canvas.width;
      const ry = y => (flip ? ROWS - 1 - y : y) * s;
      // Obdélník přes řady [a, b)
      const band = (a, b) => [(flip ? ROWS - b : a) * s, (b - a) * s];

      ctx.fillStyle = theme.bg[0];
      ctx.fillRect(0, 0, W, canvas.height);
      let [y0, h] = band(0, game.wallTop);
      ctx.fillStyle = theme.bg[1];
      ctx.fillRect(0, y0, W, h);
      [y0, h] = band(game.wallBot, ROWS);
      ctx.fillStyle = theme.bg[2];
      ctx.fillRect(0, y0, W, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < COLS; x++) { ctx.moveTo(x * s + 0.5, 0); ctx.lineTo(x * s + 0.5, canvas.height); }
      for (let y = 1; y < ROWS; y++) { ctx.moveTo(0, y * s + 0.5); ctx.lineTo(W, y * s + 0.5); }
      ctx.stroke();

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const v = game.grid[y][x];
          if (v === EMPTY) continue;
          drawCell(ctx, x * s, ry(y), s, v);
        }
      }

      if (game.flash) {
        const top = Math.max(0, game.wallTop - 1);
        const bot = Math.min(ROWS, game.wallBot + 1);
        [y0, h] = band(top, bot);
        ctx.fillStyle = theme.accent[game.flash.player];
        ctx.globalAlpha = Math.min(1, game.flash.time / 400) * 0.45;
        ctx.fillRect(0, y0, W, h);
        ctx.globalAlpha = 1;
      }

      // Původní střed hrací plochy (při převrácení zůstává na stejném místě)
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(0, HALF * s + 0.5);
      ctx.lineTo(W, HALF * s + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const p of game.players) {
        const pc = p.piece;
        if (!pc || game.state === 'ready') continue;
        const color = cellColor(p.id * 10 + TYPES.indexOf(pc.type));
        const gy = game.ghostY(p);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.45;
        pc.matrix.forEach((r, my) => r.forEach((c, mx) => {
          if (c) ctx.strokeRect((pc.x + mx) * s + 2.5, ry(gy + my) + 2.5, s - 5, s - 5);
        }));
        ctx.globalAlpha = 1;
        pc.matrix.forEach((r, my) => r.forEach((c, mx) => {
          if (c) drawCell(ctx, (pc.x + mx) * s, ry(pc.y + my), s, p.id * 10 + TYPES.indexOf(pc.type));
        }));
      }

      renderFlashText(ctx, canvas, s, flip);
    }

    const flashLabel = lines => (lines >= 2 ? t('flash.' + lines) : '');

    function renderFlashText(ctx, canvas, s, flip) {
      const f = game.flash;
      if (!f) return;
      const label = (flashLabel(f.lines) ? flashLabel(f.lines) + '  ' : '') + '+' + f.power;
      const elapsed = FLASH_TIME - f.time;
      const rise = Math.min(1, elapsed / 600) * s;
      let y = f.player === 1 ? game.wallTop * s - 2 * s - rise : game.wallBot * s + 2 * s + rise;
      if (flip) y = canvas.height - y;
      ctx.save();
      ctx.globalAlpha = Math.min(1, f.time / 400);
      ctx.font = `bold ${Math.round(s * (f.lines >= 4 ? 1.4 : 1.1))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(label, canvas.width / 2, y);
      ctx.fillStyle = f.lines >= 4 ? '#ffeb3b' : theme.accent[f.player];
      ctx.fillText(label, canvas.width / 2, y);
      ctx.restore();
    }

    function renderNext(p, flip) {
      const c = nextCanvases[p.id];
      const nctx = c.getContext('2d');
      nctx.clearRect(0, 0, c.width, c.height);
      if (!p.nextType) return;
      const m = game.shapeFor(p, p.nextType);
      if (flip) m.reverse();
      const cs = c.width / 4;
      const cells = [];
      m.forEach((r, y) => r.forEach((v, x) => { if (v) cells.push([x, y]); }));
      const xs = cells.map(a => a[0]), ys = cells.map(a => a[1]);
      const w = Math.max(...xs) - Math.min(...xs) + 1;
      const h = Math.max(...ys) - Math.min(...ys) + 1;
      const ox = (c.width - w * cs) / 2 - Math.min(...xs) * cs;
      const oy = (c.height - h * cs) / 2 - Math.min(...ys) * cs;
      for (const [x, y] of cells) drawCell(nctx, ox + x * cs, oy + y * cs, cs, p.id * 10 + TYPES.indexOf(p.nextType));
    }

    function modeSwitch(withHint) {
      return '<div class="mode-switch">' +
        `<button type="button" data-mode="single" class="${dual ? '' : 'active'}">${t('mode.single')}</button>` +
        `<button type="button" data-mode="dual" class="${dual ? 'active' : ''}">${t('mode.dual')}</button>` +
        '</div>' + (withHint ? `<p class="hint">${t('overlay.switchView')}</p>` : '');
    }

    let lastOverlay = null;
    function renderOverlay() {
      let html = '';
      const menuButton = `<button type="button" class="btn" data-action="menu">${tournament ? t('overlay.endTournament') : t('overlay.mainMenu')}</button>`;
      if (game.state === 'paused') {
        html = `<h1>${t('overlay.pause')}</h1>` + (tournament ? '' : modeSwitch(!touchMode)) +
          (touchMode
            ? `<button type="button" class="btn btn-primary" data-action="resume">${t('overlay.resume')}</button>` +
              `<button type="button" class="btn" data-action="restart">${t('overlay.restart')}</button>` + menuButton
            : menuButton + `<p class="hint">${t('overlay.pauseHint')}</p>`);
      } else if (game.state === 'over') {
        const w = game.winner - 1;
        html = `<h1 class="winner-${game.winner}">${escapeHtml(t('overlay.wins', { name: nameOf(w) }))}</h1>` +
          `<p>${escapeHtml(t('overlay.loss', { name: nameOf(1 - w), reason: t('reason.' + game.reason) }))}</p>` +
          (tournament
            ? `<button type="button" class="btn btn-primary" data-action="continue">${t('overlay.continue')}</button>`
            : modeSwitch(!touchMode) +
              (touchMode
                ? `<button type="button" class="btn btn-primary" data-action="restart">${t('overlay.newGame')}</button>` + menuButton
                : menuButton + `<p class="hint">${t('overlay.newGameHint')}</p>`));
      }
      if (html !== lastOverlay) {
        overlay.innerHTML = html;
        overlay.classList.toggle('hidden', html === '');
        lastOverlay = html;
      }
    }

    // --- Dotykové ovládání (zapne se samo na zařízeních s dotykovou obrazovkou) ---
    let touchMode = false;
    const coarse = window.matchMedia('(pointer: coarse)');

    // Gesta: tah do stran posouvá, klepnutí otáčí, tah ke středu zrychluje, rychlý švih ke středu shazuje.
    // Hráče určuje místo dotyku: v jednom poli horní/dolní polovina, ve dvou polích levé/pravé pole.
    const boardWrap = document.querySelector('.board-wrap');
    const gestures = new Map(); // pointerId -> stav gesta
    const gesturePlayers = new Set();

    function gesturePlayer(e) {
      const r = boardWrap.getBoundingClientRect();
      if (dual) return e.clientX < r.left + r.width / 2 ? 1 : 2;
      return e.clientY < r.top + r.height / 2 ? 1 : 2;
    }

    boardWrap.addEventListener('pointerdown', e => {
      if (!touchMode || e.pointerType === 'mouse' || game.state !== 'playing') return;
      const pid = gesturePlayer(e);
      if (gesturePlayers.has(pid)) return;
      e.preventDefault();
      boardWrap.setPointerCapture(e.pointerId);
      gesturePlayers.add(pid);
      gestures.set(e.pointerId, {
        pid, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
        t0: performance.now(), accX: 0, accY: 0, moved: false, samples: [{ t: performance.now(), y: e.clientY }],
      });
    });

    boardWrap.addEventListener('pointermove', e => {
      const g = gestures.get(e.pointerId);
      if (!g) return;
      e.preventDefault();
      if (game.state !== 'playing') return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      g.x = e.clientX;
      g.y = e.clientY;
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 12) g.moved = true;
      const now = performance.now();
      g.samples.push({ t: now, y: e.clientY });
      while (g.samples.length > 1 && now - g.samples[0].t > 120) g.samples.shift();

      const step = Math.max(cell, 14);
      g.accX += dx;
      while (Math.abs(g.accX) >= step) {
        const dir = Math.sign(g.accX);
        act(g.pid, dir < 0 ? 'left' : 'right');
        g.accX -= dir * step;
      }
      const toward = g.pid === 2 && !dual ? -dy : dy;
      g.accY = Math.max(0, g.accY + toward);
      while (g.accY >= step) {
        act(g.pid, 'soft');
        g.accY -= step;
      }
    });

    function endGesture(e) {
      const g = gestures.get(e.pointerId);
      if (!g) return;
      gestures.delete(e.pointerId);
      gesturePlayers.delete(g.pid);
      if (game.state !== 'playing' || e.type === 'pointercancel') return;
      const now = performance.now();
      if (!g.moved && now - g.t0 < 300) { act(g.pid, 'rotate'); return; }
      const first = g.samples[0];
      const sign = g.pid === 2 && !dual ? -1 : 1;
      const speed = sign * (e.clientY - first.y) / Math.max(1, now - first.t);
      if (speed > 1 && sign * (e.clientY - g.startY) > 2 * cell) act(g.pid, 'hard');
    }
    boardWrap.addEventListener('pointerup', endGesture);
    boardWrap.addEventListener('pointercancel', endGesture);
    boardWrap.addEventListener('contextmenu', e => { if (touchMode) e.preventDefault(); });

    function setTouch(value) {
      if (value === touchMode) return;
      touchMode = value;
      document.body.classList.toggle('touch', value);
      held.clear();
      lastOverlay = null;
      resize();
    }

    el('touchPause').addEventListener('click', () => game.togglePause());
    window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') setTouch(true); }, true);
    coarse.addEventListener('change', () => setTouch(coarse.matches));
    setTouch(coarse.matches);

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(50, now - last);
      last = now;
      processHeld(dt);
      game.update(dt);
      render();
      if (menuOpen()) updateBg(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Game, COLS, ROWS, HALF, EMPTY, WALL_P1, WALL_P2, TYPES, PUSH_POWER };
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
    else initUI();
  }
})(typeof window !== 'undefined' ? window : globalThis);
