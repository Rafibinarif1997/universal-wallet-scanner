import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 30 EVM mainnets configured for the first wide-coverage release.
// Network slugs follow Alchemy Portfolio API identifiers.
const CHAINS = [
  { key: "eth-mainnet", name: "Ethereum" },
  { key: "polygon-mainnet", name: "Polygon" },
  { key: "arb-mainnet", name: "Arbitrum One" },
  { key: "opt-mainnet", name: "Optimism" },
  { key: "base-mainnet", name: "Base" },
  { key: "zksync-mainnet", name: "zkSync Era" },
  { key: "linea-mainnet", name: "Linea" },
  { key: "scroll-mainnet", name: "Scroll" },
  { key: "blast-mainnet", name: "Blast" },
  { key: "avax-mainnet", name: "Avalanche C-Chain" },
  { key: "bnb-mainnet", name: "BNB Smart Chain" },
  { key: "worldchain-mainnet", name: "World Chain" },
  { key: "unichain-mainnet", name: "Unichain" },
  { key: "sonic-mainnet", name: "Sonic" },
  { key: "berachain-mainnet", name: "Berachain" },
  { key: "monad-mainnet", name: "Monad" },
  { key: "abstract-mainnet", name: "Abstract" },
  { key: "ink-mainnet", name: "Ink" },
  { key: "soneium-mainnet", name: "Soneium" },
  { key: "shape-mainnet", name: "Shape" },
  { key: "apechain-mainnet", name: "ApeChain" },
  { key: "plume-mainnet", name: "Plume" },
  { key: "hyperevm-mainnet", name: "HyperEVM" },
  { key: "megaeth-mainnet", name: "MegaETH" },
  { key: "mantle-mainnet", name: "Mantle" },
  { key: "celo-mainnet", name: "Celo" },
  { key: "gnosis-mainnet", name: "Gnosis" },
  { key: "zora-mainnet", name: "Zora" },
  { key: "fraxtal-mainnet", name: "Fraxtal" },
  { key: "taiko-mainnet", name: "Taiko" },
];
const NETWORKS = CHAINS.map(c => c.key);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

