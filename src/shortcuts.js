// Keyboard shortcuts are opt-in: callers pass the visible toggle state as
// `enabled`. Anything that could steal a key press from typing, navigation,
// or a dialog returns null instead of an action.

const GUARDED_TAGS = new Set([
  'input', 'textarea', 'select', 'option', 'optgroup', 'datalist',
  'button', 'a', 'area', 'summary', 'dialog', 'object', 'embed', 'iframe',
]);

const GUARDED_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'treeitem',
  'textbox', 'searchbox', 'combobox', 'listbox', 'option', 'spinbutton',
  'slider', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'dialog', 'alertdialog',
]);

const ACTIONS = { i: 'import', p: 'print' };

function editableAttribute(element) {
  if (typeof element.getAttribute !== 'function') return false;
  const value = element.getAttribute('contenteditable');
  if (value === null) return false;
  const lowered = value.toLowerCase();
  return lowered !== 'false' && lowered !== 'inherit';
}

function guardedElement(node) {
  let element = node;
  for (let depth = 0; element && depth < 1000; depth += 1) {
    if (element.nodeType !== 1) {
      // Document, document fragment, or text node: climb to the host or parent.
      element = element.host ?? element.parentNode;
      continue;
    }
    if (element.isContentEditable === true) return true;
    if (editableAttribute(element)) return true;
    const tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
    if (GUARDED_TAGS.has(tag)) return true;
    const role = typeof element.getAttribute === 'function' ? element.getAttribute('role') : null;
    if (role && GUARDED_ROLES.has(role.toLowerCase())) return true;
    const parent = element.parentNode;
    if (!parent || parent === element) return false;
    if (parent.nodeType === 11 && parent.host) {
      element = parent.host;
    } else {
      element = parent;
    }
  }
  return false;
}

function fallbackTarget(event) {
  const target = event?.target;
  if (target && target.nodeType === 1) return null;
  const doc = target?.ownerDocument ?? event?.view?.document ?? globalThis.document;
  return doc?.activeElement ?? null;
}

export function shortcutAction(event, enabled = false) {
  if (!enabled || !event || typeof event.key !== 'string') return null;
  if (event.isComposing || event.repeat || event.keyCode === 229) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const action = ACTIONS[event.key.toLowerCase()];
  if (!action) return null;
  if (event.target && guardedElement(event.target)) return null;
  const fallback = fallbackTarget(event);
  if (fallback && fallback !== event.target && guardedElement(fallback)) return null;
  return action;
}
