/* ===== Ads, for the whole site =====
   Turning ads on takes three values from AdSense, nothing else:
     CLIENT   your publisher id, "ca-pub-" + 16 digits (AdSense -> Account -> Settings -> Account information).
              The same id also goes in /ads.txt and in the <meta name="google-adsense-account"> of index.html.
     SLOTS    ad-unit ids (AdSense -> Ads -> By ad unit -> Display ads). One unit can serve every slot:
              put it in "default" and leave the others empty.
     ENABLED  true once AdSense has approved vitoweb.al. Before that the slots would only stay blank.

   Where ads go (and where they never go):
     hub-top      hub, under the two big game cards             display, responsive
     hub-bottom   hub, under the list of games                  display, responsive
     lobby        online table, while people wait to start      display, small
     rules        bottom of every rules panel                   display, small
     between      between two hands / two matches               full-screen (H5 Games Ads, adBreak 'next';
                                                                only shows once Google accepts the site into H5 Games Ads)
     never        on the table while you play, near LUAJ/PAS, on a Mafia/Imposter role card.
                  Accidental clicks there break AdSense policy and would get the account closed.

   Testing:
     ?ads=preview  every slot as a labelled box, and a fake full-screen break on "Dora tjetër". No Google at all.
     ?ads=test     the real Google code in test mode (needs CLIENT): test ads, no money, safe to click.
     ?ads=off      back to normal. The choice stays for that tab.
   EEA/UK/Swiss visitors get Google's consent message (AdSense -> Privacy & messaging); the "Cookie settings"
   link in the hub footer reopens it, and only shows for visitors that message applies to. */
const ADS = (() => {
  const CLIENT = '';
  const ENABLED = false;
  const SLOTS = { default: '', 'hub-top': '', 'hub-bottom': '', lobby: '', rules: '' };
  const SIZE = { 'hub-top': [320, 100], 'hub-bottom': [320, 250], lobby: [320, 100], rules: [320, 100] };
  const slotId = k => SLOTS[k] || SLOTS.default;

  let mode = '';
  try {
    const q = new URLSearchParams(location.search).get('ads');
    if (q === 'preview' || q === 'test') sessionStorage.setItem('vw-ads', q);
    if (q === 'off') sessionStorage.removeItem('vw-ads');
    mode = sessionStorage.getItem('vw-ads') || '';
    if (mode === '1') mode = 'preview';
  } catch (e) {}
  const preview = mode === 'preview';
  const test = mode === 'test' && /^ca-pub-\d{16}$/.test(CLIENT);
  const live = /^ca-pub-\d{16}$/.test(CLIENT) && !preview && (ENABLED || test);
  const on = live || preview;
  let lib = 'none';                                  // none | loading | ok | failed (blocked by an ad blocker, offline)

  const css = document.createElement('style');
  css.textContent = `
.adslot{display:none}
.adslot.on{display:block;margin:18px auto;max-width:728px;text-align:center}
.adslot.prev{display:grid;place-items:center;border:2px dashed rgba(243,199,106,.6);border-radius:12px;color:#f3c76a;
  font:600 13px system-ui,sans-serif;letter-spacing:.08em;background:rgba(243,199,106,.06)}
.adslot.on:has(ins[data-ad-status="unfilled"]){display:none}
.adslot .lbl{display:block;font:500 11px system-ui,sans-serif;color:rgba(255,255,255,.4);letter-spacing:.1em;margin-bottom:4px}
#adBreak{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(5,8,15,.92);color:#f3c76a;
  font:700 20px system-ui,sans-serif;letter-spacing:.06em;text-align:center}
#adBreak small{display:block;margin-top:8px;color:rgba(255,255,255,.55);font-weight:500;font-size:14px}`;
  document.head.appendChild(css);

  if (live) {
    const s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
    s.dataset.adFrequencyHint = '120s';             // at most one full-screen break every 2 minutes
    if (test) s.dataset.adbreakTest = 'on';
    lib = 'loading';
    s.onload = () => { lib = 'ok'; };
    s.onerror = () => { lib = 'failed'; };
    document.head.appendChild(s);
    consentLink();
  }
  window.adsbygoogle = window.adsbygoogle || [];
  const adBreak = o => window.adsbygoogle.push(o);
  if (live) adBreak({ preloadAdBreaks: 'on', sound: 'on' });   // adConfig

  // fill every <div class="adslot" data-ad="..."> on the page (and ones added later with ADS.fill)
  function fill(root = document){
    root.querySelectorAll('.adslot[data-ad]:not(.on)').forEach(el => {
      const k = el.dataset.ad;
      if (!on || !(k in SLOTS)) return;
      if (preview) {
        const [w, h] = SIZE[k] || [320, 100];
        el.classList.add('on', 'prev'); el.style.width = Math.min(w, 728) + 'px'; el.style.maxWidth = '100%'; el.style.height = h + 'px';
        el.textContent = `REKLAMË · ${k} · ${w}×${h}`;
        return;
      }
      if (!slotId(k) || lib === 'failed') return;
      el.classList.add('on');
      el.innerHTML = `<span class="lbl">REKLAMË</span><ins class="adsbygoogle" style="display:block" data-ad-client="${CLIENT}" data-ad-slot="${slotId(k)}" data-ad-format="auto" data-full-width-responsive="true"${test ? ' data-adtest="on"' : ''}></ins>`;
      try { window.adsbygoogle.push({}); } catch (e) {}
    });
  }

  // full-screen break between hands. done() always runs, ad or no ad.
  function between(name, done){
    if (!on) return done();
    if (preview) {
      const d = document.createElement('div'); d.id = 'adBreak';
      d.innerHTML = `<div>REKLAMË MES DUARSH<small>${name} · shfaqet nga Google jo më shpesh se një herë në 2 minuta</small></div>`;
      document.body.appendChild(d);
      setTimeout(() => { d.remove(); done(); }, 1600);
      return;
    }
    if (lib !== 'ok') return done();                  // Google's code never arrived: no break, no waiting
    let called = false, showing = false;
    const fin = () => { if (!called) { called = true; done(); } };
    try { adBreak({ type: 'next', name, beforeAd: () => { showing = true; }, adBreakDone: fin }); } catch (e) { fin(); }
    setTimeout(() => { if (!showing) fin(); }, 2500);   // no ad came: never leave a player waiting
  }

  // "Cookie settings" in the hub footer: reopens Google's consent message. Shown only to visitors that
  // message applies to (EEA, UK, Switzerland), once Google's consent tool says so.
  function consentLink(){
    const a = document.getElementById('footCmp');
    if (!a) return;
    a.addEventListener('click', e => {
      e.preventDefault();
      window.googlefc = window.googlefc || {}; window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
      window.googlefc.callbackQueue.push({ CONSENT_DATA_READY: () => { try { window.googlefc.showRevocationMessage(); } catch (err) {} } });
    });
    let tries = 0;
    const look = () => {
      if (typeof window.__tcfapi === 'function') {
        try { window.__tcfapi('addEventListener', 2, (d, ok) => { if (ok && d && d.gdprApplies) a.hidden = false; }); } catch (e) {}
        return;
      }
      if (++tries < 20) setTimeout(look, 1000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', look); else look();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fill());
  else fill();
  return { on, preview, fill, between };
})();
