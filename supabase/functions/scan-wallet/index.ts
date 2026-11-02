import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CHAINS = [
  { key: "eth-mainnet", name: "Ethereum", rpc: "eth" },
  { key: "polygon-mainnet", name: "Polygon", rpc: "polygon" },
  { key: "arb-mainnet", name: "Arbitrum", rpc: "arbitrum" },
  { key: "opt-mainnet", name: "Optimism", rpc: "optimism" },
  { key: "base-mainnet", name: "Base", rpc: "base" },
  { key: "zksync-mainnet", name: "ZKsync", rpc: "zksync" },
  { key: "linea-mainnet", name: "Linea", rpc: "linea" },
  { key: "scroll-mainnet", name: "Scroll", rpc: "scroll" },
  { key: "blast-mainnet", name: "Blast", rpc: "blast" },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fmt = (raw: string, decimals: number) => {
  try { const v = BigInt(raw); const base = 10n ** BigInt(Math.max(0, Math.min(decimals, 36))); const whole = v / base; const fraction = (v % base).toString().padStart(Number(decimals), "0").slice(0, 8).replace(/0+$/, ""); return fraction ? whole.toString() + "." + fraction : whole.toString(); }
  catch { return "0"; }
};
async function rpc(url: string, method: string, params: unknown[]) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!r.ok) throw new Error("RPC HTTP " + r.status);
  const j = await r.json(); if (j.error) throw new Error(j.error.message ?? "RPC error"); return j.result;
}
async function getPrice(chain: string, contract: string): Promise<number | undefined> {
  try {
    const r = await fetch("https://coins.llama.fi/prices/current/" + encodeURIComponent(chain + ":" + contract));
    if (!r.ok) return undefined;
    const j = await r.json(); const p = j.coins?.[chain + ":" + contract]?.price;
    return typeof p === "number" && Number.isFinite(p) ? p : undefined;
  } catch { return undefined; }
}
async function scanChain(chain: typeof CHAINS[number], address: string, apiKey: string) {
  const rpcUrl = "https://" + chain.key + ".g.alchemy.com/v2/" + apiKey;
  const nftUrl = "https://" + chain.key + ".g.alchemy.com/nft/v3/" + apiKey + "/getNFTsForOwner";
  const assets: any[] = [];
  let tokenCount = 0, nftCount = 0;
  const errors: string[] = [];
  try {
    const rawNative = await rpc(rpcUrl, "eth_getBalance", [address, "latest"]);
    const native = Number(BigInt(rawNative)) / 1e18;
    if (native > 0) {
      const nativePrice = await getPrice(chain.rpc, "0x0000000000000000000000000000000000000000");
      assets.push({ chain: chain.key, chainName: chain.name, type: "token", name: chain.name + " native coin", symbol: chain.name === "Polygon" ? "POL" : chain.name === "Ethereum" ? "ETH" : chain.name === "Arbitrum" || chain.name === "Optimism" || chain.name === "Base" ? "ETH" : chain.name === "ZKsync" ? "ETH" : chain.name === "Linea" ? "ETH" : chain.name === "Scroll" ? "ETH" : chain.name === "Blast" ? "ETH" : chain.name, contract: "native", balance: String(native), price: nativePrice, value: nativePrice == null ? undefined : native * nativePrice, priceStatus: nativePrice == null ? "unpriced" : "priced" });
    }
  } catch (e) { errors.push("Native balance: " + (e instanceof Error ? e.message : "failed")); }
  try {
    const balances = await rpc(rpcUrl, "alchemy_getTokenBalances", [address, "DEFAULT_TOKENS"]);
    for (const item of balances.tokenBalances ?? []) {
      if (!item.contractAddress || !item.tokenBalance || item.tokenBalance === "0x0") continue;
      try {
        const meta = await rpc(rpcUrl, "alchemy_getTokenMetadata", [item.contractAddress]);
        const decimals = Number(meta.decimals ?? 0);
        const balance = fmt(item.tokenBalance, decimals);
        if (Number(balance) === 0) continue;
        const price = await getPrice(chain.rpc, item.contractAddress.toLowerCase());
        assets.push({ chain: chain.key, chainName: chain.name, type: "token", name: meta.name || meta.symbol || "Unknown token", symbol: meta.symbol || undefined, contract: item.contractAddress, balance, price, value: price == null ? undefined : Number(balance) * price, priceStatus: price == null ? "unpriced" : "priced" });
      } catch { /* Keep scanning other token contracts; provider may omit metadata for spam tokens. */ }
    }
    tokenCount = assets.filter(a => a.type === "token").length;
  } catch (e) { errors.push("Token balances: " + (e instanceof Error ? e.message : "failed")); }
  try {
    let pageKey: string | undefined;
    for (let page = 0; page < 10; page++) {
      const u = new URL(nftUrl); u.searchParams.set("owner", address); u.searchParams.set("withMetadata", "true"); u.searchParams.set("pageSize", "100");
      if (pageKey) u.searchParams.set("pageKey", pageKey);
      const r = await fetch(u); if (!r.ok) throw new Error("NFT API HTTP " + r.status);
      const data = await r.json();
      for (const n of data.ownedNfts ?? []) {
        const contract = n.contract?.address ?? "";
        const tokenId = n.tokenId ?? "";
        const title = n.name || n.collection?.name || n.contract?.name || "Unnamed NFT";
        const image = n.image?.cachedUrl || n.image?.thumbnailUrl || n.image?.originalUrl || n.raw?.metadata?.image;
        const qty = n.balance ?? "1";
        assets.push({ chain: chain.key, chainName: chain.name, type: "nft", name: title, contract, tokenId, balance: String(qty), image, priceStatus: "unpriced" });
      }
      pageKey = data.pageKey;
      if (!pageKey) break;
      if (page === 9) errors.push("NFT pagination capped at 1,000 items");
    }
    nftCount = assets.filter(a => a.type === "nft").length;
  } catch (e) { errors.push("NFTs: " + (e instanceof Error ? e.message : "failed")); }
  const status = errors.length === 0 ? "complete" : assets.length ? "partial" : "failed";
  return { assets, chain: { chain: chain.key, chainName: chain.name, status, error: errors.join(" · ") || undefined, tokenCount, nftCount } };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = Deno.env.get("ALCHEMY_API_KEY");
  if (!apiKey) return json({ error: "Server is missing ALCHEMY_API_KEY secret." }, 500);
  try {
    const body = await req.json();
    const address = String(body.address ?? "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return json({ error: "Invalid EVM wallet address." }, 400);
    const results = await Promise.all(CHAINS.map(c => scanChain(c, address, apiKey)));
    const assets = results.flatMap(r => r.assets);
    const chains = results.map(r => r.chain);
    const failed = chains.filter(c => c.status !== "complete").length;
    return json({ address, assets, chains, scannedAt: new Date().toISOString(), note: failed ? failed + " network(s) returned partial or failed data. This is not proof that the wallet has no assets on those networks. Token/NFT price coverage is incomplete; unknown prices are shown as unpriced." : "All configured provider calls completed. This scan covers only the configured supported networks and indexed assets; it cannot guarantee discovery of every token or NFT ever created." });
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Unexpected scan failure." }, 500); }
});