const fmt = (raw: string, decimals: number | null | undefined): string | null => {
  if (decimals == null || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  try {
    const v = BigInt(raw);
    const d = decimals;
    const base = 10n ** BigInt(d);
    const whole = v / base;
    const fraction = (v % base).toString().padStart(d, "0").slice(0, 8).replace(/0+$/, "");
    return fraction ? whole.toString() + "." + fraction : whole.toString();
  } catch { return null; }
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
  for (const e of response?.error?.partialErrors ?? []) {
    const network = e.network ?? e.chain ?? "unknown";
    out.set(network, e.message ?? "Provider reported a partial network failure");
  }
  return out;
}

async function fetchPages(apiKey: string, endpoint: string, address: string, networks: string[], pageSize: number) {
  const rows: any[] = [];
  const errors = new Map<string, string>();
  let pageKey: string | undefined;
  let page = 0;
  do {
    const response = await portfolioRequest(apiKey, endpoint, {
      addresses: [{ address, networks }],
      withMetadata: true,
      ...(endpoint === "tokens/by-address" ? { withPrices: true, includeNativeTokens: true, includeErc20Tokens: true } : { pageSize: 100 }),
      ...(pageKey ? { pageKey } : {}),
    });
    for (const [network, message] of networkErrorMap(response)) errors.set(network, message);
    const data = response?.data ?? {};
    rows.push(...(endpoint === "tokens/by-address" ? (data.tokens ?? []) : (data.ownedNfts ?? [])));
    pageKey = data.pageKey ?? undefined;
    page++;
  } while (pageKey && page < pageSize);
  if (pageKey) errors.set("pagination", "Results capped after " + pageSize + " pages for this network batch.");
  return { rows, errors };
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

    const tokenRows: any[] = [];
    const nftRows: any[] = [];
    const tokenErrors = new Map<string, string>();
    const nftErrors = new Map<string, string>();

    // Use small batches normally. If a batch is rejected (for example, because
    // one network is unsupported), retry its networks individually so one bad
    // network cannot incorrectly mark its neighbours as failed.
    for (const batch of chunks(NETWORKS, 5)) {
      try {
        const r = await fetchPages(apiKey, "tokens/by-address", address, batch, 10);
        tokenRows.push(...r.rows);
        for (const [k, v] of r.errors) tokenErrors.set(k, v);
      } catch {
        for (const network of batch) {
          try {
            const r = await fetchPages(apiKey, "tokens/by-address", address, [network], 10);
            tokenRows.push(...r.rows);
            for (const [k, v] of r.errors) tokenErrors.set(k, v);
          } catch (e) {
            tokenErrors.set(network, e instanceof Error ? e.message : "Token request failed");
          }
        }
      }
    }
    for (const batch of chunks(NETWORKS, 5)) {
      try {
        const r = await fetchPages(apiKey, "nfts/by-address", address, batch, 10);
        nftRows.push(...r.rows);
        for (const [k, v] of r.errors) nftErrors.set(k, v);
      } catch {
        for (const network of batch) {
          try {
            const r = await fetchPages(apiKey, "nfts/by-address", address, [network], 10);
            nftRows.push(...r.rows);
            for (const [k, v] of r.errors) nftErrors.set(k, v);
          } catch (e) {
            nftErrors.set(network, e instanceof Error ? e.message : "NFT request failed");
          }
        }
      }
    }

    const assets: any[] = [];
    for (const t of tokenRows) {
      const network = t.network ?? "unknown";
      const chain = CHAINS.find(c => c.key === network);
      const meta = t.tokenMetadata ?? {};
      // Native assets may have null decimals in Alchemy metadata; EVM native
      // currencies use 18 decimals. Never assume 0 decimals for ERC-20 tokens.
      const decimals = t.tokenAddress == null ? (meta.decimals ?? 18) : meta.decimals;
      const balance = fmt(t.tokenBalance ?? "0x0", decimals);
      if (balance !== null && Number(balance) <= 0) continue;
      const priceRaw = t.tokenPrices?.find((p: any) => p.currency?.toLowerCase() === "usd")?.value;
      const price = priceRaw == null || !Number.isFinite(Number(priceRaw)) ? undefined : Number(priceRaw);
      assets.push({
        chain: network, chainName: chain?.name ?? network, type: "token",
        name: meta.name || meta.symbol || "Unknown token", symbol: meta.symbol || undefined,
        contract: t.tokenAddress ?? "native", balance: balance ?? "—", price: balance == null ? undefined : price,
        value: balance == null || price == null ? undefined : Number(balance) * price,
        image: meta.logo || undefined, priceStatus: balance == null || price == null ? "unpriced" : "priced",
      });
    }

    for (const n of nftRows) {
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

    const chains = CHAINS.map(c => {
      const errors = [tokenErrors.get(c.key), nftErrors.get(c.key)].filter(Boolean);
      const tokenCount = assets.filter(a => a.chain === c.key && a.type === "token").length;
      const nftCount = assets.filter(a => a.chain === c.key && a.type === "nft").length;
      return {
        chain: c.key, chainName: c.name,
        status: errors.length ? (tokenCount + nftCount ? "partial" : "failed") : "complete",
        error: errors.join(" · ") || undefined, tokenCount, nftCount,
      };
    });
    const warnings = [tokenErrors.get("pagination"), nftErrors.get("pagination")].filter(Boolean);
    const failed = chains.filter(c => c.status !== "complete").length;
    const note = failed || warnings.length
      ? failed + " of 30 networks returned partial or failed data. " + warnings.join(" ") + " A failed network does not mean the wallet has no assets there. Unpriced assets remain visible."
      : "All 30 configured network requests completed. Results depend on Alchemy Portfolio API coverage and indexing; this cannot guarantee discovery of every token or NFT ever created. NFT floor prices are not treated as confirmed USD values.";
    return json({ address, assets, chains, scannedAt: new Date().toISOString(), note });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected scan failure." }, 500);
  }
});