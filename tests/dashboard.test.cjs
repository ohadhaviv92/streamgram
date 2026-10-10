const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8')
    .replace(/import\s+[\s\S]*?from\s+"[^\"]+";\n/g, '')
    .replace(/export /g, '');
}
function locale(search = '', saved = null) {
  const context = vm.createContext({
    URLSearchParams, location: { search },
    localStorage: { getItem: () => saved },
    document: { documentElement: {}, querySelector: () => ({}) },
  });
  vm.runInContext(source('translations.js') + source('i18n.js') + '\napplyLanguage();', context);
  return { context, language: vm.runInContext('language', context) };
}
test('search example appears after selection and follows each language and server inheritance', () => {
  const select = { value: 'he' };
  const example = { hidden: true, innerHTML: '' };
  const context = vm.createContext({
    t: text => text, esc: text => text,
    $: selector => selector.endsWith('-example') ? example : select,
  });
  vm.runInContext(source('search-language.js'), context);
  vm.runInContext('bindSearchLanguageExample("personal-language", "ru")', context);
  assert.equal(example.hidden, true);
  for (const [language, expected] of [
    ['he', 'ליל המתים החיים'], ['ru', 'Ночь живых мертвецов'],
    ['ar', 'ليلة الموتى الأحياء'], ['en', 'Night of the Living Dead'],
    ['', 'Ночь живых мертвецов'],
  ]) {
    select.value = language;
    select.onchange();
    assert.equal(example.hidden, false);
    assert.ok(example.innerHTML.includes(expected));
    assert.match(example.innerHTML, /Night of the Living Dead/);
    assert.doesNotMatch(example.innerHTML, /public domain|ליל המתים החיים.*Ночь/);
    if (language === 'en') assert.doesNotMatch(example.innerHTML, / \/ /);
  }
});
test('all four URL languages override the saved preference and set text direction', () => {
  for (const language of ['en', 'he', 'ru', 'ar']) {
    const result = locale(`?token=private&lng=${language}`, 'he');
    assert.equal(result.language, language);
    assert.equal(result.context.document.documentElement.dir,
      ['he', 'ar'].includes(language) ? 'rtl' : 'ltr');
  }
});
test('invalid languages fall back to a valid saved preference or English', () => {
  assert.equal(locale('?lng=unknown', 'ru').language, 'ru');
  assert.equal(locale('?lng=constructor', 'unknown').language, 'en');
  assert.equal(locale().language, 'en');
});
test('Russian and Arabic cover every Hebrew dashboard translation', () => {
  const { context } = locale();
  for (const lang of ['ru', 'ar']) {
    const missing = Array.from(vm.runInContext(`Object.keys(he).filter(key => !${lang}[key])`, context));
    assert.deepEqual(missing, []);
  }
});

