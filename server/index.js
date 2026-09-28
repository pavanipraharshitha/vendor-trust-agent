import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HindsightClient } from '@vectorize-io/hindsight-client';
import { buildSeedDataset, buildHindsightMemories } from './data/seed-data.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 8787);
const BANK_ID = process.env.HINDSIGHT_BANK_ID || 'LedgerMind AP Memory';
const HINDSIGHT_URL = process.env.HINDSIGHT_BASE_URL || 'https://api.hindsight.vectorize.io';
const HINDSIGHT_API_KEY = process.env.HINDSIGHT_API_KEY || '';
const hindsight = HINDSIGHT_API_KEY ? new HindsightClient({ baseUrl: HINDSIGHT_URL, apiKey: HINDSIGHT_API_KEY }) : null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = path.join(__dirname, 'data', 'store.json');

let dataset = buildSeedDataset();

async function readStore() {
  try { return JSON.parse(await fs.readFile(storePath, 'utf8')); }
  catch { return { audit: [], decisions: {} }; }
}
async function writeStore(store) { await fs.writeFile(storePath, JSON.stringify(store, null, 2), 'utf8'); }
function money(n) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n); }
function nowIso() { return new Date().toISOString(); }
function vendorByName(name) { return dataset.vendors.find(v => v.name === name); }

async function recallVendorMemory(invoice) {
  const vendor = vendorByName(invoice.vendor);
  // True cold-start: do not substitute generic memories for a vendor with no prior AP history.
  if (!vendor || (vendor.paymentCount ?? 0) === 0) {
    return { memories: [], source: hindsight ? 'hindsight-cloud-cold-start' : 'local-fallback', query: '', recalledCount: 0, retrievedCount: 0 };
  }
  if (!hindsight) return { memories: [], source: 'local-fallback', query: '', recalledCount: 0, retrievedCount: 0 };
  const query = `For AP vendor ${invoice.vendor}, answer only from historical vendor context relevant to today's invoice ${invoice.invoiceNumber}: what verified beneficiary account was used previously, how many successful payments were completed, payment terms, and any prior AP exceptions or resolutions? Ignore the current invoice's decision or verification event.`;
  try {
    const result = await hindsight.recall(BANK_ID, query, {
      maxTokens: 2000,
      budget: 'low'
    });
    const vendorNameLower = invoice.vendor.toLowerCase();
    const rawMemories = (result.results || [])
      .map(r => ({ text: r.text || r.content || '', type: r.type || 'memory' }))
      .filter(m => m.text && m.text.toLowerCase().includes(vendorNameLower))
      .filter(m => !m.text.includes(invoice.invoiceNumber));

    // Hindsight ranks results; LedgerMind deliberately uses only a small, focused evidence set.
    const memories = rawMemories.slice(0, 4);
    return { memories, source: 'hindsight-cloud', query, recalledCount: memories.length, retrievedCount: rawMemories.length };
  } catch (error) {
    console.error('Hindsight recall failed:', error.message);
    return { memories: [], source: 'hindsight-error', query, error: error.message, recalledCount: 0, retrievedCount: 0 };
  }
}

function localMemory(invoice) {
  const vendor = vendorByName(invoice.vendor);
  if (!vendor) return [];
  const base = [
    {type:'world', text:`${vendor.name} has a verified beneficiary account ending ${vendor.verifiedBankLast4}.`},
    {type:'experience', text:`${vendor.name} has completed ${vendor.paymentCount} historical successful AP payments using its established beneficiary account.`},
    {type:'observation', text:`${vendor.name} uses ${vendor.paymentTerms} terms and typically invoices around ${money(vendor.averageInvoice)}.`}
  ];
  if (vendor.name === 'Ravi Steel & Components') {
    base.push({type:'experience', text:'Ravi Steel & Components completed 14 historical payments to account ending 4821 with no beneficiary changes.'});
    base.push({type:'world', text:'Ravi Steel & Components has a verified AP contact on file for independent bank verification.'});
  }
  if (vendor.name === 'ABC Technologies') {
    base.push({type:'experience', text:'ABC Technologies previously had a quantity discrepancy where 22 monitors were invoiced against 20 ordered/received; AP requested a corrected invoice and the vendor resolved it.'});
  }
  return base;
}

