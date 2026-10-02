/* Shared UI palette preference. Load in <head> so saved themes apply before paint. */
(() => {
  const storageKey = 'sandbox-miami-theme';
  const themes = Object.freeze({
    forest: Object.freeze({ label: 'Forest', color: '#101714' }),
    tidal: Object.freeze({ label: 'Tidal', color: '#101924' }),
    violet: Object.freeze({ label: 'Violet', color: '#191520' }),
    ember: Object.freeze({ label: 'Ember', color: '#201711' }),
  });
  const isTheme = value => Object.hasOwn(themes, value);
  let stored;
  try { stored = localStorage.getItem(storageKey); } catch { /* Private storage may be unavailable. */ }
  let current = isTheme(stored) ? stored : 'forest';

  function apply(value, { persist = true, notify = true } = {}) {
    if (!isTheme(value)) return false;
    const changed = current !== value;
    current = value;
    document.documentElement.dataset.siteTheme = value;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = themes[value].color;
    document.querySelectorAll('select[data-site-theme-picker]').forEach(select => {
      select.value = value;
    });
    if (persist) {
      try { localStorage.setItem(storageKey, value); } catch { /* Theme still applies in this tab. */ }
    }
    if (changed && notify) document.dispatchEvent(new CustomEvent('site-theme-change', { detail: { theme: value } }));
    return true;
  }

  function connect(select) {
    if (select.dataset.siteThemeReady === 'true') return;
    select.dataset.siteThemeReady = 'true';
    select.classList.add('site-theme-picker');
    if (!select.options.length) {
      for (const [value, { label }] of Object.entries(themes)) {
        select.add(new Option(label, value));
      }
    }
    select.value = current;
    select.addEventListener('change', () => apply(select.value));
  }

  window.SandboxTheme = Object.freeze({
    themes,
    get: () => current,
    set: value => apply(value),
  });

  apply(current, { persist: false, notify: false });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('select[data-site-theme-picker]').forEach(connect);
    }, { once: true });
  } else {
    document.querySelectorAll('select[data-site-theme-picker]').forEach(connect);
  }
  window.addEventListener('storage', event => {
    if (event.key === storageKey) apply(isTheme(event.newValue) ? event.newValue : 'forest', { persist: false });
  });
})();