function authHarness(respond) {
  const elements = new Map();
  const timers = new Map();
  const calls = [];
  const errors = [];
  let sequence = 0;
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: false, textContent: '', className: '', innerHTML: '', value: '',
      setAttribute() {}, focus() {}, replaceChildren(...children) { this.children = children; },
    });
    return elements.get(selector);
  };
  const closeListeners = [];
  const dialog = { open: true, addEventListener: (_, fn) => closeListeners.push(fn),
    close() { this.open = false; closeListeners.forEach(fn => fn()); } };
  const context = vm.createContext({
    t: text => text, $: element, dialog: () => dialog, button: () => '',
    document: { createElement: () => ({}) },
    setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    api: async (url, options) => { calls.push({ url, options }); return respond(url, options); },
    errorMessage: error => errors.push(error),
    run: async (_, work) => { try { await work(); } catch (error) { errors.push(error); } },
    connected: [],
  });
  vm.runInContext(source('auth.js') + '\nconnect({token: "private"}, token => connected.push(token));', context);
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const fire = async (ms) => {
    const entry = [...timers.entries()].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `Missing ${ms}ms timer`);
    timers.delete(entry[0]);
    await entry[1].fn();
    await settle();
  };
  return { element, calls, errors, timers, dialog, context, settle, fire };
}
const qr = { qrToken: 'attempt', qrCodeImage: 'data:image/png;base64,test', expiresIn: 60 };
test('QR generates automatically, expiry is red, and regeneration creates a new attempt', async () => {
  const h = authHarness(() => qr);
  await h.settle();
  assert.equal(h.calls[0].url, '/auth/qr/generate');
  assert.equal(h.calls[0].options.token, 'private');
  assert.equal(h.element('#generate').hidden, true);
  assert.equal(h.element('#qr-output').children.length, 1);
  await h.fire(60000);
  assert.equal(h.element('#generate').hidden, false);
  assert.equal(h.element('#generate').textContent, 'Regenerate QR code');
  assert.equal(h.element('#qr-status').className, 'qr-expired');
  assert.equal(h.element('#qr-output').children.length, 0);
  assert.equal(h.timers.size, 0);
  await h.element('#generate').onclick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.element('#generate').hidden, true);
  assert.equal(h.element('#qr-status').className, '');
});
test('server expiry exposes regeneration', async () => {
  const h = authHarness(url => {
    if (url.endsWith('generate')) return qr;
    throw new Error('Authentication expired. Start again.');
  });
  await h.settle();
  await h.fire(2000);
  assert.equal(h.element('#generate').hidden, false);
  assert.equal(h.element('#qr-status').className, 'qr-expired');
});
test('scanned QR switches to password without expiring the QR during password entry', async () => {
  const h = authHarness(url => url.endsWith('generate') ? qr : { passwordRequired: true });
  await h.settle();
  await h.fire(2000);
  assert.equal(h.element('#qr-password').hidden, false);
  assert.equal(h.element('#generate').hidden, true);
  assert.equal(h.timers.size, 0);
});
test('generation failure offers retry and method changes ignore late QR responses', async () => {
  const failed = authHarness(() => { throw new Error('Network failed'); });
  await failed.settle();
  assert.equal(failed.element('#generate').textContent, 'Retry');
  assert.equal(failed.element('#generate').hidden, false);
  let resolve;
  const h = authHarness(() => new Promise(done => { resolve = done; }));
  h.element('#phone-mode').onclick();
  resolve(qr);
  await h.settle();
  assert.equal(h.element('#qr-output').children.length, 0);
  assert.equal(h.timers.size, 0);
});
test('closing QR dialog clears polling and expiry timers', async () => {
  const h = authHarness(() => qr);
  await h.settle();
  h.dialog.close();
  assert.equal(h.timers.size, 0);
});
test('language selector preserves the account URL and updates an existing language parameter', () => {
  const elements = { '#app': {}, '#ui-language': {} };
  const saved = {};
  const location = {
    href: 'https://example.test/?action=settings&token=private&lng=he#settings',
    assign(url) { this.assigned = url; },
  };
  const context = vm.createContext({
    t: text => text, language: 'he', URL,
    supportedLanguages: { en: 'English', he: 'עברית', ru: 'Русский', ar: 'العربية' },
    document: { querySelector: selector => elements[selector] }, location,
    localStorage: { setItem: (key, value) => { saved[key] = value; } },
  });
  vm.runInContext(source('shared.js') + '\nshell();', context);
  elements['#ui-language'].onchange({ target: { value: 'ar' } });
  assert.equal(location.assigned, 'https://example.test/?action=settings&token=private&lng=ar#settings');
  assert.equal(saved['streamgram-ui-language'], 'ar');
  assert.equal((elements['#app'].innerHTML.match(/<option /g) || []).length, 4);
});
test('first-run search dropdown matches each dashboard language after initialization', async () => {
  for (const language of ['en', 'he', 'ru', 'ar']) {
    const elements = new Map();
    let selected;
    const context = vm.createContext({
      language, t: text => text,
      $: selector => {
        if (!elements.has(selector)) elements.set(selector, {});
        return elements.get(selector);
      },
      api: async url => url === '/setup/admin-status' ? { preferredLanguage: 'en' } : {},
      bindSearchLanguageExample() {}, shell() {}, pageHead: () => '', protectionFields: () => '', bindProtection() {},
      credentialFields: config => { selected = config.preferredLanguage; return ''; },
      button: () => '', run: async (_, work) => work(),
    });
    vm.runInContext(source('setup.js') + '\nglobalThis.ready = setup();', context);
    await context.ready;
    elements.get('#security').onsubmit({ preventDefault() {} });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    assert.equal(selected, language);
  }
});

