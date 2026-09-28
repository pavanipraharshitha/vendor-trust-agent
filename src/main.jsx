import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle, ArrowDownRight, ArrowRight, Brain, CheckCircle2, ClipboardCheck,
  Clock3, FileText, LockKeyhole, PhoneCall, Search, ShieldAlert, ShieldCheck,
  Sparkles, XCircle
} from 'lucide-react';
import './styles.css';

const API = 'http://localhost:8787/api';

function money(n) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0
  }).format(Number(n || 0));
}

function statusTone(status = '') {
  if (status.includes('BLOCKED')) return 'danger';
  if (status.includes('APPROVE') || status.includes('PAID') || status.includes('SCHEDULED')) return 'success';
  if (status.includes('EXCEPTION') || status.includes('REVIEW')) return 'neutral';
  return 'neutral';
}

function App() {
  const [tab, setTab] = useState('queue');
  const [data, setData] = useState(null);
  const [health, setHealth] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [activity, setActivity] = useState([]);
  const [running, setRunning] = useState(false);
  const [memoryMode, setMemoryMode] = useState('with');
  const [verification, setVerification] = useState(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void loadData();
    void loadHealth();
  }, []);

  async function loadData() {
    try {
      const r = await fetch(`${API}/data`);
      if (!r.ok) throw new Error(`Data request failed (${r.status})`);
      const j = await r.json();
      setData(j);
      const hero = j.invoices.find(i => i.scenario === 'bank-account-surprise') || j.invoices[0];
      if (hero) await selectInvoice(hero.id);
    } catch (e) {
      setNotice(`LedgerMind data error: ${e.message}`);
    }
  }

  async function loadHealth() {
    try {
      const r = await fetch(`${API}/health`);
      if (!r.ok) throw new Error(`Health request failed (${r.status})`);
      setHealth(await r.json());
    } catch (e) {
      setHealth({ ok: false, hindsightReachable: false, error: e.message });
    }
  }

  async function selectInvoice(id) {
    setSelectedId(id);
    setResult(null);
    setActivity([]);
    setVerification(null);
    try {
      const r = await fetch(`${API}/invoices/${id}`);
      if (!r.ok) throw new Error(`Invoice request failed (${r.status})`);
      setSelected(await r.json());
      setTab('queue');
    } catch (e) {
      setNotice(`Invoice load error: ${e.message}`);
    }
  }

  async function runAgent() {
    if (!selectedId || running) return;
    setRunning(true);
    setResult(null);
    setVerification(null);
    setActivity([]);
    setNotice('');
    try {
      const r = await fetch(`${API}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: selectedId, memoryMode })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Agent request failed (${r.status})`);
      for (const step of j.trace || []) {
        setActivity(a => [...a, step]);
        await new Promise(resolve => setTimeout(resolve, 260));
      }
      setResult(j);
      setNotice(
        j.memorySource === 'hindsight-cloud'
          ? (j.retainCompleted ? 'Hindsight Cloud recall completed; decision event retained.' : 'Hindsight Cloud recall completed.')
          : j.memorySource === 'hindsight-cloud-cold-start'
            ? 'Hindsight Cloud checked: no prior vendor memory found. Bounded autonomy applied.'
            : j.memorySource === 'hindsight-error'
              ? 'Hindsight recall failed; the decision is not presented as memory-assisted.'
              : 'Local memory fallback is active. Connect Hindsight before final judging.'
      );
      await loadHealth();
    } catch (e) {
      setNotice(`Agent error: ${e.message}`);
    } finally {
      setRunning(false);
    }
  }

  async function verifyBank() {
    if (!selectedId || running) return;
    setActivity(a => [...a, 'Starting independent bank verification']);
    try {
      const r = await fetch(`${API}/verify-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: selectedId })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Verification request failed (${r.status})`);
      setVerification(j);
      setActivity(a => [...a, 'Verified contact confirms existing beneficiary', 'Bank-change event retained for audit']);
      setNotice(j.retainSource === 'hindsight-cloud' ? 'Verification event retained in Hindsight Cloud.' : 'Verification event recorded locally.');
      await loadHealth();
    } catch (e) {
      setNotice(`Verification error: ${e.message}`);
    }
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const priority = { 'bank-account-surprise': 0, 'cold-start': 1, 'recurring-exception': 2, 'learned-vendor': 3 };
    return data.invoices
      .filter(i => !q || [i.invoiceNumber, i.vendor, i.po, i.status].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (priority[a.scenario] ?? 9) - (priority[b.scenario] ?? 9) || a.invoiceNumber.localeCompare(b.invoiceNumber));
  }, [data, query]);

  if (!data) return <div className="boot">Loading LedgerMind…</div>;

  const currentStatus = result?.decision?.status || selected?.invoice?.status || '';
  const tone = statusTone(currentStatus);
  const isRavi = selected?.invoice?.scenario === 'bank-account-surprise';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark"><Brain size={20} /></div>
          <div><b>LedgerMind</b><span>AP Agent</span></div>
        </div>
        <div className="nav">
          <Nav id="queue" label="AP Work Queue" icon={FileText} tab={tab} onClick={setTab} />
          <Nav id="agent" label="Agent Run" icon={Sparkles} tab={tab} onClick={setTab} />
          <Nav id="memory" label="Vendor Memory" icon={Brain} tab={tab} onClick={setTab} />
          <Nav id="audit" label="Controls & Audit" icon={ShieldAlert} tab={tab} onClick={setTab} />
        </div>
        <div className="sidebarFoot">
          <div className={health?.hindsightReachable ? 'connect good' : 'connect'}>
            <span className="dot"></span>
            {health?.hindsightReachable ? 'Hindsight Cloud active' : health?.hindsightConfigured ? 'Hindsight configured' : 'Local memory fallback'}
          </div>
          <small>
            {health?.hindsightReachable
              ? `${health.memoryCount ?? 0} memories in ${health.bankId}.`
              : 'Connect Hindsight before the final judging demo.'}
          </small>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">FINANCE OPERATIONS · SYNTHETIC DEMO DATA</div>
            <h1>Accounts Payable Agent</h1>
          </div>
          <div className="topRight">
            <div className="statusPill"><span className="dot"></span> Agent online</div>
            <div className="avatar">NK</div>
          </div>
        </header>

        {notice && <div className="notice"><Sparkles size={14} /><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}

        {tab === 'queue' && (
          <CommandCenter
            data={data}
            filtered={filtered}
            query={query}
            setQuery={setQuery}
            selectedId={selectedId}
            onSelect={selectInvoice}
            selected={selected}
            result={result}
            activity={activity}
            running={running}
            runAgent={runAgent}
            memoryMode={memoryMode}
            setMemoryMode={setMemoryMode}
            isRavi={isRavi}
            verification={verification}
            verifyBank={verifyBank}
            tone={tone}
          />
        )}
        {tab === 'agent' && <AgentView selected={selected} result={result} activity={activity} running={running} runAgent={runAgent} memoryMode={memoryMode} setMemoryMode={setMemoryMode} />}
        {tab === 'memory' && <MemoryView selected={selected} result={result} health={health} />}
        {tab === 'audit' && <AuditView health={health} />}
      </main>
    </div>
  );
}

