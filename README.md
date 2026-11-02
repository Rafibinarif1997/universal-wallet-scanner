# UWAS — Universal Wallet Asset Scanner

A read-only EVM wallet asset discovery dashboard. Users paste a public address; they never connect a wallet or sign a transaction.

## Current scope

- EVM address validation
- Multi-network scan orchestration
- ERC-20 balances and ERC-721/ERC-1155 NFT discovery
- Per-network complete / partial / failed status
- Unpriced assets remain visible
- CSV export
- Mobile-responsive dashboard

**Important:** this project does not claim exhaustive discovery. Results depend on the configured provider's chain coverage, indexing, rate limits and API response. Unsupported networks and provider failures must be reported as incomplete, never silently treated as zero assets.

## Stack

- React + Vite + TypeScript
- Supabase Edge Function as the API-key proxy
- Alchemy NFT API and JSON-RPC
- DeFiLlama token price endpoint where a reliable token price is available
- GitHub Pages frontend hosting

## 1. Local frontend

```bash
npm install
npm run dev
```

## 2. Supabase setup

Create a Supabase project. Install the Supabase CLI and link the project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set ALCHEMY_API_KEY=YOUR_ALCHEMY_API_KEY
supabase functions deploy scan-wallet
```

Do not put the Alchemy key in a VITE_ variable or commit it to GitHub. The Edge Function reads it from server-side secrets.

## 3. Frontend environment

Create `.env.local` (never commit it):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

The anon key is intended for browser use; protect the function with validation and rate limits before public launch.

## 4. GitHub Pages

The included workflow builds and publishes the Vite app to GitHub Pages. In repository Settings → Pages, select **GitHub Actions** as the build and deployment source.

Add these repository Actions variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Current provider coverage

The initial registry targets common Alchemy EVM networks: Ethereum, Polygon, Arbitrum, Optimism, Base, ZKsync, Linea, Scroll and Blast. Confirm current support in the Alchemy dashboard before production use. A chain is only counted as scanned when its provider calls succeed.

## Price and valuation policy

A missing price is `null`, not zero. Portfolio totals include only assets with a returned price. NFT collection floor estimates are not guaranteed liquidation values and are not treated as confirmed sale prices.

## Security

- Never request a seed phrase or private key.
- Never sign or submit transactions.
- Keep provider secrets server-side.
- Add request throttling, address validation and abuse controls before opening the endpoint to the public.
