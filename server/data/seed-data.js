const vendorNames = [
  'ABC Technologies', 'Ravi Steel & Components', 'Northstar Office Systems',
  'BluePeak Logistics', 'Deccan Industrial Supplies', 'Kaveri Packaging Works',
  'Vertex Safety Solutions', 'Summit IT Services', 'Meghna Facility Partners',
  'Cedarline Networks', 'Aster Components India', 'Orion Print & Media',
  'Sapphire Engineering Co.', 'GreenGrid Utilities', 'Pioneer Workspace Pvt Ltd',
  'Nova Industrial Traders', 'EastGate Distribution', 'Prism Data Systems',
  'Harborline Services', 'Trinity Electricals', 'Apex Mobility Solutions',
  'MetroFab Systems', 'Sunrise Scientific', 'Crestfield Consultants', 'Ironclad Maintenance'
];

const cities = ['Hyderabad', 'Pune', 'Bengaluru', 'Chennai', 'Mumbai', 'Ahmedabad', 'Kochi', 'Delhi'];
const categories = ['IT Equipment', 'Industrial Supplies', 'Logistics', 'Facilities', 'Software', 'Packaging'];

function money(n) { return Math.round(n); }
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d.toISOString().slice(0,10); }
function pad(n) { return String(n).padStart(3,'0'); }

export function buildVendors() {
  return vendorNames.map((name, i) => {
    const isRavi = name === 'Ravi Steel & Components';
    const isAbc = name === 'ABC Technologies';
    const bankLast4 = isRavi ? '4821' : isAbc ? '4821' : String(3000 + i * 137).slice(-4);
    const base = 85000 + (i * 17321) % 420000;
    return {
      id: `V-${pad(i+1)}`,
      name,
      city: cities[i % cities.length],
      category: categories[i % categories.length],
      paymentTerms: i % 3 === 0 ? 'Net 15' : i % 3 === 1 ? 'Net 30' : 'Net 45',
      verifiedBankLast4: bankLast4,
      trust: isRavi ? 90 : isAbc ? 87 : 84 + (i % 10),
      paymentCount: isRavi ? 14 : name === 'Northstar Office Systems' ? 0 : 4 + (i % 9),
      averageInvoice: money(base),
      verifiedContactLast4: isRavi ? '4821' : String(1100 + i * 29).slice(-4)
    };
  });
}

function lineItems(vendor, index) {
  const qty = 5 + ((index * 3) % 18);
  const unit = 4200 + ((index * 137) % 18000);
  return [{ sku: `${vendor.id}-SKU-${index+1}`, description: `${vendor.category} line item`, quantity: qty, unitPrice: unit }];
}