function evaluate(invoice, memories, useMemory) {
  const vendor = vendorByName(invoice.vendor);
  const memoryText = memories.map(m => m.text).join(' ');
  const rememberedPaymentMatch = memoryText.match(/(\d+) (?:successful )?historical payments/i) || memoryText.match(/(\d+) successful payments/i);
  const rememberedPaymentCount = rememberedPaymentMatch ? Number(rememberedPaymentMatch[1]) : 0;
  const quantityMismatch = invoice.invoiceQty !== invoice.receivedQty || invoice.invoiceQty !== invoice.poQty;
  const bankChanged = invoice.bankLast4 !== invoice.knownBankLast4;
  const priorPayments = useMemory ? (rememberedPaymentCount || invoice.priorPaymentCount || 0) : 0;
  const firstBankChange = bankChanged && priorPayments >= 10;
  const newBankVerified = Boolean(invoice.newBankVerified);
  const duplicate = Boolean(invoice.duplicate);
  const benchmarkAvailable = Boolean(useMemory && memories.length && (vendor?.paymentCount ?? 0) > 0 && invoice.historicalUnitPrice);
  const priceVariance = benchmarkAvailable ? ((invoice.unitPrice - invoice.historicalUnitPrice) / invoice.historicalUnitPrice) * 100 : 0;
  const recurringException = invoice.vendor === 'ABC Technologies' && quantityMismatch && /corrected invoice|quantity discrepancy/i.test(memoryText);

  const flags = [];
  if (quantityMismatch) flags.push({code:'QTY',label:'3-way match mismatch',severity:'high',detail:`Invoice ${invoice.invoiceQty} vs PO ${invoice.poQty} vs receipt ${invoice.receivedQty}`});
  if (benchmarkAvailable && Math.abs(priceVariance) >= 15) flags.push({code:'PRICE',label:'Price anomaly',severity:'medium',detail:`${priceVariance.toFixed(0)}% vs historical unit price`});
  if (bankChanged) flags.push({code:'BANK',label:'Beneficiary account changed',severity:'critical',detail:`Verified ••••${invoice.knownBankLast4} → invoice ••••${invoice.bankLast4}`});
  if (firstBankChange) flags.push({code:'FIRST_BANK',label:'First beneficiary change in payment history',severity:'critical',detail:`${priorPayments} previous payments used ••••${invoice.knownBankLast4}`});
  if (bankChanged && !newBankVerified) flags.push({code:'UNVERIFIED_BANK',label:'New beneficiary not independently verified',severity:'critical',detail:`••••${invoice.bankLast4} has no verified payment history`});
  if (duplicate) flags.push({code:'DUP',label:'Possible duplicate',severity:'critical',detail:'Vendor, PO and amount similarity requires review'});

  let status = 'AUTO-APPROVE';
  let confidence = 95;
  if (useMemory && (vendor?.paymentCount ?? 0) === 0) {
    status='HUMAN REVIEW';
    confidence=61;
  }
  let trust = vendor?.trust ?? 80;
  let trustBefore = trust, trustAfter = trust;

  if (!useMemory) {
    if (bankChanged) { status='HUMAN REVIEW'; confidence=72; }
    if (quantityMismatch) { status='HUMAN REVIEW'; confidence=Math.min(confidence,68); }
    if (duplicate) { status='HUMAN REVIEW'; confidence=Math.min(confidence,65); }
    return {
      status, confidence,
      trust: null,
      flags,
      recommendation: bankChanged ? 'Hold payment for human verification. No long-term payment pattern was used in this comparison.' : quantityMismatch ? 'Route to AP review because the current invoice does not reconcile cleanly.' : ((vendor?.paymentCount ?? 0) === 0 ? 'No prior vendor history is available. Complete first-vendor verification before automatic payment.' : 'Current invoice controls pass; this comparison intentionally ignores long-term memory.'),
      verification: bankChanged ? {required:true, verified:false, contactLast4:invoice.verifiedContactLast4 || vendor?.verifiedContactLast4 || '0000'} : null,
      evidence:{memoryUsed:false, memoryCount:0, threeWayMatch:!quantityMismatch, beneficiaryChange:bankChanged, duplicate, priorPayments:null, source:'current invoice + vendor master only'},
      metrics:{amount:money(invoice.total),priceVariance:Number(priceVariance.toFixed(1)),memoryHits:0,priorPayments:null}
    };
  }

  if (firstBankChange && !newBankVerified) {
    trustBefore = 90;
    trustAfter = 30;
    trust = trustAfter;
    status='PAYMENT BLOCKED';
    confidence=99;
  } else if (bankChanged && !newBankVerified) {
    status='PAYMENT BLOCKED'; confidence=98;
  } else if (quantityMismatch) {
    status='EXCEPTION'; confidence=92;
  } else if (Math.abs(priceVariance) >= 15) {
    status='EXCEPTION'; confidence=78;
  } else if (duplicate) {
    status='PAYMENT BLOCKED'; confidence=98;
  }

  let recommendation='Invoice matches current controls and the vendor’s established history. Schedule payment.';
  if (firstBankChange && !newBankVerified) recommendation=`Hold payment. This is the first beneficiary change after ${priorPayments} successful payments to ••••${invoice.knownBankLast4}. Independently verify the new account using the vendor contact already on file.`;
  else if (recurringException) recommendation='Historical memory shows this vendor resolved the same quantity discrepancy by issuing a corrected invoice. Request correction instead of escalating immediately.';
  else if (quantityMismatch) recommendation='Request a corrected invoice or receiving confirmation before payment.';
  else if (bankChanged) recommendation='Block payment and require independent bank-detail verification.';
  else if (duplicate) recommendation='Hold payment and route to AP duplicate-review workflow.';

  return {
    status, confidence,
    trust: firstBankChange && !newBankVerified ? {before:trustBefore,after:trustAfter,reason:`First beneficiary change after ${priorPayments} successful payments; new account is not independently verified.`} : {before:trustBefore,after:trustAfter,reason:null},
    flags,
    recommendation,
    verification: firstBankChange && !newBankVerified ? {required:true,verified:false,contactLast4:invoice.verifiedContactLast4 || vendor?.verifiedContactLast4 || '0000'} : null,
    evidence:{memoryUsed:true,memoryCount:memories.length,threeWayMatch:!quantityMismatch,beneficiaryChange:bankChanged,duplicate,priorPayments,source:'Hindsight recall + current AP controls'},
    metrics:{amount:money(invoice.total),priceVariance:Number(priceVariance.toFixed(1)),memoryHits:memories.length,priorPayments}
  };
}

