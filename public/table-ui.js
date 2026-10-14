/* ===== Table controls, shared by every card/tile game =====
   The top bar used to hold six small icons. Now it keeps only two labelled buttons: RENDIT (sort,
   where the game has it) and PAUZË. Everything else (rules, look at the deck, sound, full screen,
   settings, leave) lives in the pause menu, with words, not just icons. No hint button: you play your own hand.
   The play buttons at the bottom right are big, one under the other, so a thumb finds them without looking.
   It only re-arranges the game's own buttons and clicks them, so each game keeps its own logic.
   Load it after the game's script. */
(() => {
  const $ = s => document.querySelector(s);
  const top = $('.top .r'), stage = $('#stage');
  if (!top || !stage) return;

  const css = document.createElement('style');
  css.textContent = `
.top{height:56px}
.top .r{gap:10px}
.top .l .ib{width:56px;height:48px;border-radius:12px}
.top .l .ib svg{width:28px;height:28px}
.top .r .ib.hideTop{display:none}
.top .r .ib.keep{width:auto;height:46px;padding:0 16px 0 12px;gap:8px;display:flex;align-items:center;border-radius:12px;
  color:var(--ink);font:700 17px var(--f-ui, system-ui);letter-spacing:.06em;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
.top .r .ib.keep svg{width:24px;height:24px}
/* play buttons: one column, big */
#bHint{display:none!important}
.acts{right:22px!important;bottom:16px!important;width:262px!important;grid-template-columns:1fr!important;gap:12px!important}
.acts .btn{height:84px;font-size:27px;border-radius:18px}
.acts .btn.main{height:110px;font-size:38px;border-radius:20px}
.acts .btn:disabled{opacity:1;color:rgba(255,255,255,.28);background:rgba(14,22,38,.72);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.07)}
.acts .btn:not(:disabled):active{transform:scale(.96)}
#ovMenu .panel{width:520px;padding:26px 28px}
#ovMenu h2{margin:0 0 6px;font:800 30px var(--f-ui, system-ui);color:var(--ink)}
#ovMenu .sub{margin:0 0 14px;color:var(--sub);font:500 17px var(--f-ui, system-ui)}
#ovMenu .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
#ovMenu .mb{height:58px;border:0;border-radius:14px;display:flex;align-items:center;gap:10px;padding:0 16px;cursor:pointer;
  background:rgba(255,255,255,.07);color:var(--ink);font:700 18px var(--f-ui, system-ui);text-align:left}
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
    play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
  };

  // top bar: sort (if any) + ? + pause; the rest goes into the menu
  const bSort = top.querySelector('#bSort');
  if (bSort) { bSort.classList.add('keep'); bSort.insertAdjacentHTML('beforeend', '<span>RENDIT</span>'); }
  ['#bRules', '#bDeck', '#bSound', '#bFull', '#bSet'].forEach(id => { const b = top.querySelector(id); if (b) b.classList.add('hideTop'); });

  const bMenu = document.createElement('button');
  bMenu.className = 'ib keep'; bMenu.id = 'bMenu'; bMenu.type = 'button';
  bMenu.setAttribute('aria-label', 'Pauzë dhe menuja'); bMenu.title = 'Pauzë';
  bMenu.innerHTML = ICON.pause + '<span>PAUZË</span>';
  top.appendChild(bMenu);

  // the menu sits under the game's own panels (rules, settings), so they open on top of it
  const ov = document.createElement('div');
  ov.className = 'ov'; ov.id = 'ovMenu'; ov.hidden = true;
  const deckLabel = ($('#bDeck') && $('#bDeck').getAttribute('aria-label')) || 'Shiko letrat';
  const rows = [
    ['rules', 'Rregullat', '#bRules'],
    ['deck', deckLabel, '#bDeck'],
    ['sound', 'Zëri', '#bSound', true],
    ['full', 'Ekran i plotë', '#bFull'],
    ['set', 'Cilësimet', '#bSet'],
    ['exit', 'Dil nga loja', '#bHome'],
  ].filter(r => { const b = $(r[2]); return b && !b.hidden; });
  ov.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="Pauzë">
    <h2>Pauzë</h2><p class="sub">Tavolina të pret. Shtyp Vazhdo kur të jesh gati.</p>
    <button class="pbtn" id="mResume" type="button">Vazhdo</button>
    <div class="grid">${rows.map(r => `<button class="mb${r[0] === 'exit' ? ' danger' : ''}" type="button" data-k="${r[2]}">${ICON[r[0]]}<span>${r[1]}</span></button>`).join('')}</div>
  </div>`;
  const first = $('#ovStart') || stage.querySelector('.ov');
  first ? stage.insertBefore(ov, first) : stage.appendChild(ov);

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
    if (b.dataset.k === '#bSound') { target.click(); soundLabel(); return; }   // stays open: just a toggle
    if (b.dataset.k === '#bHome' || b.dataset.k === '#bFull') close();
    target.click();
  });
  // ads: a small one at the bottom of the rules, a full-screen break between hands (see ads.js)
  if (typeof ADS !== 'undefined') {
    const rp = $('#ovRules .panel');
    if (rp) {   // under the title, far from the Mbyll button (accidental clicks break AdSense policy)
      const d = document.createElement('div'); d.className = 'adslot'; d.dataset.ad = 'rules';
      const h = rp.querySelector('h2'); h ? h.after(d) : rp.prepend(d); ADS.fill(rp);
    }
    const bNext = $('#bNext');
    if (bNext && ADS.on) bNext.addEventListener('click', e => {
      if (bNext._adDone) { bNext._adDone = false; return; }
      e.stopImmediatePropagation();
      ADS.between(document.title.split(/[·|-]/)[0].trim() || 'loja', () => { bNext._adDone = true; bNext.click(); });
    }, true);
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!ov.hidden) close();
    else if (!document.querySelector('.ov:not([hidden]):not(#ovMenu)')) open();
  });
})();
