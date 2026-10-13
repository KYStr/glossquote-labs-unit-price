import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateComparison, validateComparisonInput, parseDecimalToScaledInteger, compareUnitPrices,
  formatUnitPrice, formatTotalQuantity, createCopyText,
} from '../public/js/core/unit-price.mjs';
import { ComparisonState } from '../public/js/state.mjs';

const row = (id, extra = {}) => ({ id, name: '', price: '1', capacity: '100', packCount: '1', unit: 'g', ...extra });
const input = (rows, category = 'weight') => ({ category, rows });
const compare = (rows, category) => calculateComparison(input(rows, category));
const valid = (rows, category) => { const result = compare(rows, category); assert.equal(result.ok, true); return result; };
const codes = (data) => { const result = calculateComparison(data); assert.equal(result.ok, false); return result.errors.map((error) => error.code); };
const fieldCode = (field, value, expected, category = 'weight') => {
  const unit = category === 'count' ? 'piece' : 'g';
  const result = compare([row('a', { unit, [field]: value }), row('b', { unit })], category);
  assert.equal(result.ok, false);
  assert.equal(result.errors.find((error) => error.rowIndex === 0 && error.field === field)?.code, expected);
};

test('A01 all blank rows are validated, no partial result', () => {
  const result = compare([row('a', { price: '', capacity: '' }), row('b', { price: '', capacity: '' })]);
  assert.deepEqual(result, { ok: false, errors: [
    { rowIndex: 0, field: 'price', code: 'required' }, { rowIndex: 0, field: 'capacity', code: 'required' },
    { rowIndex: 1, field: 'price', code: 'required' }, { rowIndex: 1, field: 'capacity', code: 'required' },
  ] });
});
test('A02 example total-price semantics: B 10.0000 precedes A 12.0000', () => {
  const result = valid([row('a', { price: '120', capacity: '500', packCount: '2' }), row('b', { price: '150', capacity: '1.5', unit: 'kg' })]);
  assert.deepEqual(result.rows.map((item) => [item.id, item.displayUnitPrice, item.rank, item.totalQuantityMilli]), [
    ['b', '10.0000', 1, 1500000n], ['a', '12.0000', 2, 1000000n],
  ]);
  assert.deepEqual(result.cheapestRowIds, ['b']);
});
test('A03 weight units tie exactly, source order retained', () => {
  const result = valid([row('a', { price: '12', capacity: '1', unit: 'kg' }), row('b', { price: '12', capacity: '1000' })]);
  assert.deepEqual(result.rows.map((item) => [item.id, item.rank, item.displayUnitPrice]), [['a', 1, '1.2000'], ['b', 1, '1.2000']]);
  assert.deepEqual(result.cheapestRowIds, ['a', 'b']);
  assert.equal(result.hasRoundedCollision, false);
});
test('A04 volume units tie exactly', () => {
  const result = valid([row('a', { price: '3', capacity: '1.5', unit: 'L' }), row('b', { price: '3', capacity: '1500', unit: 'mL' })], 'volume');
  assert.equal(result.basis, '100 mL');
  assert.deepEqual(result.rows.map((item) => [item.rank, item.displayUnitPrice, item.totalQuantityMilli]), [[1, '0.2000', 1500000n], [1, '0.2000', 1500000n]]);
});
test('A05 pack count changes quantity, not total price paid', () => {
  const result = valid([row('a', { price: '60', capacity: '500', packCount: '2' }), row('b', { price: '90', capacity: '1', unit: 'kg' })]);
  assert.deepEqual(result.rows.map((item) => [item.displayUnitPrice, item.totalQuantityMilli]), [['6.0000', 1000000n], ['9.0000', 1000000n]]);
});
test('A06 exact ties use dense ranks 1,1,2', () => {
  const result = valid([row('a', { price: '120', capacity: '1000' }), row('b', { price: '60', capacity: '500' }), row('c', { price: '150', capacity: '1000' })]);
  assert.deepEqual(result.rows.map((item) => [item.id, item.rank, item.lowest]), [['a', 1, true], ['b', 1, true], ['c', 2, false]]);
  assert.equal(result.rows[2].displayUnitPrice, '15.0000');
});
test('A07 1.23445 rounds half-up to 1.2345', () => {
  assert.equal(valid([row('a', { price: '246.89', capacity: '20', unit: 'kg' }), row('b')]).rows.find((item) => item.id === 'a').displayUnitPrice, '1.2345');
});
test('A08 1.23455 rounds half-up to 1.2346', () => {
  assert.equal(valid([row('a', { price: '246.91', capacity: '20', unit: 'kg' }), row('b')]).rows.find((item) => item.id === 'a').displayUnitPrice, '1.2346');
});
test('A09 rounded collision never becomes an exact tie', () => {
  const result = valid([row('a', { capacity: '99.996' }), row('b')]);
  assert.deepEqual(result.rows.map((item) => [item.id, item.rank, item.displayUnitPrice]), [['b', 1, '1.0000'], ['a', 2, '1.0000']]);
  assert.equal(result.hasRoundedCollision, true);
});
test('A10 free price is 0.0000 and lowest', () => {
  const result = valid([row('a', { price: '0', capacity: '500' }), row('b')]);
  assert.equal(result.rows[0].displayUnitPrice, '0.0000');
  assert.equal(result.rows[0].lowest, true);
});
test('A11 positive price below display precision never shows free', () => {
  assert.equal(valid([row('a', { price: '0.01', capacity: '1000000', packCount: '1000' }), row('b')]).rows[0].displayUnitPrice, '<0.0001');
});
test('A12 maximum price accepted exactly', () => {
  assert.equal(valid([row('a', { price: '9999999.99' }), row('b')]).rows[1].displayUnitPrice, '9999999.9900');
});
test('A13 above maximum price rejected exactly', () => fieldCode('price', '10000000', 'price-out-of-range'));
test('A14 leading zeros accepted without mutating the input', () => {
  const data = input([row('a', { price: '0001.2' }), row('b')]);
  const before = structuredClone(data);
  const result = calculateComparison(data);
  assert.equal(result.rows.find((item) => item.id === 'a').priceCents, 120n);
  assert.deepEqual(data, before);
});
test('A15 price grammar rejects empty and unsupported formats', () => {
  fieldCode('price', '', 'required');
  for (const value of ['1.001', '1e2', '+1', '-1', ',1', '.5', '5.', '１２', '1 2', '1,000']) fieldCode('price', value, 'invalid-format');
});
test('A16 only specified ASCII whitespace is trimmed', () => {
  for (const [text, cents] of [['0.0', 0n], ['0.01', 1n], ['\t\r\n 1\v\f ', 100n]]) assert.deepEqual(parseDecimalToScaledInteger(text), { ok: true, value: cents });
  for (const text of ['　1　', '\u00A01', '1\uFEFF']) fieldCode('price', text, 'invalid-format');
});
test('A17 capacity must be positive and present', () => { fieldCode('capacity', '0', 'capacity-out-of-range'); fieldCode('capacity', ' ', 'required'); });
test('A18 minimum capacity uses milli-g exactly', () => {
  assert.equal(valid([row('a', { capacity: '0.001' }), row('b')]).rows.find((item) => item.id === 'a').totalQuantityMilli, 1n);
});
test('A19 maximum capacity accepted', () => {
  assert.equal(valid([row('a', { capacity: '1000000.000' }), row('b')]).rows[0].totalQuantityMilli, 1000000000n);
});
test('A20 capacity precision and maximum enforced', () => {
  fieldCode('capacity', '1000000.001', 'capacity-out-of-range');
  for (const value of ['0.0001', '1.0000', '1e2', '.5', '5.', '+1', '-1', '１']) fieldCode('capacity', value, 'invalid-format');
});
test('A21 pieces are integers with per-piece basis', () => {
  const result = valid([row('a', { price: '6', capacity: '3', packCount: '2', unit: 'piece' }), row('b', { price: '2', capacity: '1', unit: 'piece' })], 'count');
  assert.equal(result.basis, 'piece');
  assert.equal(result.rows[0].displayUnitPrice, '1.0000');
  assert.equal(result.rows[0].totalQuantityMilli, 6000n);
  fieldCode('capacity', '1.5', 'invalid-format', 'count');
});
test('A22 pack boundaries and grammar', () => {
  assert.equal(valid([row('a', { packCount: '1' }), row('b', { packCount: '1000' })]).ok, true);
  for (const value of ['0', '1001']) fieldCode('packCount', value, 'pack-count-out-of-range');
  for (const value of ['1.0', '1e2', '+1', '-1', '１', '1,0']) fieldCode('packCount', value, 'invalid-format');
  fieldCode('packCount', '', 'required');
});
test('A23 whole-list bounds reject 1 and 13 rows', () => {
  for (const count of [2, 12]) assert.equal(compare(Array.from({ length: count }, (_, index) => row(String(index)))).ok, true);
  for (const count of [1, 13]) assert.ok(codes(input(Array.from({ length: count }, (_, index) => row(String(index))))).includes('row-count-out-of-range'));
});
test('A24 raw length limit precedes trim and numeric parsing', () => {
  for (const field of ['price', 'capacity', 'packCount']) fieldCode(field, `${'0'.repeat(32)}1`, 'input-too-long');
  assert.deepEqual(parseDecimalToScaledInteger(` ${'0'.repeat(31)} `), { ok: false, code: 'input-too-long' });
  assert.equal(parseDecimalToScaledInteger(`${'0'.repeat(31)}1`).ok, true);
});
test('A25 blank names fallback by original row number; names are trimmed', () => {
  const result = valid([row('a', { name: '   ' }), row('b', { name: '  牛奶　' })]);
  assert.deepEqual(result.rows.map((item) => item.displayName), ['商品 1', '牛奶']);
  assert.match(createCopyText(result, 'en'), /Product 1/);
});
test('A26 name length uses raw UTF-16 code units', () => {
  for (const name of ['a'.repeat(80), '😀'.repeat(40)]) assert.equal(compare([row('a', { name }), row('b')]).ok, true);
  for (const name of ['a'.repeat(81), '😀'.repeat(41), ` ${'a'.repeat(80)}`]) fieldCode('name', name, 'name-too-long');
});
test('A27 reject internal controls; preserve HTML-like name as plain text', () => {
  for (const name of ['a\nb', 'a\0b', 'a\u0085b']) fieldCode('name', name, 'name-control-character');
  const name = '<img src=x onerror=alert(1)>';
  const result = valid([row('a', { name }), row('b')]);
  assert.equal(result.rows[0].displayName, name);
  assert.ok(createCopyText(result, 'en').includes(name));
});
test('A28 category change clears capacities and units only', () => {
  const state = new ComparisonState();
  state.loadExample('en'); state.compare();
  const before = state.rows.map(({ id, name, price, packCount }) => ({ id, name, price, packCount }));
  state.changeCategory('volume');
  assert.deepEqual(state.rows.map(({ id, name, price, packCount }) => ({ id, name, price, packCount })), before);
  assert.ok(state.rows.every((item) => item.capacity === '' && item.unit === 'mL'));
  assert.equal(state.result, null); assert.equal(state.status, 'categoryChanged');
  state.changeCategory('count'); assert.ok(state.rows.every((item) => item.unit === 'piece'));
});
test('A29 exact schemas and allowlists fail closed', () => {
  assert.deepEqual(codes({ category: 'weight', rows: [row('a'), row('b')], unexpected: true }), ['invalid-input-schema']);
  assert.deepEqual(codes({ rows: [], category: 'weight', [Symbol('hidden')]: true }), ['invalid-input-schema']);
  assert.ok(codes(input([row('a'), row('b')], 'unknown')).includes('invalid-category'));
  assert.ok(codes(input([row('a'), row('b')], '__proto__')).includes('invalid-category'));
  fieldCode('unit', 'L', 'invalid-unit');
  for (const data of [null, {}, { category: 'weight', rows: {} }]) assert.deepEqual(codes(data), ['invalid-input-schema']);
  for (const extra of [{ price: 1 }, { extra: 'unknown' }, { id: '' }, { id: 'x'.repeat(65) }]) assert.ok(codes(input([row('a', extra), row('b')])).includes('invalid-row-schema'));
});
test('A30 maximum values produce correct ranks beyond safe Number integers', () => {
  const result = valid([row('a', { price: '9999999.99', capacity: '1000000', packCount: '1000', unit: 'kg' }), row('b', { price: '9999999.98', capacity: '1000000', packCount: '1000', unit: 'kg' })]);
  assert.deepEqual(result.rows.map((item) => [item.id, item.rank, item.displayUnitPrice]), [['b', 1, '0.0010'], ['a', 2, '0.0010']]);
  assert.equal(result.hasRoundedCollision, true);
  assert.equal(result.rows[0].totalQuantityMilli, 1000000000000000n);
  assert.ok(result.rows[0].unitPriceNumerator * result.rows[1].unitPriceDenominator > 9007199254740991n);
  assert.equal(compareUnitPrices(result.rows[0], result.rows[1]), -1);
});
test('A31 full pure-text copy contains category, currency note, every column/row', () => {
  const result = valid([row('a', { name: 'A', price: '120', capacity: '500', packCount: '2' }), row('b', { name: 'B', price: '150', capacity: '1.5', unit: 'kg' })]);
  assert.equal(createCopyText(result, 'en'), [
    'Unit Price Comparison', 'Category: Weight', 'All prices use the same currency. No currency conversion.',
    'Rank\tProduct\tTotal price paid\tPacks\tTotal quantity\tUnit price (per 100 g)\tNote',
    '1\tB\t150.00\t1\t1500 g\t10.0000 / 100 g\tLowest unit price',
    '2\tA\t120.00\t2\t1000 g\t12.0000 / 100 g\t',
  ].join('\n'));
  const zh = createCopyText(result, 'zh-Hant');
  for (const text of ['類別: 重量', '同一幣別', '排名', '整組實付價格', '包數', '整組總量', '10.0000', '12.0000', '最低單價']) assert.ok(zh.includes(text));
  assert.doesNotMatch(zh, /<table|<tr|<td/);
});
test('A32 free exact ties are rank 1,1; paid row is rank 2', () => {
  const result = valid([row('a', { price: '0' }), row('b', { price: '0', capacity: '500' }), row('c')]);
  assert.deepEqual(result.rows.map((item) => [item.rank, item.displayUnitPrice]), [[1, '0.0000'], [1, '0.0000'], [2, '1.0000']]);
  assert.deepEqual(result.cheapestRowIds, ['a', 'b']);
});
test('A33 repeated/missing internal IDs are rejected', () => {
  assert.ok(codes(input([row('same'), row('same')])).includes('duplicate-row-id'));
  const missing = row('a'); delete missing.id;
  assert.ok(codes(input([missing, row('b')])).includes('invalid-row-schema'));
});
test('UP-M1-R1 sparse rows are schema errors, never a partial success', () => {
  assert.deepEqual(compare(new Array(2)), { ok: false, errors: [
    { rowIndex: 0, field: null, code: 'invalid-row-schema' },
    { rowIndex: 1, field: null, code: 'invalid-row-schema' },
  ] });
  assert.deepEqual(compare([row('a'), ,]), { ok: false, errors: [{ rowIndex: 1, field: null, code: 'invalid-row-schema' }] });
  const inherited = new Array(2); const prototype = []; prototype[0] = row('inherited'); Object.setPrototypeOf(inherited, prototype);
  assert.deepEqual(compare(inherited).errors.map((item) => item.rowIndex), [0, 1]);
});
test('formatter contracts reject invalid fractions, preserve decimal quantities', () => {
  assert.equal(formatUnitPrice(1n, 20000n), '0.0001');
  assert.equal(formatUnitPrice(1n, 20001n), '<0.0001');
  assert.equal(formatUnitPrice(0n, 1n), '0.0000');
  for (const [n, d] of [[-1n, 1n], [1n, 0n], [1, 1n]]) assert.throws(() => formatUnitPrice(n, d), RangeError);
  for (const [milli, text] of [[0n, '0'], [1n, '0.001'], [1200n, '1.2'], [1000000000000000n, '1000000000000']]) assert.equal(formatTotalQuantity(milli), text);
  assert.throws(() => createCopyText({ ok: false }), TypeError);
});
test('stable validation order; errors never echo original input', () => {
  const result = validateComparisonInput(input([row('a', { name: 'a\0b', price: 'RAW-SENTINEL', capacity: '', packCount: '0', unit: 'unknown' }), row('b')]));
  assert.deepEqual(result.errors.map((item) => item.field), ['name', 'price', 'capacity', 'packCount', 'unit']);
  assert.ok(!JSON.stringify(result).includes('RAW-SENTINEL'));
});
