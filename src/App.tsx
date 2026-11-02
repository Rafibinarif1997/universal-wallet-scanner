import { useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, Blocks, CheckCircle2, CircleAlert, Coins, Copy, ExternalLink, Image, LoaderCircle, Search, ShieldCheck, Wallet, Zap } from 'lucide-react';

type Asset = { chain: string; chainName: string; type: 'token' | 'nft'; name: string; symbol?: string; contract: string; balance: string; tokenId?: string; image?: string; price?: number; value?: number; priceStatus: 'priced' | 'unpriced' };
type ChainResult = { chain: string; chainName: string; status: 'complete' | 'partial' | 'failed'; error?: string; tokenCount: number; nftCount: number };
type ScanResult = { address: string; assets: Asset[]; chains: ChainResult[]; scannedAt: string; note: string };

const short = (s: string) => s ? s.slice(0, 6) + '…' + s.slice(-4) : '—';
const money = (n?: number) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const number = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : s; };

export default function App() {
  const [address, setAddress] = useState('');
  const [tab, setTab] = useState<'all' | 'token' | 'nft'>('all');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const valid = /^0x[a-fA-F0-9]{40}$/.test(address.trim());
  const assets = useMemo(() => (result?.assets ?? []).filter(a => (tab === 'all' || a.type === tab) && (a.name + ' ' + (a.symbol ?? '') + ' ' + a.contract + ' ' + a.chainName).toLowerCase().includes(query.toLowerCase())), [result, tab, query]);
  const tokens = result?.assets.filter(a => a.type === 'token') ?? [];
  const nfts = result?.assets.filter(a => a.type === 'nft') ?? [];
  const total = tokens.reduce((s, a) => s + (a.value ?? 0), 0) + nfts.reduce((s, a) => s + (a.value ?? 0), 0);
  const priced = result?.assets.filter(a => a.priceStatus === 'priced').length ?? 0;

  async function scan() {
    if (!valid) { setError('Enter a valid 0x EVM wallet address.'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!url || !anon) throw new Error('Backend is not configured yet. Add Supabase URL and anon key after deploying the scan-wallet Edge Function. See README.');
      const response = await fetch(url.replace(/\/$/, '') + '/functions/v1/scan-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: 'Bearer ' + anon },
        body: JSON.stringify({ address: address.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Scan request failed.');
      setResult(data as ScanResult);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unexpected scan error.'); }
    finally { setBusy(false); }
  }

  function exportCsv() {
    if (!result) return;
    const rows = [['type','chain','name','symbol','contract','token_id','balance','price_usd','value_usd','price_status'], ...result.assets.map(a => [a.type,a.chainName,a.name,a.symbol ?? '',a.contract,a.tokenId ?? '',a.balance,a.price ?? '',a.value ?? '',a.priceStatus])];
    const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'uwas-' + result.address.slice(0, 8) + '.csv'; link.click(); URL.revokeObjectURL(link.href);
  }

  async function copyAddress() { if (!result) return; await navigator.clipboard.writeText(result.address); setCopied(true); setTimeout(() => setCopied(false), 1400); }

  return <main className="shell">
    <nav className="nav"><a className="brand" href="#"><span className="brand-mark"><Blocks size={19}/></span><span>UWAS<span className="brand-dot">.</span></span></a><div className="nav-right"><span className="live-dot"/> EVM ASSET INTELLIGENCE <span className="version">BETA 0.1</span></div></nav>
    <section className="hero">
      <div className="eyebrow"><span className="eyebrow-line"/> UNIVERSAL WALLET ASSET SCANNER</div>
      <h1>Every asset.<br/><em>One address.</em></h1>
      <p className="hero-copy">Explore tokens and NFTs across supported EVM networks. Paste a public wallet address to discover its on-chain portfolio.</p>
      <div className="search-panel">
        <div className="input-wrap"><Wallet size={19}/><input value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => e.key === 'Enter' && scan()} placeholder="Paste an EVM wallet address (0x…)" spellCheck={false}/>{address && <button className="clear" onClick={() => setAddress('')} aria-label="Clear">×</button>}</div>
        <button className="scan-btn" onClick={scan} disabled={busy || !valid}>{busy ? <><LoaderCircle className="spin" size={17}/> Scanning</> : <>Scan wallet <ArrowRight size={17}/></>}</button>
      </div>
      <div className="privacy"><ShieldCheck size={14}/> Read-only public address scan. No wallet connection or signing.</div>
      {error && <div className="error"><CircleAlert size={16}/>{error}</div>}
    </section>

    {!result && !busy && <section className="empty-state"><div className="orbit"><div className="orbit-core"><Search size={27}/></div><span className="orbit-node node-a"/><span className="orbit-node node-b"/><span className="orbit-node node-c"/></div><h2>Your portfolio, mapped.</h2><p>Token balances, NFT collections and estimated values — brought together from supported EVM chains.</p><div className="feature-row"><span><Coins size={15}/> ERC-20 tokens</span><span><Image size={15}/> NFTs</span><span><Activity size={15}/> Chain status</span></div></section>}
    {busy && <section className="loading"><LoaderCircle className="spin" size={30}/><h2>Scanning supported networks</h2><p>Checking token balances and NFT ownership. This may take a little while.</p></section>}
    {result && <section className="results">
      <div className="result-head"><div><div className="eyebrow">SCAN COMPLETE · {new Date(result.scannedAt).toLocaleString()}</div><h2>Wallet overview</h2><div className="address-line"><code>{short(result.address)}</code><button onClick={copyAddress} className="icon-btn" title="Copy address"><Copy size={14}/>{copied ? 'Copied' : 'Copy'}</button><a className="icon-btn" href={'https://etherscan.io/address/' + result.address} target="_blank" rel="noreferrer">Explorer <ExternalLink size={13}/></a></div></div><button className="export-btn" onClick={exportCsv}><ArrowDownToLine size={16}/> Export CSV</button></div>
      <div className="stats-grid"><div className="stat-card"><span>ESTIMATED PORTFOLIO VALUE</span><strong>{money(total)}</strong><small>Known prices only</small></div><div className="stat-card"><span>TOKENS FOUND</span><strong>{tokens.length}</strong><small>Across scanned chains</small></div><div className="stat-card"><span>NFTS FOUND</span><strong>{nfts.length}</strong><small>ERC-721 / ERC-1155</small></div><div className="stat-card"><span>PRICED ASSETS</span><strong>{priced}<small className="muted-inline"> / {result.assets.length}</small></strong><small>Unpriced assets remain visible</small></div></div>
      <div className="chain-panel"><div className="panel-title"><span>NETWORK SCAN STATUS</span><span>{result.chains.filter(c => c.status === 'complete').length} / {result.chains.length} complete</span></div><div className="chain-grid">{result.chains.map(c => <div className="chain-item" key={c.chain}><span className={'status-dot ' + c.status}/><div><b>{c.chainName}</b><small>{c.tokenCount} tokens · {c.nftCount} NFTs</small>{c.error && <small className="chain-error">{c.error}</small>}</div><span className={'status-label ' + c.status}>{c.status}</span></div>)}</div></div>
      <div className="assets-panel"><div className="assets-head"><div><div className="panel-title">DISCOVERED ASSETS</div><p>{assets.length} assets shown · {result.assets.length} total found</p></div><div className="asset-controls"><div className="filter-search"><Search size={14}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter assets"/></div><div className="tabs"><button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>All</button><button className={tab === 'token' ? 'active' : ''} onClick={() => setTab('token')}>Tokens</button><button className={tab === 'nft' ? 'active' : ''} onClick={() => setTab('nft')}>NFTs</button></div></div></div>
        {assets.length ? <div className="table-wrap"><table><thead><tr><th>ASSET</th><th>NETWORK</th><th>CONTRACT / TOKEN ID</th><th>BALANCE</th><th>PRICE</th><th>VALUE</th></tr></thead><tbody>{assets.map((a,i) => <tr key={a.chain + a.contract + (a.tokenId ?? '') + i}><td><div className="asset-name">{a.image ? <img src={a.image} onError={e => (e.currentTarget.style.display = 'none')} /> : <span className="asset-icon">{a.type === 'nft' ? <Image size={15}/> : <Coins size={15}/>}</span>}<div><b>{a.name || 'Unknown asset'}</b><small>{a.type === 'nft' ? 'NFT' : a.symbol || 'ERC-20'}</small></div></div></td><td>{a.chainName}</td><td><code>{short(a.contract)}{a.tokenId ? ' · #' + a.tokenId : ''}</code></td><td>{number(a.balance)}</td><td>{money(a.price)}</td><td>{a.value == null ? <span className="unpriced">Unpriced</span> : money(a.value)}</td></tr>)}</tbody></table></div> : <div className="no-assets">No matching assets in this filter.</div>}
      </div>
      <div className="disclaimer"><CircleAlert size={15}/>{result.note}</div>
    </section>}
    <footer><div className="footer-brand">UWAS<span>.</span></div><p>Independent wallet discovery · Read-only · No custody</p><span>Built for transparency, not financial advice.</span></footer>
  </main>;
}