function Nav({ id, label, icon: Icon, tab, onClick }) {
  return <button className={tab === id ? 'navItem active' : 'navItem'} onClick={() => onClick(id)}><Icon size={17} />{label}</button>;
}

function CommandCenter({ data, filtered, query, setQuery, selectedId, onSelect, selected, result, activity, running, runAgent, memoryMode, setMemoryMode, isRavi, verification, verifyBank, tone }) {
  return <>
    <section className="hero compactHero">
      <div>
        <div className="eyebrow">CONTROLLED AUTONOMY FOR ACCOUNTS PAYABLE</div>
        <h2>Understand. Verify. Remember. Decide.</h2>
        <p>LedgerMind evaluates invoice evidence, reconciles the three-way match, recalls vendor context and produces a controlled AP decision.</p>
      </div>
      <div className="heroKpi">
        <span>Blocked value</span>
        <b>{money(data.kpis.blockedValue)}</b>
        <small>synthetic records</small>
      </div>
    </section>

    <section className="metrics compactMetrics">
      <Metric label="Invoices" value={data.kpis.totalInvoices} sub="synthetic AP dataset" />
      <Metric label="Auto-processed" value={`${data.kpis.autoRate}%`} sub="derived from statuses" />
      <Metric label="Open exceptions" value={data.kpis.exceptions} sub="review + exception" />
      <Metric label="Approved value" value={money(data.kpis.approvedValue)} sub="synthetic records" />
    </section>

    <section className="commandGrid">
      <QueueRail filtered={filtered} query={query} setQuery={setQuery} selectedId={selectedId} onSelect={onSelect} />
      <section className="agentStage">
        {!selected ? <div className="emptyStage"><Sparkles size={24} /><b>Select an invoice</b><span>The agent trace and decision workspace will appear here.</span></div> : <>
          <InvoiceHeader selected={selected} />
          <MatchStrip selected={selected} />
          <InvoiceContext selected={selected} verification={verification} verifyBank={verifyBank} />

          <div className="agentControlBar">
            <div>
              <span className="sectionLabel">MEMORY MODE</span>
              <strong>{memoryMode === 'with' ? 'Hindsight context enabled' : 'Historical memory excluded'}</strong>
            </div>
            <div className="modeAndRun">
              <div className="segmented">
                <button className={memoryMode === 'without' ? 'on' : ''} onClick={() => setMemoryMode('without')}>Without memory</button>
                <button className={memoryMode === 'with' ? 'on' : ''} onClick={() => setMemoryMode('with')}>With Hindsight</button>
              </div>
              <button className="runButton stageRun" disabled={running} onClick={runAgent}><Sparkles size={16} />{running ? 'Agent is reasoning…' : 'Run AP Agent'}</button>
            </div>
          </div>

          <div className="agentFocusGrid">
            <TracePanel activity={activity} running={running} result={result} />
            <Decision result={result} tone={tone} isRavi={isRavi} selected={selected} />
          </div>
        </>}
      </section>
    </section>
  </>;
}