export function buildInvoices(vendors) {
  const invoices = [];
  let seq = 1;
  for (let vIndex = 0; vIndex < vendors.length; vIndex++) {
    const vendor = vendors[vIndex];
    for (let j = 0; j < 4; j++) {
      const specialRavi = vendor.name === 'Ravi Steel & Components' && j === 3;
      const specialAbcException = vendor.name === 'ABC Technologies' && j === 2;
      const specialColdStart = vendor.name === 'Northstar Office Systems' && j === 0;
      const items = lineItems(vendor, j + vIndex);
      let quantity = items[0].quantity;
      let receivedQty = quantity;
      let unitPrice = items[0].unitPrice;
      let invoiceBank = vendor.verifiedBankLast4;
      let scenario = 'routine';
      let status = seq <= 73 ? 'AUTO-APPROVED' : seq <= 91 ? 'PAID' : seq <= 97 ? 'EXCEPTION' : seq <= 99 ? 'HUMAN REVIEW' : 'PAYMENT BLOCKED';

      if (specialAbcException) {
        quantity = 22; receivedQty = 20; unitPrice = 11800; invoiceBank = '4821';
        scenario = 'recurring-exception'; status = 'EXCEPTION';
      }

      if (specialColdStart) {
        scenario = 'cold-start'; status = 'HUMAN REVIEW';
      }

      if (specialRavi) {
        quantity = 100; receivedQty = 100; unitPrice = 8124; invoiceBank = '7719';
        scenario = 'bank-account-surprise'; status = 'PAYMENT BLOCKED';
      }

      const poQuantity = quantity;
      const total = money(quantity * unitPrice * 1.18);
      const invoiceDate = addDays('2026-09-02', (seq * 2) % 25);
      const dueDate = addDays(invoiceDate, vendor.paymentTerms === 'Net 15' ? 15 : vendor.paymentTerms === 'Net 30' ? 30 : 45);
      const duplicate = false;
      invoices.push({
        id: `INV-${String(seq).padStart(6,'0')}`,
        vendorId: vendor.id,
        vendor: vendor.name,
        invoiceNumber: `${vendor.name.slice(0,3).toUpperCase()}-${String(2026)}-${pad(j+1 + vIndex*4)}`,
        po: `PO-${String(7000 + seq)}`,
        invoiceDate,
        dueDate,
        paymentTerms: vendor.paymentTerms,
        category: vendor.category,
        lineItems: [{ ...items[0], quantity, unitPrice }],
        poLineItems: [{ ...items[0], quantity: poQuantity, unitPrice: vendor.name === 'ABC Technologies' && specialAbcException ? 11000 : unitPrice }],
        receivedLineItems: [{ ...items[0], quantity: receivedQty, unitPrice }],
        invoiceQty: quantity,
        poQty: poQuantity,
        receivedQty,
        unitPrice,
        historicalUnitPrice: vendor.averageInvoice / Math.max(1, quantity),
        total,
        bankLast4: invoiceBank,
        knownBankLast4: vendor.verifiedBankLast4,
        priorPaymentCount: scenario === 'bank-account-surprise' ? 14 : vendor.paymentCount,
        vendorTrust: vendor.trust,
        verifiedContactLast4: vendor.verifiedContactLast4,
        newBankVerified: scenario !== 'bank-account-surprise',
        duplicate,
        scenario,
        status,
        source: 'synthetic ERP/AP dataset'
      });
      seq++;
    }
  }

  // Add a clean known-vendor invoice that matches ABC's established history.
  invoices[2] = {
    ...invoices[2],
    id: 'INV-000003', invoiceNumber: 'INV-1084', po: 'PO-4530',
    invoiceQty: 12, poQty: 12, receivedQty: 12, unitPrice: 10950,
    historicalUnitPrice: 11000, total: 129492, bankLast4: '4821', knownBankLast4: '4821',
    scenario: 'learned-vendor', status: 'AUTO-APPROVED'
  };

  // Make the recurring exception use the recognizable invoice from the earlier prototype.
  invoices[6] = {
    ...invoices[6], vendorId: vendors.find(v => v.name === 'ABC Technologies').id,
    vendor: 'ABC Technologies', invoiceNumber: 'INV-1082', po: 'PO-4521',
    invoiceQty: 22, poQty: 20, receivedQty: 20, unitPrice: 11800, historicalUnitPrice: 11000,
    total: 312928, bankLast4: '4821', knownBankLast4: '4821', priorPaymentCount: 11,
    vendorTrust: 87, verifiedContactLast4: '4821', newBankVerified: true,
    lineItems: [{sku:'ABC-CPU-22',description:'Monitors',quantity:22,unitPrice:11800}],
    poLineItems: [{sku:'ABC-CPU-22',description:'Monitors',quantity:20,unitPrice:11000}],
    receivedLineItems: [{sku:'ABC-CPU-22',description:'Monitors',quantity:20,unitPrice:11800}],
    scenario: 'recurring-exception', status: 'EXCEPTION'
  };

  // Make the Ravi bank surprise invoice unmistakable.
  // Make the first Northstar invoice a genuine cold-start case: no historical payment memory.
  const coldIndex = invoices.findIndex(i => i.vendor === 'Northstar Office Systems');
  if (coldIndex >= 0) {
    invoices[coldIndex] = {
      ...invoices[coldIndex],
      invoiceNumber:'NOR-2026-001',
      po:'PO-7009',
      scenario:'cold-start',
      status:'HUMAN REVIEW',
      priorPaymentCount:0,
      vendorTrust:84,
      newBankVerified:false
    };
  }

  const raviIndex = invoices.findIndex(i => i.vendor === 'Ravi Steel & Components');
  invoices[raviIndex] = {
    ...invoices[raviIndex], id:'INV-000008', invoiceNumber:'RS-2026-015', po:'PO-8815',
    invoiceQty:100, poQty:100, receivedQty:100, unitPrice:8124, historicalUnitPrice:8000,
    total:812400, bankLast4:'7719', knownBankLast4:'4821', priorPaymentCount:14,
    vendorTrust:90, verifiedContactLast4:'4821', newBankVerified:false,
    lineItems:[{sku:'RS-STEEL-100',description:'Industrial steel assemblies',quantity:100,unitPrice:8124}],
    poLineItems:[{sku:'RS-STEEL-100',description:'Industrial steel assemblies',quantity:100,unitPrice:8000}],
    receivedLineItems:[{sku:'RS-STEEL-100',description:'Industrial steel assemblies',quantity:100,unitPrice:8124}],
    scenario:'bank-account-surprise', status:'PAYMENT BLOCKED'
  };

  return invoices;
}

