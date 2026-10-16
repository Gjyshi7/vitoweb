/* Account: "Hyr me Google", your username, friends, and invitations to a table.
   One file for the main page and every game's start screen. It draws its own sheet and its own
   invitation banner, so the pages only need a button that calls VWA.open().
     VWA.ready            Promise, resolves once we know who you are
     VWA.me               { id, uname, name, pic } or null
     VWA.enabled          false when the site has no sign-in configured (then nothing shows)
     VWA.open(opts)       the account sheet; opts.invite = { code, game, label } adds "Fto" buttons
     VWA.onChange(fn)     called with the user (or null) whenever it changes
   Invitations arrive with the presence ping (presence.js) as a 'vw-invites' event. */
(() => {
  const GAMES = { murlan: 'Murlan', spathi: 'Spathi', derri: 'Derri në dorë', domino: 'Domino', imposter: 'Imposter', mafia: 'Mafia' };
  const PLACE = { hub: 'në faqe', murlan: 'në Murlan', spathi: 'në Spathi', derri: 'në Derri', domino: 'në Domino', imposter: 'në Imposter', mafia: 'në Mafia' };
  const ERR = { taken: 'Ky emër është i zënë.', bad_name: '3 deri në 16 shkronja, shifra, pikë ose _.', no_user: 'Nuk u gjet ky emër.', self: 'Ky je ti.',
    too_many: 'Ke shumë shokë në listë.', not_friends: 'Nuk jeni shokë.', slow_down: 'Shumë kërkesa. Provo pas pak.', bad_token: 'Hyrja me Google nuk u verifikua. Provo përsëri.' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const listeners = [];
  const A = { me: null, google: null, enabled: false };

  async function api(path, body){
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok && !j.error) j.error = 'server';
    return j;
  }
  function setMe(u){
    A.me = u || null;
    try { if (u) localStorage.setItem('vw.name', JSON.stringify(u.uname)); } catch (e) {}
    listeners.forEach(fn => { try { fn(A.me); } catch (e) {} });
    if (window.VWP && VWP.signedIn) VWP.signedIn(!!u);
  }
  A.ready = api('/api/me').then(j => { A.google = j.google || null; A.enabled = !!j.google; setMe(j.user); return A.me; }).catch(() => null);
  A.onChange = fn => { listeners.push(fn); };

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
.vwa-sh{position:fixed;inset:0;z-index:2000;background:rgba(4,7,14,.72);display:flex;align-items:flex-end;justify-content:center;padding:12px;font-family:inherit;color:#eef1f6}
.vwa-sh[hidden]{display:none}
.vwa-box{width:100%;max-width:440px;max-height:92vh;overflow:auto;background:#111a2b;border-radius:22px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 30px 60px rgba(0,0,0,.5);padding:20px 18px calc(18px + env(safe-area-inset-bottom,0px))}
@media (min-width:700px){.vwa-sh{align-items:center}}
.vwa-hd{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.vwa-av{width:46px;height:46px;border-radius:50%;flex:none;background:#b02a63;display:grid;place-items:center;font-weight:800;font-size:20px;color:#fff;overflow:hidden}
.vwa-av img{width:100%;height:100%;object-fit:cover}
.vwa-hd h3{margin:0;font-size:22px;font-weight:800;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vwa-x{width:40px;height:40px;border:0;border-radius:12px;background:rgba(255,255,255,.07);color:#cfd6e2;font-size:20px;cursor:pointer;flex:none}
.vwa-p{margin:0 0 14px;color:#9aa6b8;font-size:16px;line-height:1.4}
.vwa-lab{margin:16px 0 8px;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#9aa6b8}
.vwa-row{display:flex;gap:8px}
.vwa-in{flex:1;min-width:0;height:46px;border:0;border-radius:12px;background:#1a2438;color:#eef1f6;font:600 17px inherit;font-family:inherit;padding:0 12px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.vwa-in:focus{outline:2px solid #ef5a86}
.vwa-b{height:46px;border:0;border-radius:12px;padding:0 16px;background:#1f2b42;color:#eef1f6;font:700 16px inherit;font-family:inherit;cursor:pointer;flex:none}
.vwa-b.pri{background:linear-gradient(#f06a92,#ef5a86 45%,#b02a63);color:#fff}
.vwa-b.sm{height:36px;padding:0 12px;font-size:15px}
.vwa-b:disabled{opacity:.4}
.vwa-err{min-height:18px;margin:6px 0 0;color:#ffb3a6;font-size:14px}
.vwa-list{display:flex;flex-direction:column;gap:6px}
.vwa-f{display:flex;align-items:center;gap:10px;min-height:52px;padding:6px 6px 6px 10px;border-radius:14px;background:#162034}
.vwa-f .d{width:9px;height:9px;border-radius:50%;background:#4b5466;flex:none}
.vwa-f .d.on{background:#5fd0a8;box-shadow:0 0 0 3px rgba(95,208,168,.18)}
.vwa-f .n{flex:1;min-width:0}
.vwa-f .n b{display:block;font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vwa-f .n small{color:#9aa6b8;font-size:13px}
.vwa-empty{color:#7d889b;font-size:15px;padding:6px 2px}
.vwa-out{margin-top:18px;background:none;border:0;color:#9aa6b8;text-decoration:underline;text-underline-offset:4px;font:600 15px inherit;font-family:inherit;cursor:pointer;padding:6px 0}
.vwa-g{min-height:44px;display:flex;justify-content:center;margin:6px 0 2px}
.vwa-inv{position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top,0px));transform:translate(-50%,-140%);z-index:2100;width:min(440px,calc(100% - 20px));
  display:flex;align-items:center;gap:12px;padding:12px 12px 12px 16px;border-radius:18px;background:#111a2b;color:#eef1f6;font-family:inherit;
  box-shadow:inset 0 0 0 1.5px #ef5a86,0 18px 40px rgba(0,0,0,.5);transition:transform .35s cubic-bezier(.2,.9,.2,1)}
.vwa-inv.on{transform:translate(-50%,0)}
.vwa-inv .t{flex:1;min-width:0;font-size:16px;line-height:1.3}
.vwa-inv .t b{color:#f3c76a}
`;
  document.head.appendChild(css);

  /* ---------- the sheet ---------- */
  const sh = document.createElement('div');
  sh.className = 'vwa-sh'; sh.hidden = true; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
  sh.innerHTML = '<div class="vwa-box"></div>';
  const box = sh.firstChild;
  let ctx = {}, friends = null, busy = false;
  sh.addEventListener('click', e => { if (e.target === sh) close(); });
  function close(){ sh.hidden = true; }
  function avatar(u){ return u && u.pic ? `<span class="vwa-av"><img src="${esc(u.pic)}" alt="" referrerpolicy="no-referrer"></span>` : `<span class="vwa-av">${esc(((u && u.uname) || '?')[0].toUpperCase())}</span>`; }

  function render(){
    const u = A.me;
    if (!u) {
      box.innerHTML = `<div class="vwa-hd"><span class="vwa-av">?</span><h3>Llogaria</h3><button class="vwa-x" data-a="close" aria-label="Mbyll">×</button></div>
        <p class="vwa-p">Hyr me Google për të pasur emrin tënd, për të shtuar shokë dhe për t'i ftuar në tavolinë.</p>
        <div class="vwa-g" id="vwaG"></div><p class="vwa-err" id="vwaErr"></p>
        <p class="vwa-p" style="margin:8px 0 0;font-size:13px">Duke hyrë pranon <a href="/terms" target="_top" style="color:#9aa6b8">Terms of Service</a> dhe <a href="/privacy" target="_top" style="color:#9aa6b8">Privacy Policy</a>.</p>`;
      googleButton(box.querySelector('#vwaG'));
      return;
    }
    const f = friends || { friends: [], incoming: [], outgoing: [] };
    const inv = ctx.invite;
    const row = (x, right, sub) => `<div class="vwa-f">${x.online !== undefined ? `<i class="d ${x.online ? 'on' : ''}"></i>` : ''}<div class="n"><b>${esc(x.uname)}</b>${sub ? `<small>${sub}</small>` : ''}</div>${right || ''}</div>`;
    box.innerHTML = `<div class="vwa-hd">${avatar(u)}<h3>${esc(u.uname)}</h3><button class="vwa-x" data-a="close" aria-label="Mbyll">×</button></div>
      ${inv ? `<p class="vwa-p" style="margin:0 0 4px">Fto shokët në ${esc(inv.label || GAMES[inv.game] || 'tavolinë')}. Ata që janë në faqe e marrin ftesën menjëherë.</p>` : ''}
      ${f.incoming.length ? `<p class="vwa-lab">Kërkesa</p><div class="vwa-list">${f.incoming.map(x => row(x, `<button class="vwa-b sm pri" data-a="accept" data-id="${esc(x.id)}">Prano</button><button class="vwa-b sm" data-a="remove" data-id="${esc(x.id)}" aria-label="Refuzo">×</button>`)).join('')}</div>` : ''}
      <p class="vwa-lab">Shokët</p>
      <div class="vwa-list">${f.friends.length ? f.friends.map(x => row(x,
          inv ? (x.online ? `<button class="vwa-b sm pri" data-a="invite" data-id="${esc(x.id)}">${ctx.sent && ctx.sent[x.id] ? 'U ftua' : 'Fto'}</button>` : '') : `<button class="vwa-b sm" data-a="remove" data-id="${esc(x.id)}" data-n="${esc(x.uname)}" aria-label="Hiqe">×</button>`,
          x.online ? esc(PLACE[x.place] || 'në faqe') : 'jo në linjë')).join('')
        : `<div class="vwa-empty">${friends ? 'Ende pa shokë. Shto dikë me emrin e tij këtu poshtë.' : 'Po ngarkohen…'}</div>`}</div>
      ${f.outgoing.length ? `<div class="vwa-list" style="margin-top:6px">${f.outgoing.map(x => row(x, `<button class="vwa-b sm" data-a="remove" data-id="${esc(x.id)}" aria-label="Anulo">×</button>`, 'pret përgjigje')).join('')}</div>` : ''}
      <p class="vwa-lab">Shto shok</p>
      <div class="vwa-row"><input class="vwa-in" id="vwaAdd" maxlength="16" placeholder="Emri i tij në lojë" autocomplete="off" autocapitalize="off"><button class="vwa-b pri" data-a="add">Shto</button></div>
      <p class="vwa-lab">Emri yt në lojë</p>
      <div class="vwa-row"><input class="vwa-in" id="vwaName" maxlength="16" value="${esc(u.uname)}" autocomplete="off" autocapitalize="off"><button class="vwa-b" data-a="name">Ruaj</button></div>
      <p class="vwa-err" id="vwaErr"></p>
      <button class="vwa-out" data-a="out">Dil nga llogaria</button>
      <p class="vwa-p" style="margin:14px 0 0;font-size:13px"><a href="/privacy" target="_top" style="color:#9aa6b8">Privacy Policy</a> · <button class="vwa-out" data-a="del" style="margin:0;font-size:13px">Fshi llogarinë</button></p>`;
  }
  const err = t => { const e = box.querySelector('#vwaErr'); if (e) e.textContent = t || ''; };
  async function loadFriends(){
    if (!A.me) return;
    const j = await api('/api/friends');
    if (!j.error) { friends = j; if (!sh.hidden) render(); }
  }
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b || busy) return;
    const a = b.dataset.a, id = b.dataset.id;
    if (a === 'close') return close();
    busy = true; b.disabled = true;
    try {
      if (a === 'out') { await api('/api/auth/logout', {}); friends = null; setMe(null); render(); }
      else if (a === 'del') {
        if (!confirm('Ta fshish llogarinë? Emri, shokët dhe kërkesat fshihen përgjithmonë.')) return;
        const j = await api('/api/me/delete', {});
        if (j.error) err('Nuk u fshi. Provo përsëri.'); else { friends = null; setMe(null); render(); }
      }
      else if (a === 'name') {
        const j = await api('/api/me/uname', { uname: box.querySelector('#vwaName').value });
        if (j.error) err(ERR[j.error] || 'Nuk u ruajt.'); else { setMe(Object.assign({}, A.me, { uname: j.uname })); render(); err(''); }
      } else if (a === 'add') {
        const n = box.querySelector('#vwaAdd').value.trim(); if (!n) return;
        const j = await api('/api/friends', { action: 'add', uname: n });
        if (j.error) err(ERR[j.error] || 'Nuk u dërgua.'); else { await loadFriends(); err(j.state === 'ok' ? 'Tani jeni shokë.' : 'Kërkesa u dërgua.'); }
      } else if (a === 'accept' || a === 'remove') {
        if (a === 'remove' && b.dataset.n && !confirm(`Ta heqësh ${b.dataset.n} nga shokët?`)) return;
        const j = await api('/api/friends', { action: a, id });
        if (j.error) err(ERR[j.error] || 'Nuk u krye.'); else await loadFriends();
      } else if (a === 'invite' && ctx.invite) {
        const j = await api('/api/invite', { to: id, code: ctx.invite.code, game: ctx.invite.game });
        if (j.error) err(ERR[j.error] || 'Ftesa nuk u dërgua.'); else { ctx.sent = Object.assign(ctx.sent || {}, { [id]: true }); render(); }
      }
    } finally { busy = false; if (b.isConnected) b.disabled = false; }
  });
  box.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'vwaAdd') box.querySelector('[data-a="add"]').click();
    if (e.target.id === 'vwaName') box.querySelector('[data-a="name"]').click();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sh.hidden) close(); });

  A.open = async (opts = {}) => {
    ctx = opts; if (!sh.isConnected) document.body.appendChild(sh);
    await A.ready;
    sh.hidden = false; render(); loadFriends();
  };

  /* ---------- Google's button ---------- */
  let gisP = null;
  function gis(){
    if (gisP) return gisP;
    gisP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => res(window.google); s.onerror = () => { gisP = null; rej(new Error('gis')); };
      document.head.appendChild(s);
    });
    return gisP;
  }
  async function googleButton(el){
    if (!A.google) { el.innerHTML = '<p class="vwa-p" style="margin:0">Hyrja me Google nuk është ndezur ende në këtë faqe.</p>'; return; }
    try {
      const g = await gis();
      g.accounts.id.initialize({ client_id: A.google, ux_mode: 'popup', auto_select: false, callback: async r => {
        const j = await api('/api/auth/google', { credential: r.credential });
        if (j.error) return err(ERR[j.error] || 'Nuk u hyre. Provo përsëri.');
        setMe(j.user); friends = null; render(); loadFriends();
      } });
      g.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'sq', width: Math.min(320, el.clientWidth || 300) });
    } catch (e) { el.innerHTML = '<p class="vwa-p" style="margin:0">Google nuk u hap. Kontrollo internetin dhe provo përsëri.</p>'; }
  }

  /* ---------- invitations ---------- */
  const ban = document.createElement('div');
  ban.className = 'vwa-inv'; ban.setAttribute('role', 'alert');
  let banT = 0, queue = [];
  function nextInvite(){
    const v = queue.shift(); if (!v) return;
    if (!ban.isConnected) document.body.appendChild(ban);
    ban.innerHTML = `<div class="t"><b>${esc(v.uname)}</b> të fton në ${esc(GAMES[v.game] || 'lojë')}</div><button class="vwa-b sm pri" data-go>Hyr</button><button class="vwa-x" data-no aria-label="Mbyll">×</button>`;
    ban.querySelector('[data-go]').onclick = () => {
      const url = `/${v.game}?r=${encodeURIComponent(v.code)}`;
      try { (window.top || window).location.href = url; } catch (e) { location.href = url; }
    };
    ban.querySelector('[data-no]').onclick = hide;
    requestAnimationFrame(() => ban.classList.add('on'));
    clearTimeout(banT); banT = setTimeout(hide, 20_000);
    try { navigator.vibrate && navigator.vibrate(120); } catch (e) {}
  }
  function hide(){ ban.classList.remove('on'); clearTimeout(banT); setTimeout(nextInvite, 400); }
  // a page inside the main page's frame leaves invitations to the main page, so they show once
  const framed = (() => { try { return window.top !== window && window.top.location.host === location.host; } catch (e) { return false; } })();
  addEventListener('vw-invites', e => {
    if (framed) { try { window.top.dispatchEvent(new CustomEvent('vw-invites', { detail: e.detail })); } catch (x) {} return; }
    const list = (e.detail || []).filter(v => GAMES[v.game] && /^[A-Z]{4}$/.test(v.code));
    if (!list.length) return;
    const idle = !queue.length && !ban.classList.contains('on');
    queue.push(...list); if (idle) nextInvite();
  });

  window.VWA = A;
})();