function QueueRail({ filtered, query, setQuery, selectedId, onSelect }) {
  return <aside className="queueRail panel">
    <div className="railHead">
      <div><h3>AP Work Queue</h3><p>100 synthetic invoices</p></div>
    </div>
    <div className="search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search invoice, vendor, PO…" /></div>
    <div className="queueList compactQueue">
      {filtered.slice(0, 12).map(i => <button key={i.id} className={selectedId === i.id ? 'queueRow selected' : 'queueRow'} onClick={() => onSelect(i.id)}>
        <div className="queueIcon"><FileText size={15} /></div>
        <div className="queueInfo"><b>{i.invoiceNumber}</b><span>{i.vendor}</span><small>{i.po}</small></div>
        <div className="queueAmount"><b>{money(i.total)}</b><span className={`mini ${statusTone(i.status)}`}>{i.status}</span></div>
      </button>)}
    </div>
    <div className="railFoot">Synthetic workload · statuses derived from seeded records</div>
  </aside>;
}

function InvoiceHeader({ selected }) {
  const i = selected.invoice;
  return <div className="invoiceHeader">
    <div className="doc"><FileText size={21} /><div><b>{i.invoiceNumber}</b><span>{i.vendor} · {i.po}</span></div></div>
    <div className="headerFacts">
      <div><span>Invoice total</span><b>{money(i.total)}</b></div>
      <div><span>Due date</span><b>{i.dueDate}</b></div>
      <div><span>Terms</span><b>{i.paymentTerms}</b></div>
    </div>
  </div>;
}

