import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CHAINS = [
  { key: "eth-mainnet", name: "Ethereum" },
  { key: "matic-mainnet", name: "Polygon" },
  { key: "arb-mainnet", name: "Arbitrum" },
  { key: "opt-mainnet", name: "Optimism" },
  { key: "base-mainnet", name: "Base" },
  { key: "zksync-mainnet", name: "ZKsync" },
  { key: "linea-mainnet", name: "Linea" },
  { key: "scroll-mainnet", name: "Scroll" },
  { key: "blast-mainnet", name: "Blast" },
];
const NETWORKS = CHAINS.map(c => c.key);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fmt = (raw: string, decimals: number) => {
  try {
    const v = BigInt(raw);
    const d = Math.max(0, Math.min(decimals, 36));
    const base = 10n ** BigInt(d);
    const whole = v / base;
    const fraction = (v % base).toString().padStart(d, "0").slice(0, 8).replace(/0+$/, "");
    return fraction ? whole.toString() + "." + fraction : whole.toString();
  } catch { return "0"; }
};
async function portfolioRequest(apiKey: string, endpoint: string, body: Record<string, unknown>) {
  const url = "https://api.g.alchemy.com/data/v1/" + apiKey + "/assets/" + endpoint;
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message ?? "Alchemy Portfolio API HTTP " + r.status);
  return data;
}
function networkErrorMap(response: any): Map<string, string> {
  const out = new Map<string, string>();
  const errors = response?.error?.partialErrors ?? [];
  for (const e of errors) {
    const network = e.network ?? e.chain ?? "unknown";
    out.set(network, e.message ?? e.error?.message ?? "Provider reported a partial network failure");
  }
  return out;
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
    const addressRequest = [{ address, networks: NETWORKS }];
    const [tokenResponse, nftResponse] = await Promise.all([
      portfolioRequest(apiKey, "tokens/by-address", {
        addresses: addressRequest, withMetadata: true, withPrices: true,
        includeNativeTokens: true, includeErc20Tokens: true,
      }),
      portfolioRequest(apiKey, "nfts/by-address", {
        addresses: addressRequest, withMetadata: true, pageSize: 100,
      }),
    ]);
    const tokenErrors = networkErrorMap(tokenResponse);
    const nftErrors = networkErrorMap(nftResponse);
    const assets: any[] = [];
    let tokenPageKey = tokenResponse?.data?.pageKey;
    let tokenPages = 1;
    for (const t of tokenResponse?.data?.tokens ?? []) {
      const network = t.network ?? "unknown";
      const chain = CHAINS.find(c => c.key === network);
      const meta = t.tokenMetadata ?? {};
      const decimals = Number(meta.decimals ?? 0);
      const balance = fmt(t.tokenBalance ?? "0x0", decimals);
      if (Number(balance) <= 0) continue;
      const priceRaw = t.tokenPrices?.find((p: any) => p.currency?.toLowerCase() === "usd")?.value;
      const price = priceRaw == null || !Number.isFinite(Number(priceRaw)) ? undefined : Number(priceRaw);
      assets.push({
        chain: network, chainName: chain?.name ?? network, type: "token",
        name: meta.name || meta.symbol || "Unknown token", symbol: meta.symbol || undefined,
        contract: t.tokenAddress ?? "native", balance, price,
        value: price == null ? undefined : Number(balance) * price,
        image: meta.logo || undefined, priceStatus: price == null ? "unpriced" : "priced",
      });
    }
    while (tokenPageKey && tokenPages < 10) {
      const page = await portfolioRequest(apiKey, "tokens/by-address", {
        addresses: addressRequest, withMetadata: true, withPrices: true,
        includeNativeTokens: true, includeErc20Tokens: true, pageKey: tokenPageKey,
      });
      for (const t of page?.data?.tokens ?? []) {
        const network = t.network ?? "unknown";
        const chain = CHAINS.find(c => c.key === network);
        const meta = t.tokenMetadata ?? {};
        const balance = fmt(t.tokenBalance ?? "0x0", Number(meta.decimals ?? 0));
        if (Number(balance) <= 0) continue;
        const priceRaw = t.tokenPrices?.find((p: any) => p.currency?.toLowerCase() === "usd")?.value;
        const price = priceRaw == null || !Number.isFinite(Number(priceRaw)) ? undefined : Number(priceRaw);
        assets.push({ chain: network, chainName: chain?.name ?? network, type: "token", name: meta.name || meta.symbol || "Unknown token", symbol: meta.symbol || undefined, contract: t.tokenAddress ?? "native", balance, price, value: price == null ? undefined : Number(balance) * price, image: meta.logo || undefined, priceStatus: price == null ? "unpriced" : "priced" });
      }
      tokenPageKey = page?.data?.pageKey;
      tokenPages++;
      for (const [k, v] of networkErrorMap(page)) tokenErrors.set(k, v);
    }
    if (tokenPageKey) tokenErrors.set("pagination", "Token pagination capped after 10 pages");
    let nftPageKey = nftResponse?.data?.pageKey;
    let nftPages = 1;
    const addNfts = (rows: any[]) => {
      for (const n of rows ?? []) {
        const network = n.network ?? "unknown";
        const chain = CHAINS.find(c => c.key === network);
        const contract = n.contract?.address ?? "";
        const image = n.image?.cachedUrl || n.image?.thumbnailUrl || n.image?.originalUrl || n.raw?.metadata?.image;
        assets.push({
          chain: network, chainName: chain?.name ?? network, type: "nft",
          name: n.name || n.contract?.name || "Unnamed NFT", contract,
          tokenId: n.tokenId ?? "", balance: String(n.balance ?? "1"),
          image: image || undefined, priceStatus: "unpriced",
        });
      }
    };
    addNfts(nftResponse?.data?.ownedNfts);
    while (nftPageKey && nftPages < 10) {
      const page = await portfolioRequest(apiKey, "nfts/by-address", {
        addresses: addressRequest, withMetadata: true, pageSize: 100, pageKey: nftPageKey,
      });
      addNfts(page?.data?.ownedNfts);
      nftPageKey = page?.data?.pageKey;
      nftPages++;
      for (const [k, v] of networkErrorMap(page)) nftErrors.set(k, v);
    }
    if (nftPageKey) nftErrors.set("pagination", "NFT pagination capped after 10 pages");
    const chains = CHAINS.map(c => {
      const errors = [tokenErrors.get(c.key), nftErrors.get(c.key)].filter(Boolean);
      const tokenCount = assets.filter(a => a.chain === c.key && a.type === "token").length;
      const nftCount = assets.filter(a => a.chain === c.key && a.type === "nft").length;
      return { chain: c.key, chainName: c.name, status: errors.length ? (tokenCount + nftCount ? "partial" : "failed") : "complete", error: errors.join(" · ") || undefined, tokenCount, nftCount };
    });
    const paginationWarnings = [tokenErrors.get("pagination"), nftErrors.get("pagination")].filter(Boolean);
    const failed = chains.filter(c => c.status !== "complete").length;
    const note = failed || paginationWarnings.length
      ? failed + " network(s) returned partial or failed data. " + paginationWarnings.join(" ") + " This is not proof that those networks contain no assets. Unpriced assets remain visible."
      : "Provider requests completed for all configured networks. Results are limited to Alchemy's supported/indexed assets and configured networks; this cannot guarantee discovery of every token or NFT ever created. NFT floor prices are not treated as confirmed USD values.";
    return json({ address, assets, chains, scannedAt: new Date().toISOString(), note });
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Unexpected scan failure." }, 500); }
});