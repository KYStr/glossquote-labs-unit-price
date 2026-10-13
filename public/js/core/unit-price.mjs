export const CATEGORIES = Object.freeze({
  weight: Object.freeze({ units: Object.freeze(['g', 'kg']), basis: '100 g', unit: 'g', multiplier: 1000n }),
  volume: Object.freeze({ units: Object.freeze(['mL', 'L']), basis: '100 mL', unit: 'mL', multiplier: 1000n }),
  count: Object.freeze({ units: Object.freeze(['piece']), basis: 'piece', unit: 'piece', multiplier: 10n }),
});

const asciiTrim = (raw) => raw.replace(/^[\u0009-\u000D\u0020]+|[\u0009-\u000D\u0020]+$/g, '');

export function parseDecimalToScaledInteger(raw, { decimalPlaces = 2 } = {}) {
  if (typeof raw !== 'string') return { ok: false, code: 'invalid-format' };
  if (raw.length > 32) return { ok: false, code: 'input-too-long' };
  const text = asciiTrim(raw);
  if (!text) return { ok: false, code: 'required' };
  if (![0, 2, 3].includes(decimalPlaces)) return { ok: false, code: 'invalid-format' };
  const grammar = decimalPlaces === 0 ? /^[0-9]+$/ : new RegExp(`^[0-9]+(?:\\.[0-9]{1,${decimalPlaces}})?$`);
  if (!grammar.test(text)) return { ok: false, code: 'invalid-format' };
  const [integer, fraction = ''] = text.split('.');
  return { ok: true, value: BigInt(integer + fraction.padEnd(decimalPlaces, '0')) };
}

function exactRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function validateComparisonInput(input) {
  const errors = [];
  const add = (rowIndex, field, code) => errors.push({ rowIndex, field, code });
  if (!exactRecord(input, ['category', 'rows']) || !Array.isArray(input.rows)) {
    return { ok: false, errors: [{ rowIndex: null, field: null, code: 'invalid-input-schema' }] };
  }
  const category = typeof input.category === 'string' && Object.hasOwn(CATEGORIES, input.category) ? CATEGORIES[input.category] : null;
  if (!category) add(null, null, 'invalid-category');
  if (input.rows.length < 2 || input.rows.length > 12) add(null, null, 'row-count-out-of-range');
  // Bound work before inspecting an untrusted list of rows.
  if (input.rows.length > 12) return { ok: false, errors };
  const ids = new Set();
  const normalizedRows = [];
  for (let index = 0; index < input.rows.length; index += 1) {
    const row = Object.hasOwn(input.rows, index) ? input.rows[index] : undefined;
    const keys = ['id', 'name', 'price', 'capacity', 'packCount', 'unit'];
    if (!exactRecord(row, keys) || !keys.every((key) => typeof row[key] === 'string') || row.id.length === 0 || row.id.length > 64) {
      add(index, null, 'invalid-row-schema');
      continue;
    }
    if (ids.has(row.id)) add(index, null, 'duplicate-row-id');
    ids.add(row.id);
    const name = row.name.trim();
    if (row.name.length > 80) add(index, 'name', 'name-too-long');
    else if (/[\u0000-\u001F\u007F-\u009F]/.test(name)) add(index, 'name', 'name-control-character');
    const price = parseDecimalToScaledInteger(row.price, { decimalPlaces: 2 });
    const capacity = parseDecimalToScaledInteger(row.capacity, { decimalPlaces: input.category === 'count' ? 0 : 3 });
    const packs = parseDecimalToScaledInteger(row.packCount, { decimalPlaces: 0 });
    for (const [field, parsed, min, max, code] of [
      ['price', price, 0n, 999999999n, 'price-out-of-range'],
      ['capacity', capacity, 1n, input.category === 'count' ? 1000000n : 1000000000n, 'capacity-out-of-range'],
      ['packCount', packs, 1n, 1000n, 'pack-count-out-of-range'],
    ]) {
      if (!parsed.ok) add(index, field, parsed.code);
      else if (parsed.value < min || parsed.value > max) add(index, field, code);
    }
    if (category && !category.units.includes(row.unit)) add(index, 'unit', 'invalid-unit');
    if (price.ok && capacity.ok && packs.ok && category) {
      const factor = row.unit === 'kg' || row.unit === 'L' || input.category === 'count' ? 1000n : 1n;
      normalizedRows.push({
        id: row.id, sourceIndex: index, displayName: name || `商品 ${index + 1}`, hasCustomName: Boolean(name),
        priceCents: price.value, packCount: packs.value,
        totalQuantityMilli: capacity.value * factor * packs.value,
      });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, category: input.category, rows: normalizedRows };
}

export function compareUnitPrices(a, b) {
  const left = a.unitPriceNumerator * b.unitPriceDenominator;
  const right = b.unitPriceNumerator * a.unitPriceDenominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function formatUnitPrice(numerator, denominator) {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || numerator < 0n || denominator <= 0n) {
    throw new RangeError('Invalid unit price fraction');
  }
  const rounded = (2n * numerator * 10000n + denominator) / (2n * denominator);
  if (numerator > 0n && rounded === 0n) return '<0.0001';
  return `${rounded / 10000n}.${(rounded % 10000n).toString().padStart(4, '0')}`;
}

export function formatTotalQuantity(totalMilli) {
  if (typeof totalMilli !== 'bigint' || totalMilli < 0n) throw new RangeError('Invalid quantity');
  const remainder = (totalMilli % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${totalMilli / 1000n}${remainder ? `.${remainder}` : ''}`;
}

export function calculateComparison(input) {
  const validated = validateComparisonInput(input);
  if (!validated.ok) return validated;
  const category = CATEGORIES[validated.category];
  const rows = validated.rows.map((row) => ({
    ...row, unitPriceNumerator: row.priceCents * category.multiplier, unitPriceDenominator: row.totalQuantityMilli,
  }));
  rows.sort((a, b) => compareUnitPrices(a, b) || a.sourceIndex - b.sourceIndex);
  let rank = 0;
  let previous = null;
  let hasRoundedCollision = false;
  const displayGroups = new Map();
  for (const row of rows) {
    if (!previous || compareUnitPrices(row, previous) !== 0) rank += 1;
    row.rank = rank;
    row.lowest = rank === 1;
    row.displayUnitPrice = formatUnitPrice(row.unitPriceNumerator, row.unitPriceDenominator);
    const sameDisplay = displayGroups.get(row.displayUnitPrice);
    if (sameDisplay && compareUnitPrices(row, sameDisplay) !== 0) hasRoundedCollision = true;
    else if (!sameDisplay) displayGroups.set(row.displayUnitPrice, row);
    previous = row;
    Object.freeze(row);
  }
  return Object.freeze({
    ok: true, category: validated.category, basis: category.basis, rows: Object.freeze(rows),
    cheapestRowIds: Object.freeze(rows.filter((row) => row.lowest).map((row) => row.id)), hasRoundedCollision,
  });
}

export function displayNameForLocale(row, locale) {
  return row.hasCustomName ? row.displayName : `${locale === 'en' ? 'Product' : '商品'} ${row.sourceIndex + 1}`;
}

export function formatPrice(priceCents) {
  return `${priceCents / 100n}.${(priceCents % 100n).toString().padStart(2, '0')}`;
}

export function createCopyText(result, locale = 'zh-Hant') {
  if (!result?.ok) throw new TypeError('A validated comparison result is required');
  const en = locale === 'en';
  const categoryNames = en ? { weight: 'Weight', volume: 'Volume', count: 'Item count' } : { weight: '重量', volume: '容量', count: '件數' };
  const basis = result.category === 'count' ? (en ? 'per piece' : '每件') : `${en ? 'per' : '每'} ${result.basis}`;
  const unit = result.category === 'count' ? (en ? 'pieces' : '件') : CATEGORIES[result.category].unit;
  const lines = [
    en ? 'Unit Price Comparison' : '購物單價比較',
    `${en ? 'Category' : '類別'}: ${categoryNames[result.category]}`,
    en ? 'All prices use the same currency. No currency conversion.' : '所有價格使用同一幣別；不換匯。',
    (en ? ['Rank', 'Product', 'Total price paid', 'Packs', 'Total quantity', `Unit price (${basis})`, 'Note']
      : ['排名', '商品', '整組實付價格', '包數', '整組總量', `單價（${basis}）`, '註記']).join('\t'),
  ];
  for (const row of result.rows) {
    lines.push([row.rank, displayNameForLocale(row, locale), formatPrice(row.priceCents), row.packCount,
      `${formatTotalQuantity(row.totalQuantityMilli)} ${unit}`, `${row.displayUnitPrice} / ${result.category === 'count' ? (en ? 'piece' : '件') : result.basis}`,
      row.lowest ? (en ? 'Lowest unit price' : '最低單價') : '',
    ].join('\t'));
  }
  if (result.hasRoundedCollision) lines.push(en ? 'Values are rounded for display; ordering uses the unrounded unit price.' : '顯示值已四捨五入；排序依未四捨五入單價。');
  return lines.join('\n');
}
