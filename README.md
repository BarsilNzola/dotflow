# DotFlow 🌊

> **Cross-chain token swaps on Polkadot Hub — swap local assets and bridge them to any parachain in one seamless flow.**

Built for the Polkadot hackathon. DotFlow lets users swap ERC-20 tokens on Polkadot Hub via Uniswap V2 and automatically bridge the output to a destination parachain using XCM — all from a single UI.

---

## What it does

DotFlow is a cross-chain DEX built natively on Polkadot Hub. It combines:

- **Same-chain swaps** — Uniswap V2 token swaps directly on Polkadot Hub, bypassing the broken Uniswap router on this fork with a direct pair-level swap implementation
- **Cross-chain swaps** — Swap USDC → WDOT on Hub, then automatically dispatch an XCM message to send those tokens to a destination parachain (e.g. Westend Asset Hub)
- **Real-time status tracking** — 4-stage UI progress tracker that polls the on-chain message status until the XCM message is confirmed as `Executed` on the destination chain

---

## Architecture

```
User
 │
 ├─[1] Approve USDC → UniswapV2Adapter
 ├─[2] UniswapV2Adapter.swapExactTokensForTokens()  ← direct pair swap, no router
 ├─[3] Approve WDOT → CrossChainExecutor
 └─[4] CrossChainExecutor.sendParachainAssets()      ← builds + dispatches XCM
          │
          └─ XCM Precompile (0x00000000000000000000000000000000000a0000)
               │
               └─ Destination Parachain (Westend Asset Hub)
```

### Smart Contracts

| Contract | Description |
|---|---|
| `DotFlowRouter` | Entry point for same-chain swaps. Routes through registered adapters. |
| `UniswapV2Adapter` | Direct Uniswap V2 pair swap adapter. Bypasses the broken router on this fork — transfers tokens directly to the pair and calls `pair.swap()`. |
| `CrossChainExecutor` | Locks ERC-20 tokens, builds SCALE-encoded XCM messages, and dispatches via the on-chain XCM precompile. |
| `ParachainAdapter` | Alternative adapter for parachain-aware routing through the executor. |
| `LiquidityManager` | Manages liquidity pools for supported tokens. |

### Key Design Decisions

**Why bypass the Uniswap router?**
The Uniswap V2 router deployed on Polkadot Hub has broken `getAmountsOut` and approval flow. DotFlow's `UniswapV2Adapter` bypasses it entirely — it reads reserves directly from the pair, computes output using the standard AMM formula, transfers tokens straight to the pair contract, and calls `pair.swap()`. This is both more gas efficient and actually works.

**Why call adapter and executor directly from the frontend?**
The `DotFlowRouter.crossChainSwap()` function internally triggered the broken router path, causing a silent `ERC20InsufficientAllowance` revert with `Data: 0x`. The fix was to call the adapter and executor directly from the frontend in a clean 4-step flow — each step isolated, each with its own wallet confirmation and on-chain receipt.

**XCM message encoding**
`CrossChainExecutor` builds SCALE-encoded XCM V3 messages entirely in Solidity:
- `ReserveAssetDeposited` + `ClearOrigin` + `BuyExecution` + `DepositAsset`
- Destination encoded as `VersionedMultiLocation::V3 { parents: 0, interior: X1(Parachain(id)) }`
- Beneficiary encoded as `AccountKey20 { network: None, key: recipient }`

---

## Deployed Contracts (Polkadot Hub Testnet)

| Contract | Address |
|---|---|
| DotFlowRouter | `0x6c964D065A25047563D0148a22F9eC296513A593` |
| CrossChainExecutor | `0x97B4eEc143f98f08c25e9e2960448BaCbe0E78CF` |
| UniswapV2Adapter | `0xcE6e8394eaEBA3dcC320189D750F55e3Bc3De9D9` |
| LiquidityManager | `0x6771cBF635557Ed91893C176F0032573F8cf9aEb` |
| USDC (Mock) | `0x399ae6bf402a89f18993A97Ff50Bd50A891DaD37` |
| WDOT (Mock) | `0x38183Ef90FDFed16b6b60254A1A18832e5ea0F23` |

**Destination chain:** Westend Asset Hub (Chain ID: `420420421`)

---

## Tech Stack

