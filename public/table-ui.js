/* ===== Table controls, shared by the four table games =====
   Top bar:    ‹ back · game · score chip ········ status ········ full screen · RENDIT · PAUZË
   Bottom:     the "nothing to play" button on the left (PAS), the play button on the right (LUAJ).
               Your hand sits between them. Your own score lives in the top bar, not on a plate.
   Pause menu: rules, the deck, sound, full screen, settings, leave the table.
   This file only re-arranges each game's own buttons and clicks them; the game keeps its logic.
   Load it after the game's script. */
(() => {
  const $ = s => document.querySelector(s);
  const top = $('.top .r'), stage = $('#stage');
  if (!top || !stage) return;

  const css = document.createElement('style');
  css.textContent = `
.top{height:58px!important;z-index:450}
.top .l{min-width:0!important;gap:14px!important}
.top .r{min-width:0!important;gap:10px!important}
.top .l .ib{width:56px;height:48px;border-radius:12px}
.top .l .ib svg,.top .r .ib svg{width:26px;height:26px}
.top .r .ib.hideTop{display:none}
.top .r .ib{width:54px;height:46px;border-radius:12px;color:var(--ink);background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
.top .r .ib.tlbl{width:auto;padding:0 16px 0 12px;gap:8px;display:flex;align-items:center;font:700 17px var(--f-ui, system-ui);letter-spacing:.06em}
.top .r .ib.tlbl svg{width:22px;height:22px}
.meta{display:flex;align-items:center;gap:10px;height:40px;padding:0 14px;border-radius:12px;background:rgba(255,255,255,.06);
  font:600 17px var(--f-ui, system-ui)!important;letter-spacing:.04em!important;color:var(--sub)!important;white-space:nowrap}
.meta:empty{display:none}
.meta b{color:var(--ink);font-size:21px;font-weight:700;margin-left:4px;font-variant-numeric:tabular-nums}
.meta i{font-style:normal;opacity:.45}
.meta .us b{color:var(--pink)}
.meta .gold{color:#1a2233;background:var(--gold);border-radius:8px;padding:2px 8px;font-weight:700;letter-spacing:.06em;font-size:14px}
.status{font-size:20px!important;max-width:470px;overflow:hidden;text-overflow:ellipsis}
#pl0{display:none!important}
#bHint{display:none!important}
.acts{left:22px!important;right:22px!important;width:auto!important;bottom:16px!important;display:flex!important;justify-content:space-between;align-items:flex-end;pointer-events:none;gap:0!important}
.acts .btn{pointer-events:auto;width:250px;height:100px;border-radius:20px;font-size:30px;order:1}
.acts .btn.main{order:2;font-size:36px}
.acts .btn.left{order:1}
.acts .btn.hot:not(:disabled){color:#fff;background:linear-gradient(#f06a92,var(--pink) 45%,var(--pink-dk));box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 6px 18px rgba(176,42,99,.35)}
.acts .btn:disabled{opacity:1;color:rgba(255,255,255,.26);background:rgba(14,22,38,.7);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.07)}
.acts .btn:not(:disabled):active{transform:scale(.96)}
#ovMenu .panel{width:540px;padding:26px 28px}
#ovMenu h2{margin:0 0 16px;font:800 30px var(--f-ui, system-ui);color:var(--ink)}
#ovMenu .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
#ovMenu .mb{height:60px;border:0;border-radius:14px;display:flex;align-items:center;gap:10px;padding:0 16px;cursor:pointer;
  background:rgba(255,255,255,.07);color:var(--ink);font:700 19px var(--f-ui, system-ui);text-align:left}
#ovMenu .mb svg{width:22px;height:22px;flex:none;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
#ovMenu .mb.danger{color:#ff9db8}
#ovMenu .mb:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
`;
  document.head.appendChild(css);

  const ICON = {
    pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
    rules: '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 8h6M9 12h6"/></svg>',
    deck: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="11" height="15" rx="2"/><path d="M8 5V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-5"/></svg>',
    sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    set: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    exit: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  };

  // top bar: RENDIT (where the game sorts), full screen, PAUZË. The rest goes into the pause menu.
  const bSort = document.querySelector('#bSort');
  if (bSort) {
    bSort.classList.add('tlbl');
    if (!bSort.closest('.top')) { bSort.classList.remove('btn'); bSort.classList.add('ib'); bSort.innerHTML = ''; }
    bSort.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h9M4 12h6M4 18h3M17 5v14M14 16l3 3 3-3"/></svg><span>RENDIT</span>';
    top.prepend(bSort);
  }
  ['#bRules', '#bDeck', '#bSound', '#bSet'].forEach(id => { const b = top.querySelector(id); if (b) b.classList.add('hideTop'); });
  const bFull = $('#bFull');
  if (bFull && !bFull.hidden) top.appendChild(bFull);

  const bMenu = document.createElement('button');
  bMenu.className = 'ib tlbl'; bMenu.id = 'bMenu'; bMenu.type = 'button';
  bMenu.setAttribute('aria-label', 'Pauzë'); bMenu.innerHTML = ICON.pause + '<span>PAUZË</span>';
  top.appendChild(bMenu);

  // pause menu, under the game's own panels (rules, settings) so they open on top of it
  const ov = document.createElement('div');
  ov.className = 'ov'; ov.id = 'ovMenu'; ov.hidden = true;
  const deckLabel = ($('#bDeck') && $('#bDeck').getAttribute('aria-label')) || 'Shiko letrat';
  const rows = [
    ['rules', 'Rregullat', '#bRules'],
    ['deck', deckLabel, '#bDeck'],
    ['sound', 'Zëri', '#bSound'],
    ['full', 'Ekran i plotë', '#bFull'],
    ['set', 'Cilësimet', '#bSet'],
    ['exit', 'Dil nga tavolina', '#bHome'],
  ].filter(r => { const b = $(r[2]); return b && !b.hidden; });
  ov.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="Pauzë">
    <h2>Pauzë</h2>
    <button class="pbtn" id="mResume" type="button">Vazhdo</button>
    <div class="grid">${rows.map(r => `<button class="mb${r[0] === 'exit' ? ' danger' : ''}" type="button" data-k="${r[2]}">${ICON[r[0]]}<span>${r[1]}</span></button>`).join('')}</div>
  </div>`;
  const firstOv = stage.querySelector('.ov');
  firstOv ? stage.insertBefore(ov, firstOv) : stage.appendChild(ov);

  const soundLabel = () => {
    const b = ov.querySelector('[data-k="#bSound"] span'), s = $('#bSound');
    if (b && s) b.textContent = s.classList.contains('off') ? 'Zëri: fikur' : 'Zëri: ndezur';
  };
  const open = () => { soundLabel(); ov.hidden = false; $('#mResume').focus(); };
  const close = () => { ov.hidden = true; };
  bMenu.addEventListener('click', open);
  $('#mResume').addEventListener('click', close);
  ov.addEventListener('click', e => {
    if (e.target === ov) return close();
    const b = e.target.closest('.mb'); if (!b) return;
    const target = $(b.dataset.k); if (!target) return;
    if (b.dataset.k === '#bSound') { target.click(); soundLabel(); return; }
    if (b.dataset.k === '#bHome' || b.dataset.k === '#bFull') close();
    target.click();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !document.getElementById('menu') || !document.getElementById('menu').hidden) return;
    if (!ov.hidden) close();
    else if (!document.querySelector('#stage .ov:not([hidden]):not(#ovMenu)')) open();
  });

  // end-of-hand panel: games and net.js put their own buttons in a row under the result (ENDP.set), or go back to #bNext
  const endPanel = $('#ovEnd .panel'), bNextEl = $('#bNext');
  if (endPanel && bNextEl) {
    const row = document.createElement('div'); row.id = 'endActs'; row.hidden = true;
    const note = document.createElement('p'); note.id = 'endVote'; note.hidden = true;
    bNextEl.after(row); row.after(note);
    const st = document.createElement('style');
    st.textContent = `#endActs{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:10px;margin-top:14px}
#endActs .pbtn{margin:0}
#endActs .pbtn.on{background:#2f8a62}
#endVote{margin:12px 0 0;text-align:center;color:var(--sub);font-size:17px;font-variant-numeric:tabular-nums}`;
    document.head.appendChild(st);
    window.ENDP = {
      set(btns, txt){
        bNextEl.hidden = true; row.hidden = false; row.textContent = '';
        for (const b of btns) {
          const el = document.createElement('button'); el.type = 'button';
          el.className = 'pbtn' + (b.primary ? '' : ' ghost') + (b.on ? ' on' : '');
          el.textContent = b.label; el.onclick = b.click; row.appendChild(el);
        }
        note.hidden = !txt; note.textContent = txt || '';
      },
      note(txt){ note.hidden = !txt; note.textContent = txt || ''; },
      reset(){ bNextEl.hidden = false; row.hidden = true; row.textContent = ''; note.hidden = true; },
    };
  }

  // ads: a small one under the rules title, a full-screen break between hands (see ads.js)
  if (typeof ADS !== 'undefined') {
    const rp = $('#ovRules .panel');
    if (rp) {
      const d = document.createElement('div'); d.className = 'adslot'; d.dataset.ad = 'rules';
      const h = rp.querySelector('h2'); h ? h.after(d) : rp.prepend(d); ADS.fill(rp);
    }
    const bNext = $('#bNext');
    if (bNext && ADS.on) bNext.addEventListener('click', e => {
      if (bNext._adDone) { bNext._adDone = false; return; }
      e.stopImmediatePropagation();
      ADS.between(document.title, () => { bNext._adDone = true; bNext.click(); });
    }, true);
  }
})();