async function retainEvent(content, context, metadata={}) {
  if (!hindsight) return {ok:false,source:'local-fallback'};
  try { await hindsight.retain(BANK_ID, content, {context, timestamp:new Date(), metadata}); return {ok:true,source:'hindsight-cloud'}; }
  catch (error) { console.error('Hindsight retain failed:', error.message); return {ok:false,source:'hindsight-error',error:error.message}; }
}

app.get('/api/health', async (req,res) => {
  const status = { ok:true, hindsightConfigured:Boolean(hindsight), bankId:BANK_ID, memoryMode:hindsight?'hindsight-cloud':'local-fallback' };
  if (hindsight) {
    try { const r = await hindsight.listMemories(BANK_ID,{limit:1,offset:0}); status.hindsightReachable=true; status.memoryCount=r.total ?? r.items?.length ?? 0; }
    catch { status.hindsightReachable=false; }
  }
  res.json(status);
});

app.get('/api/data', (req,res) => {
  const inbox = dataset.invoices.map(i => ({
    id:i.id, invoiceNumber:i.invoiceNumber, vendor:i.vendor, po:i.po, total:i.total,
    dueDate:i.dueDate, paymentTerms:i.paymentTerms, status:i.status, scenario:i.scenario,
    bankLast4:i.bankLast4, knownBankLast4:i.knownBankLast4
  }));
  const blockedValue = dataset.invoices.filter(i=>i.status==='PAYMENT BLOCKED').reduce((s,i)=>s+i.total,0);
  const auto = dataset.invoices.filter(i=>i.status==='AUTO-APPROVED').length;
  const exceptions = dataset.invoices.filter(i=>['EXCEPTION','HUMAN REVIEW'].includes(i.status)).length;
  const approvedValue = dataset.invoices.filter(i=>['AUTO-APPROVED','PAID'].includes(i.status)).reduce((s,i)=>s+i.total,0);
  res.json({ vendors:dataset.vendors, invoices:inbox, kpis:{totalInvoices:dataset.invoices.length,autoRate:Math.round(auto/dataset.invoices.length*100),exceptions,blockedValue,approvedValue}, generatedAt:'2026-09-28', dataLabel:'Synthetic AP dataset' });
});

app.get('/api/invoices/:id', (req,res) => {
  const invoice = dataset.invoices.find(i=>i.id===req.params.id);
  if (!invoice) return res.status(404).json({error:'invoice not found'});
  const po = dataset.purchaseOrders.find(p=>p.po===invoice.po);
  const receipt = dataset.receipts.find(r=>r.po===invoice.po);
  const vendor = vendorByName(invoice.vendor);
  res.json({invoice,po,receipt,vendor});
});

