import { calculateComparison, CATEGORIES } from './core/unit-price.mjs';

export class ComparisonState {
  constructor() {
    this.rowCounter = 0;
    this.revision = 0;
    this.copyRequestId = 0;
    this.reset();
  }
  newRow(values = {}) {
    this.rowCounter += 1;
    return { id: `row-${this.rowCounter}`, name: '', price: '', capacity: '', packCount: '1', unit: CATEGORIES[this.category].units[0], ...values };
  }
  invalidate(status = 'changed') {
    this.revision += 1;
    this.copyRequestId += 1;
    this.result = null;
    this.copyBusy = false;
    this.copyStatus = '';
    this.copyFallback = '';
    this.status = status;
  }
  reset(status = 'initial') {
    this.invalidate(status);
    this.category = 'weight';
    this.rows = [this.newRow(), this.newRow()];
    this.errors = [];
    this.example = false;
  }
  edit(id, field, value) {
    if (!['name', 'price', 'capacity', 'packCount', 'unit'].includes(field)) return;
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0 || this.rows[index][field] === value) return;
    this.rows[index][field] = value;
    this.errors = this.errors.filter((error) => error.rowIndex !== index || error.field !== field);
    this.example = false;
    this.invalidate();
  }
  changeCategory(category) {
    if (!Object.hasOwn(CATEGORIES, category) || category === this.category) return;
    this.category = category;
    this.rows.forEach((row) => { row.capacity = ''; row.unit = CATEGORIES[category].units[0]; });
    this.errors = this.errors.filter((error) => !['capacity', 'unit'].includes(error.field));
    this.example = false;
    this.invalidate('categoryChanged');
  }
  addRow() {
    if (this.rows.length === 12) return false;
    this.rows.push(this.newRow());
    this.example = false;
    this.invalidate();
    return true;
  }
  removeRow(id) {
    if (this.rows.length === 2) return false;
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0) return false;
    this.rows.splice(index, 1);
    this.errors = this.errors.filter((error) => error.rowIndex !== index).map((error) => ({
      ...error, rowIndex: error.rowIndex !== null && error.rowIndex > index ? error.rowIndex - 1 : error.rowIndex,
    }));
    this.example = false;
    this.invalidate();
    return true;
  }
  loadExample(locale) {
    this.invalidate('example');
    this.category = 'weight';
    this.rows = [
      this.newRow({ name: locale === 'en' ? 'Product A' : '商品 A', price: '120', capacity: '500', packCount: '2' }),
      this.newRow({ name: locale === 'en' ? 'Product B' : '商品 B', price: '150', capacity: '1.5', unit: 'kg' }),
    ];
    this.errors = [];
    this.example = true;
  }
  compare() {
    this.invalidate();
    const result = calculateComparison({ category: this.category, rows: this.rows });
    this.errors = result.ok ? [] : result.errors;
    this.result = result.ok ? result : null;
    this.status = result.ok ? 'success' : 'invalid';
    return result;
  }
  beginCopy() {
    if (!this.result || this.copyBusy) return null;
    this.copyBusy = true;
    this.copyStatus = 'busy';
    this.copyFallback = '';
    this.copyRequestId += 1;
    return Object.freeze({ id: this.copyRequestId, revision: this.revision, result: this.result });
  }
  finishCopy(request, success, text) {
    if (request.id !== this.copyRequestId || request.revision !== this.revision) return false;
    this.copyBusy = false;
    this.copyStatus = success ? 'copied' : 'fallback';
    this.copyFallback = success ? '' : text;
    return true;
  }
}
