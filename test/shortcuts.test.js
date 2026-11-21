import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutAction } from '../src/shortcuts.js';

function el(tag, { attrs = {}, parent = null, isContentEditable = false } = {}) {
  const element = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    isContentEditable,
    getAttribute: name => (name in attrs ? attrs[name] : null),
  };
  element.parentNode = parent;
  return element;
}

const body = () => el('body');
const key = (key, extra = {}) => ({ key, target: body(), ...extra });

test('shortcuts stay off unless explicitly enabled', () => {
  assert.equal(shortcutAction(key('i'), false), null);
  assert.equal(shortcutAction(key('p'), false), null);
  assert.equal(shortcutAction(key('i')), null);
});

test('i maps to import and p maps to print', () => {
  assert.equal(shortcutAction(key('i'), true), 'import');
  assert.equal(shortcutAction(key('p'), true), 'print');
});

test('unlisted keys do nothing', () => {
  assert.equal(shortcutAction(key('x'), true), null);
  assert.equal(shortcutAction(key('Enter'), true), null);
  assert.equal(shortcutAction(key('1'), true), null);
});

test('uppercase letters still count', () => {
  assert.equal(shortcutAction(key('I'), true), 'import');
  assert.equal(shortcutAction(key('P'), true), 'print');
});

test('ctrl, meta, and alt modifiers guard', () => {
  assert.equal(shortcutAction(key('i', { ctrlKey: true }), true), null);
  assert.equal(shortcutAction(key('p', { metaKey: true }), true), null);
  assert.equal(shortcutAction(key('i', { altKey: true }), true), null);
});

test('shift alone does not guard', () => {
  assert.equal(shortcutAction(key('i', { shiftKey: true }), true), 'import');
});

test('repeated keydown does not refire', () => {
  assert.equal(shortcutAction(key('i', { repeat: true }), true), null);
});

test('IME composition does not fire', () => {
  assert.equal(shortcutAction(key('i', { isComposing: true }), true), null);
  assert.equal(shortcutAction(key('i', { keyCode: 229 }), true), null);
});

test('typing inside inputs does not fire', () => {
  for (const tag of ['input', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'button', 'a', 'summary']) {
    assert.equal(shortcutAction({ key: 'i', target: el(tag) }, true), null, tag);
  }
});

test('events inside editable ancestors do not fire', () => {
  const nested = el('span', { parent: el('div', { parent: el('textarea') }) });
  assert.equal(shortcutAction({ key: 'i', target: nested }, true), null);
});

test('contenteditable elements do not fire', () => {
  assert.equal(shortcutAction({ key: 'i', target: el('div', { isContentEditable: true }) }, true), null);
  assert.equal(shortcutAction({ key: 'p', target: el('div', { attrs: { contenteditable: 'true' } }) }, true), null);
  assert.equal(shortcutAction({ key: 'i', target: el('div', { attrs: { contenteditable: '' } }) }, true), null);
});

test('contenteditable=false is not a guard', () => {
  const target = el('div', { attrs: { contenteditable: 'false' } });
  assert.equal(shortcutAction({ key: 'i', target }, true), 'import');
});

test('interactive roles guard even on generic elements', () => {
  for (const role of ['button', 'link', 'textbox', 'combobox', 'listbox', 'checkbox', 'switch']) {
    const target = el('div', { attrs: { role } });
    assert.equal(shortcutAction({ key: 'i', target }, true), null, role);
  }
});

test('dialog roles and elements guard', () => {
  const inDialog = el('span', { parent: el('dialog') });
  assert.equal(shortcutAction({ key: 'p', target: inDialog }, true), null);
  const inRoleDialog = el('span', { parent: el('div', { attrs: { role: 'dialog' } }) });
  assert.equal(shortcutAction({ key: 'p', target: inRoleDialog }, true), null);
  const inAlert = el('span', { parent: el('div', { attrs: { role: 'alertdialog' } }) });
  assert.equal(shortcutAction({ key: 'p', target: inAlert }, true), null);
});

test('a shadow-DOM host guard reaches across the boundary', () => {
  const host = el('input');
  const inner = el('span', { parent: { nodeType: 11, host } });
  assert.equal(shortcutAction({ key: 'i', target: inner }, true), null);
});

test('activeElement fallback guards when the target is not an element', () => {
  const previous = globalThis.document;
  globalThis.document = { activeElement: el('input') };
  try {
    assert.equal(shortcutAction({ key: 'i', target: { nodeType: 9 } }, true), null);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('activeElement fallback allows plain-document events', () => {
  const previous = globalThis.document;
  globalThis.document = { activeElement: el('body') };
  try {
    assert.equal(shortcutAction({ key: 'p', target: { nodeType: 9 } }, true), 'print');
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('missing or malformed events return null', () => {
  assert.equal(shortcutAction(null, true), null);
  assert.equal(shortcutAction({}, true), null);
  assert.equal(shortcutAction({ target: body() }, true), null);
});

test('deep ancestor chains resolve to a real guard', () => {
  const chain = el('i', { parent: el('u', { parent: el('span', { parent: el('a') }) }) });
  assert.equal(shortcutAction({ key: 'i', target: chain }, true), null);
  const plain = el('b', { parent: el('div', { parent: el('main') }) });
  assert.equal(shortcutAction({ key: 'p', target: plain }, true), 'print');
});
