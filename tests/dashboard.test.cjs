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
      shell() {}, pageHead: () => '', protectionFields: () => '', bindProtection() {},
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
    shell() {}, t: text => text, $: element, esc: value => String(value ?? ""),
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
    shell() {}, t: text => text, $: element, esc: value => String(value ?? ''),
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