- **Solidity ^0.8.23** — Smart contracts
- **Hardhat** — Compilation, deployment, scripting
- **OpenZeppelin** — AccessControl, ReentrancyGuard, SafeERC20
- **React + TypeScript** — Frontend
- **viem + wagmi** — Onchain reads/writes
- **Polkadot Hub** — EVM-compatible parachain with XCM precompile

---

## Getting Started

### Prerequisites

- Node.js 18+
- A wallet funded with PAS (Polkadot Hub testnet token) for gas

### Install

```bash
git clone https://github.com/your-org/dotflow
cd dotflow

# Install contract dependencies
cd contracts
npm install

# Install frontend dependencies
cd ../apps/web
npm install
```

### Configure

Create `contracts/.env`:
```env
PRIVATE_KEY=your_deployer_private_key
POLKADOT_HUB_RPC=https://westend-asset-hub-eth-rpc.polkadot.io
```

### Deploy

```bash
# Deploy mock tokens first
npx hardhat run scripts/deploy-tokens.ts --network polkadotHub

# Deploy all contracts
npx hardhat run scripts/deploy.ts --network polkadotHub
```

### Verify deployment

```bash
npx hardhat run scripts/check-executor.ts --network polkadotHub
```

All 8 checks should show ✓ before using the frontend.

### Run frontend

```bash
cd apps/web
npm run dev
```

---

## How to Use

### Same-chain swap

1. Connect your wallet to Polkadot Hub (Chain ID: `420420417`)
2. Select tokens (e.g. USDC → WDOT)
3. Enter amount
4. Click **Swap** — approve + confirm (2 wallet pop-ups)

### Cross-chain swap

1. Connect your wallet to Polkadot Hub
2. Select the **Cross-Chain** tab
3. Select tokens, amount, and destination chain (Westend Asset Hub)
4. Click **Swap Cross-Chain** — 4 wallet pop-ups:
   - Approve USDC → Adapter
   - Adapter swap (USDC → WDOT)
   - Approve WDOT → Executor
   - XCM dispatch
5. Watch the 4-stage status tracker. When it hits **✅ Executed**, tokens have arrived on the destination chain.

---

## Project Structure

```
dotflow/
├── contracts/
│   ├── contracts/
│   │   ├── DotFlowRouter.sol
│   │   ├── CrossChainExecutor.sol
│   │   ├── LiquidityManager.sol
│   │   ├── adapters/
│   │   │   ├── UniswapV2Adapter.sol
│   │   │   └── ParachainAdapter.sol
│   │   └── interfaces/
│   │       ├── IXCM.sol
│   │       ├── IXcmPrecompile.sol
│   │       └── ILiquidityAdapter.sol
│   └── scripts/
│       ├── deploy.ts
│       ├── deploy-tokens.ts
│       ├── check-executor.ts
│       └── debug-crosschain.ts
└── apps/
    ├── web/
    │   └── src/
    │       ├── hooks/
    │       │   ├── useCrossChainSwap.ts
    │       │   └── useRouteQuote.ts
    │       └── components/
    │           ├── CrossChainSwapForm.tsx
    │           └── CrossChainStatus.tsx
    └── indexer/
        └── src/
            └── index.ts
```

---

## Indexer (Optional)

DotFlow includes an event indexer (`apps/indexer`) that listens to on-chain events from the router contract and stores them in a Prisma database for swap history and analytics.

It indexes:
- `SwapCreated` — records every swap attempt
- `SwapExecuted` — updates swaps with final output amount
- `CrossChainSwapInitiated` — tracks XCM message dispatch per parachain

To run it, configure `apps/indexer/.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/dotflow
RPC_URL=https://westend-asset-hub-eth-rpc.polkadot.io
ROUTER_ADDRESS=0x6c964D065A25047563D0148a22F9eC296513A593
CHAIN_ID=420420417
```

Then:

```bash
cd apps/indexer
npx prisma migrate dev
npm run dev
```

> **Note:** The indexer is not required for the MVP demo — the frontend works fully without it. It is provided as optional infrastructure for anyone who wants to build swap history, analytics, or a leaderboard on top of DotFlow.

---

## What's Next

- Multi-hop cross-chain routes (swap through intermediate assets)
- HRMP channel support for mainnet parachain bridging
- Relayer network for automatic XCM message confirmation
- Indexer dashboard UI for swap history and analytics
- Support for additional parachains beyond Westend Asset Hub
- Native token (DOT) support as swap input

---

## Team

Built with way too much debugging at the Polkadot Hackathon 🛠️

---

## License

MIT