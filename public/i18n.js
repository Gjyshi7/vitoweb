// The site's language: Shqip (default) or English. Chosen in Cilësimet / Settings, kept on the phone.
//   VWL.lang            'sq' | 'en'
//   VWL.t(sq, en)       the text in the chosen language (Albanian when there is no English yet)
//   VWL.set('en')       change it (the page updates the parts marked below, and tells VWL.on listeners)
//   VWL.on(fn)          fn(lang) after every change
// In HTML, Albanian stays the content and English rides along:
//   data-en="..."        text          data-en-html="..."   markup
//   data-en-ph="..."     placeholder   data-en-aria="..."   aria-label      data-en-title="..."  title
(() => {
  'use strict';
  const KEY = 'vw.lang';
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v === 'en' ? 'en' : 'sq'; } catch (e) { return 'sq'; } };
  let lang = read();
  const fns = [];
  const ATTR = [['data-en-ph', 'placeholder'], ['data-en-aria', 'aria-label'], ['data-en-title', 'title']];
  function apply(root) {
    const r = root || document;
    r.querySelectorAll('[data-en]').forEach(el => {
      if (el.dataset.sq == null) el.dataset.sq = el.textContent;
      el.textContent = lang === 'en' ? el.dataset.en : el.dataset.sq;
    });
    r.querySelectorAll('[data-en-html]').forEach(el => {
      if (el.dataset.sqHtml == null) el.dataset.sqHtml = el.innerHTML;
      el.innerHTML = lang === 'en' ? el.dataset.enHtml : el.dataset.sqHtml;
    });
    for (const [a, prop] of ATTR) r.querySelectorAll('[' + a + ']').forEach(el => {
      const keep = 'sq' + a.slice(8).replace(/^./, c => c.toUpperCase());   // data-en-ph -> data-sq-ph (dataset.sqPh)
      if (el.dataset[keep] == null) el.dataset[keep] = el.getAttribute(prop) || '';
      el.setAttribute(prop, lang === 'en' ? el.getAttribute(a) : el.dataset[keep]);
    });
  }
  const VWL = {
    get lang() { return lang; },
    get en() { return lang === 'en'; },
    // the person picked a language themselves (not just the default)
    get chosen() { try { return localStorage.getItem(KEY) != null; } catch (e) { return false; } },
    t: (sq, en) => (lang === 'en' && en != null ? en : sq),
    set(l) {
      if (l !== 'sq' && l !== 'en') return;
      lang = l;
      try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {}
      document.documentElement.lang = l;
      apply(document);
      fns.forEach(f => { try { f(l); } catch (e) {} });
    },
    on(fn) { fns.push(fn); },
    apply,
  };
  window.VWL = VWL;
  document.documentElement.lang = lang;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply(document));
  else apply(document);
  // another tab (or the game inside the main page) changed it
  addEventListener('storage', e => { if (e.key === KEY) { const l = read(); if (l !== lang) VWL.set(l); } });
})();
