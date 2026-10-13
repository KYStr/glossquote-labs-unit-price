export const TEXT = Object.freeze({
  'zh-Hant': Object.freeze({
    product: '商品', name: '名稱（選填）', price: '整組實付價格', capacity: '每包容量', packCount: '包數', unit: '單位',
    remove: '移除商品', piece: '件', pieces: '件', rank: '排名', paid: '整組實付價格', total: '整組總量',
    unitPrice: '單價', lowest: '最低單價', tie: '同價並列', per: '每', countBasis: '每件', example: '範例',
    initial: '加入至少兩個商品，填入整組實付價格、每包容量和包數，再比較單價。資料只留在此頁面。',
    changed: '資料已變更，舊結果已清除；請重新比較。',
    categoryChanged: '類別已更改。容量已清空，請重新輸入此類別的每包容量。',
    exampleStatus: '已載入標示為範例的兩筆資料；按「比較單價」查看結果。',
    success: '已按未四捨五入的單價排序。最低單價以文字和符號標示。',
    invalid: '請修正標示欄位後再比較。所有商品都必須完整有效。', errors: '個欄位或資料錯誤',
    cleared: '已清除。請重新輸入商品資料。', busy: '正在複製結果…', copied: '結果已複製。',
    fallback: '瀏覽器未允許自動複製；請選取下方文字並手動複製。', copy: '複製結果',
    collision: '顯示值已四捨五入；排序依未四捨五入單價。',
    belowPrecision: '非零單價已低於顯示精度。', rowRange: '至少保留 2 個商品，最多 12 個。',
    rowLimit: '已達 12 個商品的上限；可移除商品後再新增。', quantityDecimal: '大於 0，最多 1,000,000；最多三位小數。',
    quantityCount: '1–1,000,000 的整數；每包件數不得有小數。',
    resultSummary: (count, basis) => `${count} 個商品 · ${basis} · 所有價格使用同一幣別`,
    errorsText: (count) => `請修正標示欄位後再比較。${count} 個欄位或資料錯誤；所有商品都必須完整有效。`,
    rowCount: (count) => `${count} / 12 個商品`,
    error: (field, code, category) => {
      const messages = {
        required: '請填寫此欄位。', 'input-too-long': '輸入不能超過 32 個字元；請縮短後再比較。',
        'name-too-long': '名稱最多 80 個字元（emoji 通常佔 2 個）；請縮短名稱。',
        'name-control-character': '名稱不能含換行或控制字元；請移除後再比較。',
        'price-out-of-range': '請輸入 0–9,999,999.99 的整組金額。',
        'capacity-out-of-range': category === 'count' ? '請輸入 1–1,000,000 的整數件數。' : '容量須大於 0 且不超過 1,000,000。',
        'pack-count-out-of-range': '包數須為 1–1000 的整數。', 'invalid-unit': '請選擇目前類別的有效單位。',
      };
      if (code === 'invalid-format') {
        if (field === 'packCount' || (field === 'capacity' && category === 'count')) return '請只輸入 0–9 的整數；不使用正負號、逗號或指數。';
        return `請使用 0–9 數字及句點，最多${field === 'price' ? '兩' : '三'}位小數；不使用正負號、逗號或指數。`;
      }
      return messages[code] || '商品資料格式不符，請清除後重新輸入 2–12 個有效商品。';
    },
  }),
  en: Object.freeze({
    product: 'Product', name: 'Name (optional)', price: 'Total price paid', capacity: 'Size of one pack', packCount: 'Pack count', unit: 'Unit',
    remove: 'Remove product', piece: 'piece', pieces: 'pieces', rank: 'Rank', paid: 'Total price paid', total: 'Total quantity',
    unitPrice: 'Unit price', lowest: 'Lowest unit price', tie: 'Exact tie', per: 'per', countBasis: 'per piece', example: 'Example',
    initial: 'Add at least two products. Enter the total price paid, size of one pack, and pack count, then compare. Your entries stay on this page.',
    changed: 'Inputs changed. The previous result was cleared; compare again.',
    categoryChanged: 'Category changed. Pack sizes were cleared; enter sizes for this category.',
    exampleStatus: 'Example values are loaded. Select “Compare unit prices” to see the result.',
    success: 'Sorted by unrounded unit price. The lowest price is marked with text and a symbol.',
    invalid: 'Correct the marked fields before comparing. Every product must be complete and valid.', errors: 'field or data errors',
    cleared: 'Cleared. Enter product details to start again.', busy: 'Copying results…', copied: 'Results copied.',
    fallback: 'The browser blocked copying. Select the text below and copy it manually.', copy: 'Copy results',
    collision: 'Values are rounded for display; ordering uses the unrounded unit price.',
    belowPrecision: 'The nonzero unit price is below the display precision.', rowRange: 'Keep at least 2 products. You can compare up to 12.',
    rowLimit: 'The 12-product limit is reached. Remove a product to add another.', quantityDecimal: 'Greater than 0, up to 1,000,000; up to three decimal places.',
    quantityCount: 'An integer from 1–1,000,000; no fractional items per pack.',
    resultSummary: (count, basis) => `${count} products · ${basis} · all prices in the same currency`,
    errorsText: (count) => `Correct the marked fields before comparing. ${count} field or data ${count === 1 ? 'error' : 'errors'}; every product must be complete and valid.`,
    rowCount: (count) => `${count} / 12 products`,
    error: (field, code, category) => {
      const messages = {
        required: 'Complete this field.', 'input-too-long': 'Use no more than 32 characters; shorten this entry.',
        'name-too-long': 'Use no more than 80 characters (emoji usually count as 2); shorten the name.',
        'name-control-character': 'Remove line breaks and control characters from the name.',
        'price-out-of-range': 'Enter a total price from 0 to 9,999,999.99.',
        'capacity-out-of-range': category === 'count' ? 'Enter an integer item count from 1 to 1,000,000.' : 'Pack size must be greater than 0 and no more than 1,000,000.',
        'pack-count-out-of-range': 'Enter a whole pack count from 1 to 1000.', 'invalid-unit': 'Select a valid unit for this category.',
      };
      if (code === 'invalid-format') {
        if (field === 'packCount' || (field === 'capacity' && category === 'count')) return 'Use whole 0–9 digits only; no signs, commas, or exponents.';
        return `Use 0–9 digits and a decimal point, with up to ${field === 'price' ? 'two' : 'three'} decimal places; no signs, commas, or exponents.`;
      }
      return messages[code] || 'Product data is not valid. Clear the form and enter 2–12 valid products.';
    },
  }),
});
