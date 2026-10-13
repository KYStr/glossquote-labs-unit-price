import { CATEGORIES, createCopyText, displayNameForLocale, formatPrice, formatTotalQuantity } from './core/unit-price.mjs';
import { ComparisonState } from './state.mjs';
import { TEXT } from './i18n.mjs';

const locale = document.documentElement.lang === 'en' ? 'en' : 'zh-Hant';
const t = TEXT[locale];
const state = new ComparisonState();
const byId = (id) => document.getElementById(id);
const controls = { category: byId('category'), rows: byId('rows'), copy: byId('copy'), status: byId('status'), result: byId('result'), fallback: byId('fallback') };

function node(tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
const basis = () => state.category === 'count' ? t.countBasis : `${t.per} ${CATEGORIES[state.category].basis}`;
const grouped = (text) => text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function quantityText(value) {
  const [integer, fraction] = formatTotalQuantity(value).split('.');
  return `${grouped(integer)}${fraction ? `.${fraction}` : ''} ${state.category === 'count' ? t.pieces : CATEGORIES[state.category].unit}`;
}

function errorFor(rowIndex, field) {
  const error = state.errors.find((item) => item.rowIndex === rowIndex && item.field === field);
  return error ? t.error(field, error.code, state.category) : '';
}

function field(row, rowIndex, fieldName) {
  const wrap = node('div', '', `field field-${fieldName}`);
  const id = `${row.id}-${fieldName}`;
  const label = node('label', t[fieldName]);
  label.htmlFor = id;
  const input = node(fieldName === 'unit' ? 'select' : 'input');
  input.id = id;
  input.dataset.field = fieldName;
  input.dataset.row = row.id;
  if (fieldName === 'unit') {
    for (const unit of CATEGORIES[state.category].units) {
      const option = node('option', unit === 'piece' ? t.piece : unit);
      option.value = unit;
      input.append(option);
    }
    input.disabled = state.category === 'count';
  } else {
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.inputMode = fieldName === 'name' ? 'text' : fieldName === 'packCount' || (fieldName === 'capacity' && state.category === 'count') ? 'numeric' : 'decimal';
    if (fieldName !== 'name') input.required = true;
  }
  input.value = row[fieldName];
  const help = { price: 'price-help', capacity: 'capacity-help', packCount: 'pack-help' }[fieldName];
  const error = node('p', errorFor(rowIndex, fieldName), 'field-error');
  error.id = `${id}-error`;
  error.hidden = !error.textContent;
  input.setAttribute('aria-describedby', [help, error.id].filter(Boolean).join(' '));
  input.setAttribute('aria-invalid', String(Boolean(error.textContent)));
  input.addEventListener(fieldName === 'unit' ? 'change' : 'input', () => {
    state.edit(row.id, fieldName, input.value);
    error.textContent = errorFor(rowIndex, fieldName);
    error.hidden = !error.textContent;
    input.setAttribute('aria-invalid', String(Boolean(error.textContent)));
    renderOutput();
  });
  wrap.append(label, input, error);
  return wrap;
}

function renderRows() {
  controls.rows.replaceChildren();
  controls.category.value = state.category;
  byId('capacity-help').textContent = state.category === 'count' ? t.quantityCount : t.quantityDecimal;
  state.rows.forEach((row, index) => {
    const group = node('fieldset', '', 'product-row');
    group.dataset.row = row.id;
    group.append(node('legend', `${t.product} ${index + 1}`));
    const fields = node('div', '', 'row-fields');
    for (const name of ['name', 'price', 'capacity', 'unit', 'packCount']) fields.append(field(row, index, name));
    const actions = node('div', '', 'row-actions');
    const remove = node('button', t.remove, 'quiet');
    remove.type = 'button';
    remove.setAttribute('aria-label', `${t.remove} ${index + 1}`);
    remove.setAttribute('aria-describedby', 'row-limit');
    remove.disabled = state.rows.length <= 2;
    remove.addEventListener('click', () => {
      if (!state.removeRow(row.id)) return;
      renderAll();
      byId(`${state.rows[Math.min(index, state.rows.length - 1)].id}-name`).focus();
    });
    actions.append(remove);
    fields.append(actions);
    group.append(fields);
    controls.rows.append(group);
  });
  byId('add').disabled = state.rows.length >= 12;
  byId('row-count').textContent = t.rowCount(state.rows.length);
  byId('row-limit').textContent = state.rows.length === 12 ? t.rowLimit : t.rowRange;
}

function renderOutput() {
  byId('example-marker').hidden = !state.example;
  controls.copy.disabled = !state.result || state.copyBusy;
  controls.copy.textContent = state.copyBusy ? t.busy : t.copy;
  controls.copy.setAttribute('aria-busy', String(state.copyBusy));
  const status = state.copyStatus || state.status;
  controls.status.textContent = status === 'example' ? t.exampleStatus : status === 'invalid' ? t.errorsText(state.errors.length) : t[status];
  controls.status.dataset.state = status;
  controls.result.hidden = !state.result;
  controls.fallback.hidden = !state.copyFallback;
  byId('copy-text').value = state.copyFallback;
  const body = byId('result-rows');
  body.replaceChildren();
  byId('collision').hidden = !state.result?.hasRoundedCollision;
  byId('precision').hidden = !state.result?.rows.some((row) => row.displayUnitPrice === '<0.0001');
  if (!state.result) return;
  byId('result-summary').textContent = t.resultSummary(state.result.rows.length, basis());
  byId('basis-heading').textContent = `${t.unitPrice} (${basis()})`;
  const rankCounts = new Map();
  for (const row of state.result.rows) rankCounts.set(row.rank, (rankCounts.get(row.rank) || 0) + 1);
  for (const row of state.result.rows) {
    const tr = node('tr', '', row.lowest ? 'lowest-row' : '');
    const rank = node('td', String(row.rank), 'data rank');
    if (rankCounts.get(row.rank) > 1) rank.append(node('span', t.tie, 'row-note'));
    const name = node('th', displayNameForLocale(row, locale));
    name.scope = 'row';
    if (row.lowest) name.append(node('span', `✓ ${t.lowest}`, 'lowest-label'));
    tr.append(rank, name, node('td', formatPrice(row.priceCents), 'data'), node('td', row.packCount.toString(), 'data'), node('td', quantityText(row.totalQuantityMilli), 'data'), node('td', row.displayUnitPrice, 'data unit-price'));
    body.append(tr);
  }
}

function renderAll() { renderRows(); renderOutput(); }

byId('comparison-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const result = state.compare();
  renderAll();
  if (!result.ok) {
    const first = result.errors.find((error) => error.rowIndex !== null && error.field !== null);
    if (first) byId(`${state.rows[first.rowIndex].id}-${first.field}`).focus();
    else controls.category.focus();
  }
});
controls.category.addEventListener('change', () => { state.changeCategory(controls.category.value); renderAll(); });
byId('add').addEventListener('click', () => {
  if (!state.addRow()) return;
  renderAll();
  byId(`${state.rows.at(-1).id}-name`).focus();
});
byId('example').addEventListener('click', () => { state.loadExample(locale); renderAll(); });
byId('clear').addEventListener('click', () => { state.reset('cleared'); renderAll(); controls.category.focus(); });
controls.copy.addEventListener('click', async () => {
  const request = state.beginCopy();
  if (!request) return;
  renderOutput();
  const text = createCopyText(request.result, locale);
  let success = false;
  try {
    await navigator.clipboard.writeText(text);
    success = true;
  } catch {
    // A fixed, manual recovery path also covers a missing Clipboard API.
  }
  if (state.finishCopy(request, success, text)) {
    renderOutput();
    if (!success) byId('copy-text').focus();
  }
});
byId('select-copy').addEventListener('click', () => { byId('copy-text').focus(); byId('copy-text').select(); });
window.addEventListener('pagehide', () => { state.reset(); renderAll(); });
window.addEventListener('pageshow', () => { state.reset(); renderAll(); });
renderAll();
byId('app').hidden = false;