function MatchStrip({ selected }) {
  const i = selected.invoice; const p = selected.po; const r = selected.receipt;
  const quantityMatch = i.invoiceQty === i.poQty && i.invoiceQty === i.receivedQty;
  return <div className="matchStrip">
    <div className="stripTitle"><span className="sectionLabel">3-WAY MATCH</span><small>Invoice ↔ PO ↔ Receipt</small></div>
    <MatchCard label="Invoice" qty={i.invoiceQty} value={i.unitPrice} />
    <MatchCard label="PO" qty={i.poQty} value={p.lineItems[0].unitPrice} />
    <MatchCard label="Received" qty={i.receivedQty} value={r.lineItems[0].unitPrice} />
    <div className={quantityMatch ? 'matchState good' : 'matchState bad'}>{quantityMatch ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{quantityMatch ? 'Matched' : 'Mismatch'}</div>
  </div>;
}

function InvoiceContext({ selected, verification, verifyBank }) {
  const i = selected.invoice; const v = selected.vendor;
  if (i.scenario === 'cold-start') {
    return <div className="coldContext"><div><span className="contextIcon"><Brain size={16} /></span><div><b>Cold-start vendor</b><span>No prior AP payment history is available for this supplier. The agent must stay within bounded autonomy.</span></div></div><span className="contextAction">Human verification required</span></div>;
  }
  if (i.scenario === 'bank-account-surprise') {
    return <>
      <div className="bankContext">
        <div className="bankTitle"><span className="riskIcon"><ShieldAlert size={17} /></span><div><b>Unexpected beneficiary change</b><span>Historical beneficiary ••••{v.verifiedBankLast4} · current invoice ••••{i.bankLast4}</span></div></div>
        <div className="bankFacts"><div><span>Prior payments</span><b>{i.priorPaymentCount}</b></div><div><span>Trust</span><b>90% <ArrowRight size={12} /> 30%</b></div></div>
        <button className="verifyButton" onClick={verifyBank}><PhoneCall size={13} /> Verify using trusted contact</button>
      </div>
      {verification && <div className="verifiedBanner"><ShieldCheck size={16} /><div><b>Independent verification complete</b><span>{verification.message}</span></div></div>}
    </>;
  }
  return null;
}

function TracePanel({ activity, running, result }) {
  return <section className="tracePanel focusPanel">
    <div className="focusHead"><div><span className="sectionLabel">AGENT TRACE</span><h3>Live execution path</h3></div><span className="traceState">{running ? 'RUNNING' : result ? 'COMPLETE' : 'READY'}</span></div>
    {activity.length === 0 ? <div className="empty compact"><Sparkles size={21} /><b>{running ? 'Agent is reasoning…' : 'Ready to run'}</b><span>Watch invoice checks, Hindsight recall and the controlled decision happen in sequence.</span></div> : <div className="traceList">{activity.map((s, i) => <div className="activityRow" key={`${s}-${i}`}><span className="traceIndex">{String(i + 1).padStart(2, '0')}</span><span className="check"><CheckCircle2 size={14} /></span><span className="traceText">{s}</span><small>{((i + 1) * 0.31).toFixed(2)}s</small></div>)}</div>}
  </section>;
}

function Decision({ result, tone, isRavi, selected }) {
  return <section className="decision focusPanel">
    <div className="focusHead"><div><span className="sectionLabel">AGENT DECISION</span><h3>Controlled outcome</h3></div>{result && <span className={`decisionPill ${tone}`}>{result.decision.status}</span>}</div>
    {!result ? <div className="empty compact"><ClipboardCheck size={21} /><b>Decision pending</b><span>Run the agent to evaluate the selected invoice.</span></div> : <DecisionBody result={result} isRavi={isRavi} selected={selected} />}
  </section>;
}

function DecisionBody({ result, isRavi, selected }) {
  const d = result.decision;
  return <>
    <div className="decisionTop"><div><span>STATUS</span><b className={`decisionStatus ${statusTone(d.status)}`}>{d.status}</b></div><div className="confidence"><b>{d.confidence}%</b><span>decision confidence</span></div></div>
    {isRavi && d.trust && <div className="trustBox cleanTrust"><div><span>VENDOR TRUST</span><b>{d.trust.before}% <ArrowRight size={14} /> {d.trust.after}%</b></div><p>{d.trust.reason || 'Current evidence did not reduce trust.'}</p></div>}
    <div className="flags">{d.flags.map(f => <div key={f.code} className={`flag ${f.severity}`}><AlertTriangle size={14} /><div><b>{f.label}</b><span>{f.detail}</span></div></div>)}</div>
    <div className="why"><span>RECOMMENDED ACTION</span><p>{d.recommendation}</p></div>
    {result.evidence && <div className="evidenceRow"><span><Brain size={13} /> {result.evidence.memoryCount} focused memories</span><span><ClipboardCheck size={13} /> {result.evidence.source}</span><span><CheckCircle2 size={13} /> 3-way {result.evidence.threeWayMatch ? 'match' : 'mismatch'}</span></div>}
    {selected?.invoice?.scenario === 'bank-account-surprise' && d.status === 'PAYMENT BLOCKED' && <div className="decisionGuard"><ShieldAlert size={14} /><div><b>Payment hold</b><span>Release only after independent beneficiary verification.</span></div></div>}
  </>;
}

function AgentView({ selected, result, activity, running, runAgent, memoryMode, setMemoryMode }) {
  if (!selected) return <section className="singlePanel"><div className="emptyStage"><Sparkles size={24} /><b>Select an invoice</b><span>Choose a work-queue item first.</span></div></section>;
  return <section className="singlePanel">
    <div className="panelHead"><div><h3>Agent Run Console</h3><p>Decision trace plus actual Hindsight evidence.</p></div><span className="tag">TRACEABLE</span></div>
    <div className="consoleHero"><div className="agentMark"><Brain size={27} /></div><div><b>{selected.invoice.invoiceNumber}</b><span>{selected.invoice.vendor} · {selected.invoice.po}</span></div><div className="route">Invoice → PO → Receipt → Hindsight → Risk → Decision</div></div>
    <div className="compareLarge"><button className={memoryMode === 'without' ? 'choice active' : 'choice'} onClick={() => setMemoryMode('without')}><span>WITHOUT MEMORY</span><b>Current records only</b></button><ArrowRight size={20} /><button className={memoryMode === 'with' ? 'choice active' : 'choice'} onClick={() => setMemoryMode('with')}><span>WITH HINDSIGHT</span><b>Persistent vendor context</b></button><button className="runSmall" disabled={running} onClick={runAgent}>{running ? 'Running…' : 'Run comparison'}</button></div>
    <div className="agentColumns">
      <div className="tracePanel"><h4>Live trace</h4>{activity.length === 0 ? <div className="empty"><Sparkles size={20} /><b>Run the agent</b><span>The trace will show recall before the decision and retain after it.</span></div> : activity.map((x, i) => <div className="traceLine" key={i}><span>{String(i + 1).padStart(2, '0')}</span><b>{x}</b><CheckCircle2 size={14} /></div>)}</div>
      <div className="memoryEvidence"><h4>Memory evidence</h4><div className="memoryCall"><span>RECALL QUERY · FOCUSED CONTEXT</span><p>{result?.recallQuery || 'Run the agent with Hindsight to populate the recall query.'}</p></div>{result?.memories?.slice(0, 4).map((m, i) => <div className="memorySnippet" key={i}><Brain size={14} /><div><span>{(m.type || 'memory').toUpperCase()}</span><p>{m.text}</p></div></div>)}{result?.retainSource === 'hindsight-cloud' && <div className="retainGood"><CheckCircle2 size={14} /> Decision retained to Hindsight Cloud</div>}</div>
    </div>
  </section>;
}

function MemoryView({ selected, result, health }) {
  const vendor = selected?.vendor;
  const ravi = selected?.invoice?.scenario === 'bank-account-surprise';
  return <section className="singlePanel"><div className="panelHead"><div><h3>Vendor Memory</h3><p>Operational context recalled by the AP agent.</p></div><span className="tag">{health?.hindsightReachable ? 'HINDSIGHT CLOUD' : 'LOCAL FALLBACK'}</span></div>
    <div className="memoryBanner"><div className="memoryTitle"><Brain size={18} /><div><b>{vendor?.name || 'Vendor memory'}</b><span>Memory is scoped to the AP bank and reused across invoice decisions.</span></div></div><div className="memoryCount"><b>{health?.memoryCount ?? '—'}</b><span>memory records</span></div></div>
    {ravi && <div className="beneficiaryPanel"><div className="subHead"><span>BENEFICIARY HISTORY</span><small>Historical evidence used in the bank-change decision</small></div><div className="bankTimeline"><div className="bankHist"><span>Historical</span><b>••••4821</b><small>14 successful payments · no prior change</small></div><ArrowDownRight size={16} /><div className="bankHist warning"><span>Current invoice</span><b>••••7719</b><small>First change · not independently verified</small></div></div></div>}
    <div className="memoryCards">{(result?.memories?.length ? result.memories : localMemoryPreview(selected?.invoice?.vendor)).slice(0, 6).map((m, i) => <div className="memoryCard" key={i}><div className="memDot"></div><div><span>{(m.type || 'memory').toUpperCase()}</span><p>{m.text}</p></div></div>)}</div>
  </section>;
}

function localMemoryPreview(vendor) {
  if (vendor === 'Ravi Steel & Components') return [
    { type: 'world', text: 'Verified beneficiary account ends 4821.' },
    { type: 'experience', text: '14 historical successful AP payments used beneficiary account ending 4821 with no recorded beneficiary changes.' },
    { type: 'control', text: 'Independent bank verification should use the existing vendor contact on file.' }
  ];
  return [{ type: 'experience', text: 'Vendor has prior successful AP activity.' }, { type: 'observation', text: 'Payment terms and recurring invoice patterns are stored as operational context.' }];
}

function AuditView({ health }) {
  const [audit, setAudit] = useState([]);
  useEffect(() => { fetch(`${API}/audit`).then(r => r.json()).then(setAudit).catch(() => setAudit([])); }, []);
  return <section className="singlePanel"><div className="panelHead"><div><h3>Controls & Audit</h3><p>Autonomy is bounded by explicit finance controls.</p></div><span className="tag">{health?.hindsightReachable ? 'MEMORY + AUDIT' : 'AUDIT READY'}</span></div>
    <div className="controlsGrid"><Control title="3-way match" icon={ClipboardCheck} detail="Invoice quantity and value reconcile against the purchase order and goods receipt." /><Control title="Beneficiary change hold" icon={ShieldAlert} detail="Unexpected account changes require independent verification before payment." /><Control title="Duplicate check" icon={FileText} detail="Vendor, PO and amount similarity creates a payment review signal." /><Control title="Human approval" icon={LockKeyhole} detail="New vendors and policy exceptions remain gated by finance users." /><Control title="Least authority" icon={ShieldCheck} detail="High-risk payment execution stays blocked until verification." /><Control title="Audit trail" icon={ClipboardCheck} detail="Agent decisions and verification events are recorded for traceability." /></div>
    <div className="auditLog"><div className="subHead"><span>LATEST EVENTS</span><small>{audit.length} stored events</small></div>{audit.length === 0 ? <div className="empty compact"><Clock3 size={19} /><b>No events yet</b><span>Run an invoice decision to populate the audit trail.</span></div> : audit.slice(0, 12).map((a, i) => <div className="auditRow" key={i}><span>{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><b>{a.action}</b><small>{a.vendor} · {a.invoiceId} · {a.status} · {a.source}</small></div>)}</div>
  </section>;
}

function Control({ title, icon: Icon, detail }) { return <div className="control"><div className="controlIcon"><Icon size={16} /></div><div><b>{title}</b><p>{detail}</p></div><CheckCircle2 size={16} /></div>; }
function Metric({ label, value, sub }) { return <div className="metric"><span>{label}</span><b>{value}</b><small>{sub}</small></div>; }
function MatchCard({ label, qty, value }) { return <div className="matchCard"><span>{label}</span><b>{qty} units</b><small>{money(value)} / unit</small></div>; }

createRoot(document.getElementById('root')).render(<App />);
