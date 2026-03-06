/**
 * testDirectSwap.ts
 *
 * Clean atomic test of pair.swap() directly.
 * Reads live reserves → computes amountOut → transfers amountIn → calls swap.
 * No intermediate syncs or extra transfers that corrupt the state.
 *
 * Run: npx hardhat run scripts/testDirectSwap.ts --network polkadotHub
 */

import { ethers } from "hardhat";

const PAIR_ADDRESS = "0x49fdc316d4637298B03782a92C9aaD5b35213f04";
const USDC         = "0x5a5306B699d21c9d6a16A792b266215d550cc338";
const WDOT         = "0xE32Abcaa249aB85bC995377E6DDd96f283343B28";

const pairABI = [
  "function getReserves() external view returns (uint112,uint112,uint32)",
  "function token0() external view returns (address)",
  "function swap(uint256,uint256,address,bytes) external",
  "function sync() external",
];
const erc20ABI = [
  "function balanceOf(address) external view returns (uint256)",
  "function transfer(address,uint256) external returns (bool)",
];

function calcAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const fee = amountIn * 9975n;
  return (fee * reserveOut) / (reserveIn * 10000n + fee);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\n🧪 ========== DIRECT SWAP TEST ==========");

  const pair = new ethers.Contract(PAIR_ADDRESS, pairABI, deployer);
  const usdc = new ethers.Contract(USDC, erc20ABI, deployer);
  const wdot = new ethers.Contract(WDOT, erc20ABI, deployer);

  // ── Step 1: Check if pair has any stuck balance from previous test ────────
  console.log("\n📋 Step 1: Check for stuck tokens in pair");
  const usdcInPair = await usdc.balanceOf(PAIR_ADDRESS) as bigint;
  const wdotInPair = await wdot.balanceOf(PAIR_ADDRESS) as bigint;
  const reserves   = await pair.getReserves() as [bigint, bigint, number];
  const token0     = await pair.token0() as string;
  const usdcIsT0   = token0.toLowerCase() === USDC.toLowerCase();

  const reserveUSDC = usdcIsT0 ? reserves[0] : reserves[1];
  const reserveWDOT = usdcIsT0 ? reserves[1] : reserves[0];

  console.log("  USDC balance of pair:", ethers.formatUnits(usdcInPair, 6));
  console.log("  WDOT balance of pair:", ethers.formatUnits(wdotInPair, 10));
  console.log("  Reserve USDC:        ", ethers.formatUnits(reserveUSDC, 6));
  console.log("  Reserve WDOT:        ", ethers.formatUnits(reserveWDOT, 10));

  // If balance > reserve, there are stuck tokens — sync first to absorb them
  if (usdcInPair > reserveUSDC || wdotInPair > reserveWDOT) {
    console.log("  ⚠️  Pair has extra tokens vs reserves — calling sync() to absorb");
    const syncTx = await pair.sync();
    await syncTx.wait();
    console.log("  ✅ Synced");
  } else {
    console.log("  ✅ Balances match reserves — no sync needed");
  }

  // ── Step 2: Read fresh reserves after sync ────────────────────────────────
  console.log("\n📋 Step 2: Fresh reserves");
  const freshReserves = await pair.getReserves() as [bigint, bigint, number];
  const rUSDC = usdcIsT0 ? freshReserves[0] : freshReserves[1];
  const rWDOT = usdcIsT0 ? freshReserves[1] : freshReserves[0];
  console.log("  Reserve USDC:", ethers.formatUnits(rUSDC, 6));
  console.log("  Reserve WDOT:", ethers.formatUnits(rWDOT, 10));
  console.log("  Ratio (raw): ", (rWDOT / rUSDC).toString());

  // ── Step 3: Compute amountOut from CURRENT reserves ───────────────────────
  const amountIn = ethers.parseUnits("100", 6); // 100 USDC
  const amountOut = calcAmountOut(amountIn, rUSDC, rWDOT);
  console.log("\n📋 Step 3: Swap calculation");
  console.log("  amountIn: ", ethers.formatUnits(amountIn, 6), "USDC");
  console.log("  amountOut:", ethers.formatUnits(amountOut, 10), "WDOT");

  // Use 99% of calculated output as minimum (1% slippage buffer)
  const amountOutMin = amountOut * 99n / 100n;

  // ── Step 4: Atomic transfer → swap ───────────────────────────────────────
  // CRITICAL: transfer amountIn to pair, then immediately swap in same block
  console.log("\n📋 Step 4: Transfer → Swap (atomic)");

  const wdotBefore = await wdot.balanceOf(deployer.address) as bigint;
  console.log("  WDOT before:", ethers.formatUnits(wdotBefore, 10));

  // Transfer amountIn to pair
  const transferTx = await usdc.transfer(PAIR_ADDRESS, amountIn);
  await transferTx.wait();
  console.log("  ✅ Transferred 100 USDC to pair");

  // Immediately compute amount0Out / amount1Out
  const amount0Out = usdcIsT0 ? 0n : amountOutMin;
  const amount1Out = usdcIsT0 ? amountOutMin : 0n;

  console.log("  amount0Out:", amount0Out.toString());
  console.log("  amount1Out:", amount1Out.toString());

  try {
    const swapTx = await pair.swap(amount0Out, amount1Out, deployer.address, "0x");
    await swapTx.wait();

    const wdotAfter = await wdot.balanceOf(deployer.address) as bigint;
    const received  = wdotAfter - wdotBefore;
    console.log("\n  ✅ SWAP SUCCEEDED!");
    console.log("  WDOT received:", ethers.formatUnits(received, 10));
    console.log("\n🎉 Pair works. Redeploy UniswapV2Adapter and you're done.\n");
  } catch (e: any) {
    console.error("\n  ❌ Swap failed:", e.message);

    // Check what the pair sees now
    const postTransferUSDC = await usdc.balanceOf(PAIR_ADDRESS) as bigint;
    const postTransferWDOT = await wdot.balanceOf(PAIR_ADDRESS) as bigint;
    const postReserves = await pair.getReserves() as [bigint, bigint, number];
    const postRUSDC = usdcIsT0 ? postReserves[0] : postReserves[1];
    const postRWDOT = usdcIsT0 ? postReserves[1] : postReserves[0];

    console.log("\n  Post-transfer state:");
    console.log("    USDC balance in pair:", ethers.formatUnits(postTransferUSDC, 6), "(reserve:", ethers.formatUnits(postRUSDC, 6), ")");
    console.log("    WDOT balance in pair:", ethers.formatUnits(postTransferWDOT, 10), "(reserve:", ethers.formatUnits(postRWDOT, 10), ")");

    // K check manually
    const kReserve  = postRUSDC * postRWDOT;
    const kBalance  = postTransferUSDC * postTransferWDOT;
    const kAfterFee = (postTransferUSDC * 10000n - amountIn * 25n) * postTransferWDOT;
    console.log("\n  K values:");
    console.log("    reserve K:       ", kReserve.toString());
    console.log("    balance K:       ", kBalance.toString());
    console.log("    balance K(after fee):", kAfterFee.toString());
    console.log("    K check passes?  ", kAfterFee >= kReserve * 10000n * 10000n ? "✅" : "❌");

    console.log("\n  ⚠️  If K check fails here, this fork uses a different fee (not 0.25%).");
    console.log("     Try recalculating with 0.3% fee (9970/10000) instead.\n");

    // Try with 0.3% fee
    const amountOutAt30bps = (amountIn * 9970n * postRWDOT) / (postRUSDC * 10000n + amountIn * 9970n);
    const amount0OutRetry = usdcIsT0 ? 0n : amountOutAt30bps * 99n / 100n;
    const amount1OutRetry = usdcIsT0 ? amountOutAt30bps * 99n / 100n : 0n;
    console.log("  Retrying with 0.3% fee, amountOut:", ethers.formatUnits(amountOutAt30bps, 10), "WDOT");

    try {
      const retryTx = await pair.swap(amount0OutRetry, amount1OutRetry, deployer.address, "0x");
      await retryTx.wait();
      const wdotAfter2 = await wdot.balanceOf(deployer.address) as bigint;
      console.log("  ✅ Swap with 0.3% fee succeeded! Received:", ethers.formatUnits(wdotAfter2 - wdotBefore, 10), "WDOT");
      console.log("  → Update _calcAmountOut in UniswapV2Adapter to use 9970 instead of 9975\n");
    } catch (e2: any) {
      console.error("  ❌ 0.3% fee also failed:", e2.message);
      console.log("\n  This pair may be permanently broken from the repair attempts.");
      console.log("  Recommendation: deploy fresh MockERC20 tokens and start over.\n");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });