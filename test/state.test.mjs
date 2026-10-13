import test from 'node:test';
import assert from 'node:assert/strict';
import { ComparisonState } from '../public/js/state.mjs';
import { TEXT } from '../public/js/i18n.mjs';

function successful() { const state = new ComparisonState(); state.loadExample('en'); state.compare(); return state; }

test('initial/reset/default/add/remove bounds and IDs never reused', () => {
  const state = new ComparisonState();
  assert.equal(state.category, 'weight');
  assert.deepEqual(state.rows.map(({ name, price, capacity, packCount, unit }) => ({ name, price, capacity, packCount, unit })), Array.from({ length: 2 }, () => ({ name: '', price: '', capacity: '', packCount: '1', unit: 'g' })));
  assert.equal(state.removeRow(state.rows[0].id), false);
  const firstId = state.rows[0].id;
  for (let i = 2; i < 12; i++) assert.equal(state.addRow(), true);
  assert.equal(state.addRow(), false); assert.equal(state.rows.length, 12);
  const survivor = state.rows[1].id;
  assert.equal(state.removeRow(firstId), true); assert.equal(state.rows[0].id, survivor);
  state.reset(); assert.ok(state.rows.every((row) => row.id !== firstId));
});
test('example populates only; compare remains explicit in both languages', () => {
  for (const locale of ['en', 'zh-Hant']) {
    const state = new ComparisonState(); state.loadExample(locale);
    assert.equal(state.result, null); assert.equal(state.example, true); assert.equal(state.status, 'example');
    assert.deepEqual(state.rows.map((row) => [row.price, row.capacity, row.packCount, row.unit]), [['120', '500', '2', 'g'], ['150', '1.5', '1', 'kg']]);
  }
});
test('every source mutation invalidates result, busy and fallback', () => {
  for (const operation of [
    (state) => state.edit(state.rows[0].id, 'name', 'Changed'), (state) => state.edit(state.rows[0].id, 'price', '121'),
    (state) => state.edit(state.rows[0].id, 'capacity', '501'), (state) => state.edit(state.rows[0].id, 'packCount', '3'),
    (state) => state.edit(state.rows[0].id, 'unit', 'kg'), (state) => state.addRow(), (state) => state.changeCategory('volume'),
    (state) => state.loadExample('zh-Hant'), (state) => state.reset('cleared'),
  ]) {
    const state = successful(); const request = state.beginCopy(); const revision = state.revision;
    operation(state);
    assert.ok(state.revision > revision); assert.equal(state.result, null); assert.equal(state.copyBusy, false);
    assert.equal(state.copyFallback, ''); assert.equal(state.copyStatus, '');
    assert.equal(state.finishCopy(request, false, 'STALE'), false);
  }
  const state = successful(); state.addRow(); state.compare(); state.removeRow(state.rows[2].id); assert.equal(state.result, null);
});
test('field correction removes only its own error and preserves the rest', () => {
  const state = new ComparisonState(); state.compare();
  state.edit(state.rows[0].id, 'price', '1');
  assert.deepEqual(state.errors.map((item) => [item.rowIndex, item.field]), [[0, 'capacity'], [1, 'price'], [1, 'capacity']]);
  state.addRow(); state.removeRow(state.rows[0].id);
  assert.deepEqual(state.errors.map((item) => [item.rowIndex, item.field]), [[0, 'price'], [0, 'capacity']]);
});
test('copy locks synchronously; latest request and revision both gate settle', () => {
  const state = successful(); const request = state.beginCopy();
  assert.equal(state.copyBusy, true); assert.equal(state.beginCopy(), null);
  assert.ok(Object.isFrozen(request.result)); assert.ok(Object.isFrozen(request.result.rows)); assert.ok(Object.isFrozen(request.result.rows[0]));
  assert.equal(state.finishCopy({ ...request, id: request.id - 1 }, true, ''), false);
  assert.equal(state.copyBusy, true);
  assert.equal(state.finishCopy(request, false, 'Manual report'), true);
  assert.equal(state.copyStatus, 'fallback'); assert.equal(state.copyFallback, 'Manual report'); assert.equal(state.copyBusy, false);
  const next = state.beginCopy(); assert.equal(state.copyFallback, ''); assert.equal(state.finishCopy(request, true, ''), false);
  assert.equal(state.finishCopy(next, true, ''), true); assert.equal(state.copyStatus, 'copied');
});
test('late successful/rejected promises cannot affect a new result or copy', async () => {
  for (const resolves of [true, false]) {
    const state = successful(); const old = state.beginCopy();
    let settle;
    const promise = new Promise((resolve) => { settle = resolve; }).then((success) => state.finishCopy(old, success, 'OLD-TEXT'));
    state.edit(state.rows[0].id, 'price', '121'); state.compare();
    const latest = state.beginCopy();
    settle(resolves); assert.equal(await promise, false);
    assert.equal(state.copyBusy, true); assert.equal(state.copyStatus, 'busy'); assert.equal(state.copyFallback, '');
    assert.equal(state.finishCopy(latest, true, ''), true);
  }
});
test('two locales have full state/error vocabulary parity', () => {
  assert.deepEqual(Object.keys(TEXT.en).sort(), Object.keys(TEXT['zh-Hant']).sort());
  for (const locale of ['en', 'zh-Hant']) for (const code of ['required', 'input-too-long', 'invalid-format', 'price-out-of-range', 'capacity-out-of-range', 'pack-count-out-of-range', 'name-too-long', 'name-control-character', 'invalid-unit']) assert.ok(TEXT[locale].error('price', code, 'weight').length > 0);
});
