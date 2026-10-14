/* ===== Your hand: rearrange and play by dragging (shared by every table game) =====
   Sideways drag  -> move the card inside your hand. The order is yours; nothing re-sorts it on its own.
   Upward drag    -> lift. If the card you grab is selected, every selected card comes with it and they
                     gather under your finger. Let go over the table (the outlined area) to play them.
                     Let go anywhere else, or put a second finger down, and they go back to your hand.
   A tap is still a tap (select / deselect). Nothing plays from a tap or a double tap.

   One finger at a time: a second pointer cancels whatever the first one was doing, a lost pointer
   (call, notification, app switch) cancels too. Nothing is ever played by accident.

   Usage, in the game's script:  const HD = HAND.attach({ ...adapter });  see attach() below. */
const HAND = (() => {
  const MOVE_PX = 10;          // finger movement (stage px) before a press becomes a drag
  const css = document.createElement('style');
  css.textContent = `
.dropzone{position:absolute;border-radius:28px;pointer-events:none;z-index:90;opacity:0;transition:opacity .16s,box-shadow .16s,background .16s;
  box-shadow:inset 0 0 0 2px rgba(255,255,255,.18);background:rgba(255,255,255,.025)}
.dropzone.on{opacity:1}
.dropzone.over{box-shadow:inset 0 0 0 3px rgba(239,90,134,.85),0 0 40px rgba(239,90,134,.18);background:rgba(239,90,134,.07)}
.dropzone.bad{box-shadow:none;outline:3px dashed rgba(255,130,110,.6);outline-offset:-3px;background:rgba(255,90,70,.06)}
.lifted{transition:box-shadow .15s,filter .2s!important;box-shadow:0 0 0 2px rgba(255,255,255,.75),0 22px 40px rgba(0,0,0,.55)!important;filter:none!important}`;
  document.head.appendChild(css);

  let A = null, D = null, endT = 0, zoneEl = null;

  function attach(adapter){
    A = Object.assign({
      sel: '.mine',
      canArrange: () => true, canLift: () => false,
      lift: id => [id], check: () => ({ ok: true }), drop: () => {}, unlift: () => {},
      zone: { x0: 300, y0: 150, x1: 980, y1: 500 }, sound: () => {},
    }, adapter);
    const z = A.zone;
    zoneEl = document.createElement('div'); zoneEl.className = 'dropzone';
    Object.assign(zoneEl.style, { left: z.x0 + 'px', top: z.y0 + 'px', width: (z.x1 - z.x0) + 'px', height: (z.y1 - z.y0) + 'px' });
    A.box.parentNode.insertBefore(zoneEl, A.box);

    A.box.addEventListener('pointerdown', down);
    // a second finger anywhere on the screen cancels a drag in progress
    addEventListener('pointerdown', e => { if (D && e.pointerId !== D.pid) cancel(); }, true);
    addEventListener('pointermove', move, { passive: false });
    addEventListener('pointerup', up);
    addEventListener('pointercancel', e => { if (D && e.pointerId === D.pid) cancel(); });
    addEventListener('blur', () => cancel());
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
    // a drag must never also count as a tap
    A.box.addEventListener('click', e => { if (D || performance.now() - endT < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
    return api;
  }

  function down(e){
    if (D) { if (e.pointerId !== D.pid) cancel(); return; }       // a second finger: drop everything
    if (e.button > 0) return;
    const el = e.target.closest(A.sel); if (!el) return;
    const id = +el.dataset.id;
    if (!A.order().includes(id)) return;
    const p = A.point(e);
    D = { pid: e.pointerId, id, el, x0: p.x, y0: p.y, mode: null, ids: [], dx: 0, last: p };
  }

  function move(e){
    if (!D || e.pointerId !== D.pid) return;
    const p = A.point(e); D.last = p;
    if (!D.mode) {
      const dx = p.x - D.x0, dy = p.y - D.y0;
      if (Math.hypot(dx, dy) < MOVE_PX) return;
      if (!A.order().includes(D.id)) { D = null; return; }
      if (dy < 0 && -dy > Math.abs(dx) * 1.1 && A.canLift()) startLift();
      else if (A.canArrange()) startArrange();
      else { D = null; return; }
    }
    e.preventDefault();
    if (D.mode === 'arrange') arrange(p); else follow(p);
  }

  function up(e){
    if (!D || e.pointerId !== D.pid) return;
    const d = D;
    if (!d.mode) { D = null; return; }                              // a plain tap: the click handler takes it
    endT = performance.now();
    if (d.mode === 'arrange') { D = null; d.el.classList.remove('drag'); A.relayout(); A.sound('drop'); return; }
    const res = inZone(d.last) && A.canLift() ? A.check(d.ids, d.last) : null;
    D = null; clearLift(d);
    if (res && res.ok) { A.sound('play'); A.drop(d.ids, res.target); }
    else { A.unlift(d.ids); A.relayout(); A.sound('back'); }
  }

  function cancel(){
    const d = D; if (!d) return;
    D = null; endT = performance.now();
    if (d.mode === 'arrange') d.el.classList.remove('drag');
    if (d.mode === 'lift') { clearLift(d); A.unlift(d.ids); }
    if (d.mode) A.relayout();
  }

  // ---- rearranging ----
  function startArrange(){
    D.mode = 'arrange'; D.el.classList.add('drag');
    const o = A.order();
    D.dx = A.geom(o.indexOf(D.id), o.length).x - D.x0;
    A.sound('pick');
  }
  function arrange(p){
    const o = A.order(), n = o.length, x = p.x + D.dx;
    const cur = o.indexOf(D.id);
    if (cur < 0) return cancel();
    let best = 0, bd = 1e9;
    for (let i = 0; i < n; i++) { const q = Math.abs(A.geom(i, n).x - x); if (q < bd) { bd = q; best = i; } }
    if (best !== cur) { o.splice(cur, 1); o.splice(best, 0, D.id); A.relayout(); A.sound('slide'); }
    const g = A.geom(best, n);
    A.place(D.id, Math.max(70, Math.min(1210, x)), g.y - 44, 0, 1.06, 390);
  }

  // ---- lifting ----
  function startLift(){
    const ids = A.lift(D.id);
    if (!ids || !ids.length) { D = null; return; }
    D.mode = 'lift'; D.ids = ids;
    for (const id of ids) A.el(id).classList.add('lifted');
    zoneEl.classList.add('on');
    A.relayout();                                                   // the rest of the hand closes the gap
    A.sound('pick');
  }
  function follow(p){
    if (!A.canLift()) return cancel();                              // the turn ended under your finger
    const k = D.ids.length, spread = k > 8 ? 16 : k > 5 ? 20 : 26;
    D.ids.forEach((id, i) => {
      const o = i - (k - 1) / 2;
      A.place(id, Math.max(70, Math.min(1210, p.x + o * spread)), Math.max(90, p.y - 70), o * 3, 1.04, 500 + i);
    });
    const over = inZone(p);
    let ok = false;
    if (over) { const r = A.check(D.ids, p); ok = !!(r && r.ok); }
    zoneEl.classList.toggle('over', over && ok);
    zoneEl.classList.toggle('bad', over && !ok);
  }
  function clearLift(d){
    for (const id of d.ids) A.el(id).classList.remove('lifted');
    zoneEl.classList.remove('on', 'over', 'bad');
  }
  const inZone = p => { const z = A.zone; return p.x >= z.x0 - 40 && p.x <= z.x1 + 40 && p.y >= z.y0 - 40 && p.y <= z.y1; };

  const api = {
    attach,
    held: id => !!D && !!D.mode && (D.mode === 'arrange' ? D.id === id : D.ids.includes(id)),
    lifted: id => !!D && D.mode === 'lift' && D.ids.includes(id),
    busy: () => !!D && !!D.mode,
    cancel,
  };
  return api;
})();