test('completed setup opens the admin dashboard without relying on hash routing', async () => {
  const elements = new Map();
  let onConnected;
  let dashboardOpened = 0;
  let dashboardUrl;
  const context = vm.createContext({
    language: 'en', t: text => text,
    $: selector => {
      if (!elements.has(selector)) elements.set(selector, { insertAdjacentHTML() {} });
      return elements.get(selector);
    },
    api: async url => url === '/settings' ? { manifestUrl: 'https://example.test/private/manifest.json' } : {},
    shell() {}, pageHead: () => '', protectionFields: () => '', bindProtection() {},
    credentialFields: () => '', credentialValues: () => ({}), bindSearchLanguageExample() {},
    button: (label, id) => `<button id="${id}">${label}</button>`,
    run: async (_, work) => work(), checksCard: () => '', bindChecks() {},
    connect: (_, callback) => { onConnected = callback; },
    installCard: () => '<section>Install in Stremio</section>',
    history: { replaceState: (_, __, url) => { dashboardUrl = url; } },
    admin: async () => { dashboardOpened++; },
  });
  vm.runInContext(source('setup.js'), context);
  await vm.runInContext('setup()', context);
  elements.get('#security').onsubmit({ preventDefault() {} });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  elements.get('#instance').onsubmit({ preventDefault() {} });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  elements.get('#connect').onclick();
  await onConnected('private-token');
  const completion = elements.get('#main').innerHTML;
  assert.match(completion, /Install in Stremio/);
  assert.match(completion, /Go to dashboard/);
  assert.doesNotMatch(completion, /Add family member|Open personal page/);
  await elements.get('#go-dashboard').onclick();
  assert.equal(dashboardUrl, '/#overview');
  assert.equal(dashboardOpened, 1);
});