app.post('/api/agent/run', async (req,res) => {
  const {invoiceId, memoryMode='with'} = req.body || {};
  const invoice = dataset.invoices.find(i=>i.id===invoiceId);
  if (!invoice) return res.status(404).json({error:'invoice not found'});
  const useMemory = memoryMode === 'with';
  let memories=[]; let source='local-fallback'; let query=''; let recallError=null; let recalledCount=0; let retrievedCount=0;
  if (useMemory && hindsight) {
    const recalled = await recallVendorMemory(invoice);
    memories = recalled.memories; source = recalled.source; query = recalled.query; recallError = recalled.error || null; recalledCount = recalled.recalledCount || 0; retrievedCount = recalled.retrievedCount || recalled.recalledCount || 0;
  }
  // Only use local preview memory when Hindsight is not configured.
  // When Hindsight is active and returns zero vendor memories, preserve the truth: this is a cold-start or an unobserved vendor.
  if (useMemory && !memories.length && !hindsight) {
    const vendor = vendorByName(invoice.vendor);
    if ((vendor?.paymentCount ?? 0) > 0) {
      memories=localMemory(invoice);
      source='local-fallback';
    }
  }

  const decision = evaluate(invoice,memories,useMemory);
  const trace = [
    'Reading invoice fields',
    `Finding purchase order ${invoice.po}`,
    'Running 3-way match',
    useMemory ? `Recalling vendor history${source==='hindsight-cloud'?' from Hindsight Cloud':''}` : 'Skipping long-term memory',
    invoice.vendor === 'Ravi Steel & Components' && useMemory ? `Comparing beneficiary with ${invoice.priorPaymentCount} prior payments` : 'Checking duplicate and beneficiary signals',
    useMemory && decision.evidence.memoryCount ? `Using ${decision.evidence.memoryCount} focused historical memories as decision context` : (useMemory ? 'No prior vendor memory found; applying bounded autonomy' : 'Generating decision from current records'),
    `Generating controlled AP decision: ${decision.status}`
  ];

  const store=await readStore();
  const meaningfulLearning = useMemory && ['PAYMENT BLOCKED','EXCEPTION','HUMAN REVIEW'].includes(decision.status);
  const alreadyRetained = store.audit.some(a => a.action === 'AGENT_MEMORY_RETAINED' && a.invoiceId === invoice.id);
  let retain = {ok:false,source:hindsight ? 'not-needed' : 'local-fallback'};
  if (meaningfulLearning && !alreadyRetained) {
    retain = await retainEvent(
      `AP learning event: ${invoice.vendor}, ${invoice.invoiceNumber}. Decision ${decision.status}. Amount ${money(invoice.total)}. Historical context used: ${memories.map(m=>m.text).join(' | ')}. Evidence: ${decision.flags.map(f=>f.label).join(', ') || 'all controls passed'}.`,
      'Accounts Payable agent learning event',
      {invoiceId:invoice.id,vendorId:invoice.vendorId,status:decision.status,kind:'meaningful-learning'}
    );
    if (retain.ok) {
      store.audit.unshift({at:nowIso(),action:'AGENT_MEMORY_RETAINED',invoiceId:invoice.id,vendor:invoice.vendor,status:'LEARNING_RETAINED',source:retain.source});
    }
  }

  store.decisions[invoice.id]={at:nowIso(),memoryMode,decision};
  store.audit.unshift({at:nowIso(),action:'AGENT_DECISION',invoiceId:invoice.id,vendor:invoice.vendor,status:decision.status,source});
  store.audit=store.audit.slice(0,100);
  await writeStore(store);
  res.json({invoice,decision,memories,memorySource:source,recallQuery:query,recallError,recalledCount,retrievedCount,retainSource:retain.source,retainCompleted:Boolean(retain.ok),trace});
});

app.post('/api/verify-bank', async (req,res) => {
  const {invoiceId}=req.body || {};
  const invoice=dataset.invoices.find(i=>i.id===invoiceId);
  if (!invoice) return res.status(404).json({error:'invoice not found'});
  const verification={
    simulated:true,
    authorized:false,
    vendor:invoice.vendor,
    contactLast4:invoice.verifiedContactLast4,
    expectedBankLast4:invoice.knownBankLast4,
    newBankLast4:invoice.bankLast4,
    message:`Synthetic vendor verification: the verified contact confirms that account ••••${invoice.knownBankLast4} remains the authorized beneficiary. The new account ••••${invoice.bankLast4} is not authorized.`
  };
  const store=await readStore();
  const alreadyVerified = store.audit.some(a => a.action === 'BANK_VERIFICATION' && a.invoiceId === invoice.id);
  let retain = {ok:false,source:hindsight ? 'not-needed' : 'local-fallback'};
  if (!alreadyVerified) {
    retain=await retainEvent(
      `Bank verification event for ${invoice.vendor}, invoice ${invoice.invoiceNumber}: verified contact confirmed beneficiary ••••${invoice.knownBankLast4}; invoice supplied unverified account ••••${invoice.bankLast4}.`,
      'AP bank-detail verification',
      {invoiceId:invoice.id,verification:'unauthorized-change',kind:'verification'}
    );
    store.audit.unshift({at:nowIso(),action:'BANK_VERIFICATION',invoiceId:invoice.id,vendor:invoice.vendor,status:'UNAUTHORIZED_CHANGE',source:retain.source});
  }
  store.audit=store.audit.slice(0,100);
  await writeStore(store);
  res.json({...verification,retainSource:retain.source});
});

app.get('/api/audit', async (req,res) => {
  const store=await readStore();
  res.json(store.audit || []);
});

app.listen(PORT,()=>console.log(`LedgerMind AP server running on http://localhost:${PORT}`));
