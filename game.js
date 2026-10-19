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

    level() { return 1 + Math.floor(this.elapsed / 45000); }

    dropInterval() { return Math.max(90, 850 * Math.pow(0.82, this.level() - 1)); }

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
        this.lose(p, 'Nová kostka se mu už nevejde na jeho polovinu.');
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
          this.lose(opp, 'Soupeř ho vytlačil z jeho poloviny.');
          return;
        }
        for (let y = ROWS - 1; y > this.wallTop; y--) g[y] = g[y - 1];
        g[this.wallTop] = wallRow(WALL_P1);
        this.wallBot++;
      } else {
        if (g[0].some(c => c !== EMPTY)) {
          this.lose(opp, 'Soupeř ho vytlačil z jeho poloviny.');
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
          this.lose(opp, 'Soupeř ho vytlačil z jeho poloviny.');
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
  const PALETTE = {
    1: ['#4fc3f7', '#80deea', '#7986cb', '#26c6da', '#42a5f5', '#5c6bc0', '#4dd0e1'],
    2: ['#ef5350', '#ffb74d', '#ec407a', '#ff7043', '#f44336', '#ff8a65', '#ffa726'],
  };
  const WALL_COLORS = { [WALL_P1]: '#2f4d73', [WALL_P2]: '#73303d' };
  const PLAYER_COLORS = { 1: '#4fc3f7', 2: '#ff7043' };

  function cellColor(v) {
    if (v === WALL_P1 || v === WALL_P2) return WALL_COLORS[v];
    return PALETTE[Math.floor(v / 10)][v % 10];
  }

  function drawBlock(ctx, px, py, s, color) {
    ctx.fillStyle = color;
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
    const b = Math.max(2, Math.round(s * 0.14));
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(px + 1, py + 1, s - 2, b);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px + 1, py + s - 1 - b, s - 2, b);
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
    let cell = 20;
    let dual = false;

    function resize() {
      const boards = dual ? 2 : 1;
      // Šířka bočních panelů, mezer a okrajů (viz style.css).
      const chrome = 2 * 200 + (boards + 1) * 24 + 24 + boards * 4;
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

    const MODE_KEY = 'tetris-view-mode';
    function setDual(value) {
      dual = value;
      app.classList.toggle('dual', dual);
      held.clear();
      try { localStorage.setItem(MODE_KEY, dual ? 'dual' : 'single'); } catch (e) { /* bez úložiště */ }
      resize();
    }
    let savedMode = null;
    try { savedMode = localStorage.getItem(MODE_KEY); } catch (e) { /* bez úložiště */ }
    setDual(savedMode === 'dual');

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
      const btn = e.target.closest('[data-mode]');
      if (!btn || game.state === 'playing') return;
      btn.blur();
      setDual(btn.dataset.mode === 'dual');
    });

    window.addEventListener('keydown', e => {
      const mapped = (dual ? KEYMAP_DUAL : KEYMAP)[e.code];
      if (mapped || ['KeyP', 'KeyR', 'KeyM', 'Escape'].includes(e.code)) e.preventDefault();

      if (game.state === 'ready' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) {
        if (!e.repeat) game.start();
        return;
      }
      if (e.code === 'KeyM') {
        if (!e.repeat && game.state !== 'playing') setDual(!dual);
        return;
      }
      if (e.code === 'KeyP' || e.code === 'Escape') { if (!e.repeat) game.togglePause(); return; }
      if (e.code === 'KeyR' && (game.state === 'over' || game.state === 'paused')) {
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

      renderOverlay();
    }

    // Vykreslí celou hrací plochu; při flip je svisle převrácená (řada 0 dole).
    function renderBoard({ canvas, ctx, flip }) {
      const s = cell;
      const W = canvas.width;
      const ry = y => (flip ? ROWS - 1 - y : y) * s;
      // Obdélník přes řady [a, b)
      const band = (a, b) => [(flip ? ROWS - b : a) * s, (b - a) * s];

      ctx.fillStyle = '#0b0e17';
      ctx.fillRect(0, 0, W, canvas.height);
      let [y0, h] = band(0, game.wallTop);
      ctx.fillStyle = '#0f1a33';
      ctx.fillRect(0, y0, W, h);
      [y0, h] = band(game.wallBot, ROWS);
      ctx.fillStyle = '#2a1119';
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
          if (v === WALL_P1 || v === WALL_P2) drawWall(ctx, x * s, ry(y), s, cellColor(v));
          else drawBlock(ctx, x * s, ry(y), s, cellColor(v));
        }
      }

      if (game.flash) {
        const top = Math.max(0, game.wallTop - 1);
        const bot = Math.min(ROWS, game.wallBot + 1);
        [y0, h] = band(top, bot);
        ctx.fillStyle = PLAYER_COLORS[game.flash.player];
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
          if (c) drawBlock(ctx, (pc.x + mx) * s, ry(pc.y + my), s, color);
        }));
      }

      renderFlashText(ctx, canvas, s, flip);
    }

    const FLASH_LABELS = ['', '', 'Dvojitá', 'Trojitá', 'TETRIS'];

    function renderFlashText(ctx, canvas, s, flip) {
      const f = game.flash;
      if (!f) return;
      const label = (FLASH_LABELS[f.lines] ? FLASH_LABELS[f.lines] + '  ' : '') + '+' + f.power;
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
      ctx.fillStyle = f.lines >= 4 ? '#ffeb3b' : PLAYER_COLORS[f.player];
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
      const color = cellColor(p.id * 10 + TYPES.indexOf(p.nextType));
      for (const [x, y] of cells) drawBlock(nctx, ox + x * cs, oy + y * cs, cs, color);
    }

    function modeSwitch() {
      return '<div class="mode-switch">' +
        `<button type="button" data-mode="single" class="${dual ? '' : 'active'}">Jedno pole</button>` +
        `<button type="button" data-mode="dual" class="${dual ? 'active' : ''}">Dvě pole</button>` +
        '</div><p class="hint"><kbd>M</kbd> přepnout zobrazení</p>';
    }

    let lastOverlay = null;
    function renderOverlay() {
      let html = '';
      if (game.state === 'ready') {
        html = '<h1>Tetris<br>přetlačovaná</h1>' +
          (dual
            ? '<p>Každý hráč má své pole a kostky mu padají shora. Pod čárou ve středu vidíš, jak hraje soupeř.</p>'
            : '<p>Hráč 1 hraje shora, hráč 2 zdola.</p>') +
          '<p>Plná řada nezmizí – stane se zdí a zatlačí soupeře o řadu dál. ' +
          'Soupeřovu zeď naopak tvoje plná řada zničí a uvolní ti místo.</p>' +
          '<p>Víc řad najednou = silnější útok: 1 / 2 / 4 / 6.</p>' +
          '<p>Vytlač soupeře z jeho poloviny!</p>' +
          modeSwitch() +
          '<p class="hint">Start: <kbd>Mezerník</kbd> nebo <kbd>Enter</kbd></p>';
      } else if (game.state === 'paused') {
        html = '<h1>Pauza</h1>' + modeSwitch() +
          '<p class="hint"><kbd>P</kbd> pokračovat &nbsp; <kbd>R</kbd> nová hra</p>';
      } else if (game.state === 'over') {
        html = `<h1 class="winner-${game.winner}">Vítězí hráč ${game.winner}!</h1>` +
          `<p>Hráč ${game.winner === 1 ? 2 : 1} prohrál: ${game.reason}</p>` +
          modeSwitch() +
          '<p class="hint"><kbd>R</kbd> nová hra</p>';
      }
      if (html !== lastOverlay) {
        overlay.innerHTML = html;
        overlay.classList.toggle('hidden', html === '');
        lastOverlay = html;
      }
    }

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(50, now - last);
      last = now;
      processHeld(dt);
      game.update(dt);
      render();
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