export function buildPurchaseOrders(invoices) {
  return invoices.map(inv => ({
    po: inv.po, vendor: inv.vendor, vendorId: inv.vendorId,
    date: inv.invoiceDate, paymentTerms: inv.paymentTerms,
    lineItems: inv.poLineItems, approvedAmount: inv.poLineItems.reduce((s, x) => s + x.quantity * x.unitPrice, 0) * 1.18
  }));
}

export function buildReceipts(invoices) {
  return invoices.map(inv => ({
    receiptId: `GR-${inv.po.slice(3)}`, po: inv.po, vendor: inv.vendor,
    receivedDate: inv.invoiceDate, lineItems: inv.receivedLineItems
  }));
}

export function buildSeedDataset() {
  const vendors = buildVendors();
  const invoices = buildInvoices(vendors);
  return { vendors, invoices, purchaseOrders: buildPurchaseOrders(invoices), receipts: buildReceipts(invoices) };
}

export function buildHindsightMemories(dataset) {
  const items = [];
  for (const v of dataset.vendors) {
    if (v.paymentCount === 0) continue;
    items.push({
      content: `Vendor master baseline: ${v.name} is approved for AP processing. Verified beneficiary bank account ends ${v.verifiedBankLast4}. Payment terms are ${v.paymentTerms}. Average invoice value is approximately ₹${v.averageInvoice.toLocaleString('en-IN')}.`,
      context: 'vendor master / verified supplier record',
      timestamp: '2026-09-02T09:00:00Z',
      metadata: { vendorId: v.id, memoryType: 'vendor-master' }
    });
    items.push({
      content: `${v.name} has completed ${v.paymentCount} successful historical payments with AP. The normal payment pattern uses beneficiary account ending ${v.verifiedBankLast4}.`,
      context: 'AP payment history',
      timestamp: '2026-09-15T09:00:00Z',
      metadata: { vendorId: v.id, memoryType: 'payment-pattern' }
    });
  }

  const abc = dataset.vendors.find(v => v.name === 'ABC Technologies');
  items.push({
    content: 'ABC Technologies had a quantity discrepancy: an invoice listed 22 monitors while the purchase order and goods receipt confirmed 20. AP requested a corrected invoice and the vendor resolved the exception.',
    context: 'AP exception resolution', timestamp:'2026-08-04T10:00:00Z',
    metadata:{vendorId:abc.id,memoryType:'experience'}
  });
  items.push({
    content: 'ABC Technologies normally submits invoices in the ₹1.0L–₹1.35L range under Net 30 terms. Previous exception resolution was to request a corrected invoice rather than escalate immediately.',
    context: 'vendor pattern and resolution', timestamp:'2026-08-19T10:00:00Z',
    metadata:{vendorId:abc.id,memoryType:'observation'}
  });

  const ravi = dataset.vendors.find(v => v.name === 'Ravi Steel & Components');
  for (let i = 1; i <= 14; i++) {
    items.push({
      content: `Ravi Steel & Components received historical payment #${i} through verified beneficiary account ending 4821. No beneficiary change was recorded in these payment events.`,
      context: 'AP payment event', timestamp: `2026-${String(Math.min(9, 1 + Math.floor((i-1)/2))).padStart(2,'0')}-${String(2 + (i*2)%25).padStart(2,'0')}T10:00:00Z`,
      metadata:{vendorId:ravi.id,memoryType:'payment-event',paymentSequence:i}
    });
  }
  items.push({
    content: 'Ravi Steel & Components has a verified AP contact on file. Independent verification should use the existing contact rather than a contact supplied on a new invoice.',
    context:'AP verification control', timestamp:'2026-09-16T10:00:00Z',
    metadata:{vendorId:ravi.id,memoryType:'control'}
  });
  return items;
}
