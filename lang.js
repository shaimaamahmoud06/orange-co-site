/* One language on screen at a time. Every translatable line carries both versions in the markup:
 *   data-en / data-ar               its text
 *   data-aria-en / data-aria-ar     its aria-label (screen readers)
 *   data-alt-en / data-alt-ar       its alt text
 * The toggle swaps them, sets <html lang dir>, remembers the choice, and fires 'langchange' on document so
 * the parts that build text in JS (manifesto words, globe labels, Worlds, Vitrine) can follow.
 * Choice order: ?lang=ar|en, then the visitor's last choice, then the browser language. Loaded before the others. */
(() => {
  const KEY = 'oc-lang', html = document.documentElement;
  const ok = (l) => (l === 'en' || l === 'ar' ? l : null);
  let saved = null;
  try { saved = ok(localStorage.getItem(KEY)); } catch (e) { /* private mode: no memory, still works */ }
  let lang = ok(new URLSearchParams(location.search).get('lang')) || saved
    || ((navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en');

  function apply(scope = document) {
    const k = lang === 'ar' ? 'ar' : 'en', K = k[0].toUpperCase() + k[1];
    scope.querySelectorAll('[data-en]').forEach((n) => {
      const t = n.dataset[k]; if (t != null && n.textContent !== t) n.textContent = t;
    });
    scope.querySelectorAll('[data-aria-en]').forEach((n) => n.setAttribute('aria-label', n.dataset['aria' + K]));
    scope.querySelectorAll('[data-alt-en]').forEach((n) => n.setAttribute('alt', n.dataset['alt' + K]));
  }
  function set(l, announce = true) {
    lang = l;
    html.lang = l; html.dir = l === 'ar' ? 'rtl' : 'ltr';
    try { localStorage.setItem(KEY, l); } catch (e) { /* ignore */ }
    apply();
    document.querySelectorAll('[data-lang-toggle]').forEach((b) => {
      b.lang = l === 'ar' ? 'en' : 'ar';               // the button names the other language, in that language
    });
    if (announce) {
      document.dispatchEvent(new CustomEvent('langchange', { detail: l }));
      dispatchEvent(new Event('resize'));               // text lengths changed: pinned scenes re-measure
    }
  }
  window.OC = { get lang() { return lang; }, apply, set };
  set(lang, false);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-lang-toggle]')) set(lang === 'ar' ? 'en' : 'ar');
  });
})();