function navigationHarness() {
  let context;
  function element() {
    const attributes = new Map();
    const classes = new Set();
    const listeners = new Map();
    return {
      inert: false, hidden: false, style: { top: '' }, attributes, listeners,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
      addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
      focus() { context.document.activeElement = this; },
    };
  }
  const elements = Object.fromEntries(['#management-sidebar', '#menu-toggle', '#menu-close', '#drawer-backdrop', '.mobile-bar', '#admin-content', '.skip', '#toast', '#app', '#ui-language', '#signout'].map(key => [key, element()]));
  const first = element(), last = element(), activeLink = element();
  const sidebar = elements['#management-sidebar'];
  sidebar.querySelectorAll = () => [first, elements['#menu-close'], activeLink, last];
  sidebar.contains = target => sidebar.querySelectorAll().includes(target);
  const mediaListeners = new Set();
  const mobile = { matches: true, addEventListener: (_, fn) => mediaListeners.add(fn), removeEventListener: (_, fn) => mediaListeners.delete(fn) };
  const keyboard = new Set();
  const scrolls = [];
  context = vm.createContext({
    t: text => text, language: 'en', supportedLanguages: { en: 'English' },
    document: {
      body: element(), activeElement: null,
      querySelector: selector => elements[selector],
      addEventListener: (_, fn) => keyboard.add(fn), removeEventListener: (_, fn) => keyboard.delete(fn),
    },
    window: { matchMedia: () => mobile, scrollY: 240, scrollTo: (...args) => scrolls.push(args) },
  });
  sidebar.querySelector = () => activeLink;
  vm.runInContext(source('shared.js') + '\ndisposeNavigation = bindMobileNavigation();', context);
  const key = (value, shiftKey = false) => {
    let prevented = false;
    keyboard.forEach(fn => fn({ key: value, shiftKey, preventDefault() { prevented = true; } }));
    return prevented;
  };
  const resize = matches => { mobile.matches = matches; mediaListeners.forEach(fn => fn()); };
  return { context, elements, first, last, activeLink, mobile, mediaListeners, keyboard, scrolls, key, resize };
}
test('mobile drawer opens as a modal, locks scrolling, and restores existing background state', () => {
  const h = navigationHarness();
  h.elements['#toast'].inert = true;
  h.context.document.body.style.top = '3px';
  h.elements['#menu-toggle'].onclick();
  assert.equal(h.elements['#management-sidebar'].attributes.get('role'), 'dialog');
  assert.equal(h.elements['#management-sidebar'].attributes.get('aria-modal'), 'true');
  assert.equal(h.elements['#menu-toggle'].attributes.get('aria-expanded'), 'true');
  assert.equal(h.elements['#drawer-backdrop'].hidden, false);
  assert.equal(h.elements['#admin-content'].inert, true);
  assert.equal(h.context.document.body.style.top, '-240px');
  assert.equal(h.context.document.body.classList.contains('navigation-open'), true);
  assert.equal(h.context.document.activeElement, h.elements['#menu-close']);
  h.elements['#menu-close'].onclick();
  assert.equal(h.elements['#management-sidebar'].attributes.has('aria-modal'), false);
  assert.equal(h.elements['#menu-toggle'].attributes.get('aria-expanded'), 'false');
  assert.equal(h.elements['#drawer-backdrop'].hidden, true);
  assert.equal(h.elements['#admin-content'].inert, false);
  assert.equal(h.elements['#toast'].inert, true);
  assert.equal(h.context.document.body.style.top, '3px');
  assert.equal(h.context.document.body.classList.contains('navigation-open'), false);
  assert.deepEqual(h.scrolls, [[0, 240]]);
  assert.equal(h.context.document.activeElement, h.elements['#menu-toggle']);
});
test('drawer traps keyboard focus and supports Escape, backdrop, and current-page navigation', () => {
  const h = navigationHarness();
  for (const dismiss of [() => h.key('Escape'), () => h.elements['#drawer-backdrop'].onclick(), () => h.elements['#management-sidebar'].listeners.get('click')({ target: { closest: () => h.activeLink } })]) {
    h.elements['#menu-toggle'].onclick();
    h.last.focus();
    assert.equal(h.key('Tab'), true);
    assert.equal(h.context.document.activeElement, h.first);
    assert.equal(h.key('Tab', true), true);
    assert.equal(h.context.document.activeElement, h.last);
    dismiss();
    assert.equal(h.elements['#drawer-backdrop'].hidden, true);
    assert.equal(h.context.document.activeElement, h.elements['#menu-toggle']);
  }
});
test('breakpoint changes close the drawer and move focus to visible controls', () => {
  const h = navigationHarness();
  h.elements['#menu-toggle'].onclick();
  h.resize(false);
  assert.equal(h.context.document.body.classList.contains('navigation-open'), false);
  assert.equal(h.context.document.activeElement, h.activeLink);
  h.elements['#menu-toggle'].onclick();
  assert.equal(h.elements['#drawer-backdrop'].hidden, true);
  h.context.document.activeElement = h.context.document.body;
  h.resize(true);
  assert.equal(h.context.document.activeElement, h.elements['#menu-toggle']);
});
test('shell rerenders remove drawer listeners and release modal state', () => {
  const h = navigationHarness();
  h.elements['#menu-toggle'].onclick();
  vm.runInContext('shell("admin", "Overview");', h.context);
  assert.equal(h.keyboard.size, 1);
  assert.equal(h.mediaListeners.size, 1);
  assert.equal(h.context.document.body.classList.contains('navigation-open'), false);
  h.elements['#menu-toggle'].onclick();
  vm.runInContext('shell();', h.context);
  assert.equal(h.keyboard.size, 0);
  assert.equal(h.mediaListeners.size, 0);
  assert.equal(h.elements['#management-sidebar'].listeners.size, 0);
  assert.equal(h.context.document.body.classList.contains('navigation-open'), false);
  assert.equal(h.elements['#admin-content'].inert, false);
});

