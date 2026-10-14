/* VitoWeb card art, drawn on canvas. Shared by the hub and every card game.
   Ids follow the Murlan engine: 0..51 -> rank 3 + (id>>2) (14 = A, 15 = 2), suit id&3 (0 ♠ 1 ♥ 2 ♦ 3 ♣), 52/53 jokers. */
window.VWCards = (() => {
  const PX = 300, PY = 420;
  const RANKS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' };
  const artRank = id => 3 + (id >> 2);
  const artSuit = id => id & 3;
  const COL2 = ['#1b1f27', '#c3263b', '#c3263b', '#1b1f27'];
  const COL4 = ['#1b1f27', '#c3263b', '#1d63c4', '#17824a'];
  const FONT = '"Barlow Condensed","Arial Narrow",Arial,sans-serif';

  function suitPath(s) {
    const p = new Path2D();
    if (s === 1) p.addPath(new Path2D('M50 90C22 68 4 52 4 31C4 15 16 5 29 5C39 5 46 11 50 20C54 11 61 5 71 5C84 5 96 15 96 31C96 52 78 68 50 90Z'));
    else if (s === 2) p.addPath(new Path2D('M50 2L87 50L50 98L13 50Z'));
    else if (s === 0) p.addPath(new Path2D('M50 3C41 20 6 38 6 61C6 75 16 83 28 83C37 83 44 79 47 73C46 84 41 91 33 96L67 96C59 91 54 84 53 73C56 79 63 83 72 83C84 83 94 75 94 61C94 38 59 20 50 3Z'));
    else {
      p.arc(50, 27, 20, 0, Math.PI * 2); p.moveTo(48, 57); p.arc(28, 57, 20, 0, Math.PI * 2); p.moveTo(92, 57); p.arc(72, 57, 20, 0, Math.PI * 2);
      p.addPath(new Path2D('M46 50C46 76 42 88 32 96L68 96C58 88 54 76 54 50Z'));
    }
    return p;
  }
  const SUIT = [0, 1, 2, 3].map(suitPath);
  function pip(ctx, s, x, y, size, col, flip) {
    ctx.save(); ctx.translate(x, y); if (flip) ctx.rotate(Math.PI); const k = size / 100; ctx.scale(k, k); ctx.translate(-50, -50);
    ctx.fillStyle = col; ctx.fill(SUIT[s]); ctx.restore();
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /* VitoWeb mark, rebuilt as a vector from the supplied logo (coords from the 1440px file) */
  const LOGO = new Path2D('M310 428L460 428L615 735L775 428L925 428L652 983Q615 1036 578 983Z M985 428L1140 428L864 983Q828 1036 793 983L752 900Z');
  function logo(ctx, cx, cy, h, mode) {
    const k = h / 600; ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-725, -725);
    const g = ctx.createLinearGradient(0, 428, 0, 1020);
    if (mode === 'mono') { g.addColorStop(0, '#9aa2b0'); g.addColorStop(.55, '#454c59'); g.addColorStop(1, '#14181f'); }
    else if (mode === 'white') { g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, '#ffffff'); }
    else { g.addColorStop(0, '#2c5361'); g.addColorStop(.33, '#7c2262'); g.addColorStop(.7, '#e9527f'); g.addColorStop(1, '#f8c6d0'); }
    ctx.fillStyle = g; ctx.fill(LOGO); ctx.restore();
  }
  const PIPS = {
    2: [[.5, 0], [.5, 1]], 3: [[.5, 0], [.5, .5], [.5, 1]], 4: [[0, 0], [1, 0], [0, 1], [1, 1]],
    5: [[0, 0], [1, 0], [.5, .5], [0, 1], [1, 1]], 6: [[0, 0], [1, 0], [0, .5], [1, .5], [0, 1], [1, 1]],
    7: [[0, 0], [1, 0], [.5, .25], [0, .5], [1, .5], [0, 1], [1, 1]], 8: [[0, 0], [1, 0], [.5, .25], [0, .5], [1, .5], [.5, .75], [0, 1], [1, 1]],
    9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [.5, .5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
    10: [[0, 0], [1, 0], [.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [.5, 5 / 6], [0, 1], [1, 1]]
  };
  function blank(ctx, fill) { rr(ctx, 1, 1, PX - 2, PY - 2, 24); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.stroke(); }
  function indexCorner(ctx, label, s, col) {
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${label.length > 1 ? 70 : 76}px ${FONT}`;
    ctx.fillText(label, 42, 74);
    pip(ctx, s, 42, 106, 40, col);
  }
  function crown(ctx, kind, col) {
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    if (kind === 13) {
      ctx.beginPath(); ctx.moveTo(116, 142); ctx.lineTo(116, 102); ctx.lineTo(133, 122); ctx.lineTo(150, 92); ctx.lineTo(167, 122); ctx.lineTo(184, 102); ctx.lineTo(184, 142); ctx.closePath(); ctx.fill();
      ctx.fillRect(112, 146, 76, 9);
      [[116, 98], [150, 88], [184, 98]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); });
    } else if (kind === 12) {
      ctx.beginPath(); ctx.moveTo(112, 150); ctx.quadraticCurveTo(150, 136, 188, 150); ctx.lineTo(186, 140); ctx.quadraticCurveTo(170, 98, 150, 96); ctx.quadraticCurveTo(130, 98, 114, 140); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fbfaf6'; [[150, 118, 8], [131, 130, 5], [169, 130, 5]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); });
    } else {
      ctx.beginPath(); ctx.ellipse(150, 146, 42, 9, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(150, 142, 24, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(166, 126); ctx.quadraticCurveTo(190, 112, 194, 86); ctx.quadraticCurveTo(178, 104, 160, 116); ctx.closePath(); ctx.fill();
    }
  }
  function drawJoker(c, ctx, color) {
    const bg = color ? '#141e30' : '#fbfaf6', ink = color ? '#f07a9c' : '#1b1f27';
    blank(ctx, bg);
    if (color) { rr(ctx, 14, 14, PX - 28, PY - 28, 16); ctx.strokeStyle = 'rgba(240,122,156,.35)'; ctx.lineWidth = 2; ctx.stroke(); }
    logo(ctx, 150, 205, 150, color ? 'color' : 'mono');
    ctx.fillStyle = color ? '#e9b3c4' : '#5a6170'; ctx.textAlign = 'center'; ctx.font = `600 22px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.fillText('VITOWEB', 153, 318);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const corner = () => { ctx.fillStyle = ink; ctx.font = `700 30px ${FONT}`; ctx.textAlign = 'center'; 'JOKER'.split('').forEach((ch, i) => ctx.fillText(ch, 38, 52 + i * 30)); };
    corner(); ctx.save(); ctx.translate(PX, PY); ctx.rotate(Math.PI); corner(); ctx.restore();
    return c;
  }
  function drawFace(id, colors) {
    const c = document.createElement('canvas'); c.width = PX; c.height = PY; const ctx = c.getContext('2d');
    if (id >= 52) return drawJoker(c, ctx, id === 53);
    const r = artRank(id), s = artSuit(id), col = (colors === '4' ? COL4 : COL2)[s];
    const label = RANKS[r] || String(r);
    blank(ctx, '#fbfaf6');
    indexCorner(ctx, label, s, col);
    ctx.save(); ctx.translate(PX, PY); ctx.rotate(Math.PI); indexCorner(ctx, label, s, col); ctx.restore();
    if (r === 14) {
      pip(ctx, s, 150, 210, s === 0 ? 150 : 120, col);
      if (s === 0) logo(ctx, 150, 206, 30, 'white');
    } else if (r >= 11 && r <= 13) {
      rr(ctx, 82, 34, 136, 352, 12); ctx.fillStyle = col + '14'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.stroke();
      const half = () => { crown(ctx, r, col); pip(ctx, s, 150, 185, 44, col); };
      half(); ctx.save(); ctx.translate(PX, PY); ctx.rotate(Math.PI); half(); ctx.restore();
      ctx.strokeStyle = col + '55'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(96, 210); ctx.lineTo(204, 210); ctx.stroke();
    } else {
      const x0 = 106, x1 = 194, y0 = 70, y1 = 350;
      for (const [px, py] of PIPS[r === 15 ? 2 : r]) pip(ctx, s, x0 + px * (x1 - x0), y0 + py * (y1 - y0), r === 10 ? 50 : 54, col, py > .5);
    }
    return c;
  }
  function drawBack() {
    const c = document.createElement('canvas'); c.width = PX; c.height = PY; const ctx = c.getContext('2d');
    blank(ctx, '#fbfaf6');
    rr(ctx, 13, 13, PX - 26, PY - 26, 16); ctx.fillStyle = '#141e30'; ctx.fill();
    ctx.save(); rr(ctx, 13, 13, PX - 26, PY - 26, 16); ctx.clip();
    ctx.strokeStyle = 'rgba(239,90,134,.13)'; ctx.lineWidth = 2;
    for (let i = -PY; i < PX + PY; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - PY, PY); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i - PY, 0); ctx.lineTo(i, PY); ctx.stroke(); }
    ctx.restore();
    rr(ctx, 26, 26, PX - 52, PY - 52, 10); ctx.strokeStyle = 'rgba(248,198,208,.35)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(150, 210, 62, 0, 7); ctx.fillStyle = '#141e30'; ctx.fill(); ctx.strokeStyle = 'rgba(248,198,208,.35)'; ctx.stroke();
    logo(ctx, 150, 206, 62, 'color');
    return c;
  }
  const toURL = c => new Promise(res => c.toBlob(b => res(URL.createObjectURL(b)), 'image/png'));
  function logoURL(size, mode) { const c = document.createElement('canvas'); c.width = c.height = size; logo(c.getContext('2d'), size / 2, size / 2, size * .7, mode || 'color'); return toURL(c); }
  return { PX, PY, FONT, drawFace, drawBack, logo, logoURL, toURL };
})();