test('invitation list displays escaped names and deletes used records', async () => {
  const main = { innerHTML: '' }, create = {};
  const remove = { dataset: { deleteInvite: 'used-id' } };
  const calls = [];
  let list = [{ id: 'used-id', name: '<Alice>', status: 'used', createdAt: 1, expiresAt: 2 }];
  const context = vm.createContext({
    t: value => value, language: 'en',
    esc: value => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    $: selector => selector === '#main' ? main : create,
    pageHead: () => '', button: () => '', badge: () => '', icon: () => '',
    document: { querySelectorAll: selector => selector === '[data-delete-invite]' && list.length ? [remove] : [] },
    api: async (url, options) => {
      calls.push({ url, options });
      if (options?.method === 'DELETE') { list = []; return { success: true }; }
      return list;
    },
    run: async (_, work) => work(),
  });
  vm.runInContext(source('admin.js'), context);
  await vm.runInContext('invitations()', context);
  assert.match(main.innerHTML, /&lt;Alice&gt;/);
  assert.match(main.innerHTML, /data-delete-invite="used-id"/);
  assert.doesNotMatch(main.innerHTML, /data-revoke=/);
  await remove.onclick();
  assert.equal(calls[1].url, '/admin/invitations/used-id/record');
  assert.equal(calls[1].options.method, 'DELETE');
  assert.match(main.innerHTML, /No invitations yet/);
});

test('invitation greeting escapes the recipient name and supports unnamed invitations', async () => {
  for (const name of ['<Alice>', '']) {
    const main = { innerHTML: '' }, connectButton = {};
    const context = vm.createContext({
      shell() {}, t: text => text,
      esc: value => value.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      api: async () => ({ name }), button: () => '',
      $: selector => selector === '#main' ? main : connectButton,
    });
    vm.runInContext(source('setup.js'), context);
    await vm.runInContext('invitation("secret")', context);
    assert.match(main.innerHTML, name ? /Hi &lt;Alice&gt;, you’re invited to StreamGram/ : /You’re invited/);
    assert.doesNotMatch(main.innerHTML, /<Alice>/);
  }
});

test('personal page hides account names and saves language without changing the name', async () => {
  const elements = new Map(), calls = [];
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', value: 'he' });
    return elements.get(selector);
  };
  const context = vm.createContext({
    bindSearchLanguageExample() {}, shell() {}, t: text => text, $: element, esc: value => String(value ?? ""),
    badge: () => '', installCard: () => '', button: () => '', languageOptions: () => '',
    api: async (url, options) => { calls.push({ url, options }); return { name: 'Admin label' }; },
    run: async (_, work) => work(), toast() {},
  });
  vm.runInContext(source('personal.js'), context);
  await vm.runInContext('personal("private")', context);
  assert.doesNotMatch(element('#main').innerHTML, /Admin label|id="name"|Display name/);
  await element('#preferences').onsubmit({ preventDefault() {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, '/settings');
  assert.equal(calls[1].options.body.language, 'he');
});

test('signed-in admins edit the account name in the original preferences form', async () => {
  const elements = new Map(), calls = [];
  let saving;
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', value: selector === '#name' ? 'New label' : 'he' });
    return elements.get(selector);
  };
  const context = vm.createContext({
    bindSearchLanguageExample() {}, shell() {}, t: text => text, $: element, esc: value => String(value ?? ''),
    badge: () => '', installCard: () => '', button: () => '', languageOptions: () => '',
    api: async (url, options) => { calls.push({ url, options }); return { canEditName: true, name: 'Admin label' }; },
    run: (_, work) => { saving = work(); return saving; }, toast() {},
  });
  vm.runInContext(source('personal.js'), context);
  await vm.runInContext('personal("private")', context);
  assert.match(element('#main').innerHTML, /<h1>Admin label<\/h1>/);
  assert.match(element('#main').innerHTML, /id="name".*value="Admin label"/);
  element('#preferences').onsubmit({ preventDefault() {} });
  await saving;
  assert.equal(calls[1].url, '/name');
  assert.equal(calls[1].options.body.name, 'New label');
  assert.equal(calls[2].url, '/settings');
  assert.equal(element('h1').textContent, 'New label');
});
