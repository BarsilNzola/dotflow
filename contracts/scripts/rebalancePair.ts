/**
 * The pair has reserves at a mixed ratio because old broken liquidity
 * left minimum-locked tokens at ~1:972 while new liquidity was added at 1:1000.
 * The K invariant check fails on swap because of this mismatch.
 *
 * Fix: send extra USDC to bring reserves to exact 1:1000 (raw) then sync().
 * No mint — just rebalance the ratio so K is consistent.
 *
 */

import { ethers } from "hardhat";

const PAIR_ADDRESS = "0x49fdc316d4637298B03782a92C9aaD5b35213f04";
const USDC         = "0x5a5306B699d21c9d6a16A792b266215d550cc338";
const WDOT         = "0xE32Abcaa249aB85bC995377E6DDd96f283343B28";

// Target ratio: 1 USDC-raw : 1000 WDOT-raw
// i.e. reserveWDOT / reserveUSDC = 1000 (in raw token units)
// USDC has 6 decimals, WDOT has 10 decimals
// 1 USDC (human) = 0.1 WDOT (human) → 1_000_000 USDC-wei = 1_000_000_000 WDOT-wei → ratio 1:1000 raw 
const TARGET_RATIO = 1000n; // reserveWDOT / reserveUSDC in raw units

const pairABI = [
  "function getReserves() external view returns (uint112,uint112,uint32)",
  "function token0() external view returns (address)",
  "function sync() external",
  "function swap(uint256,uint256,address,bytes) external",
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
  console.log("\n  ========== REBALANCE PAIR ==========");
  console.log("Deployer:", deployer.address);

  const pair = new ethers.Contract(PAIR_ADDRESS, pairABI, deployer);
  const usdc = new ethers.Contract(USDC, erc20ABI, deployer);
  const wdot = new ethers.Contract(WDOT, erc20ABI, deployer);

  // ── Step 1: Read current state ────────────────────────────────────────────
  console.log("\n Step 1: Current reserves");
  const reserves = await pair.getReserves() as [bigint, bigint, number];
  const token0   = await pair.token0() as string;
  const usdcIsToken0 = token0.toLowerCase() === USDC.toLowerCase();

  let reserveUSDC = usdcIsToken0 ? reserves[0] : reserves[1];
  let reserveWDOT = usdcIsToken0 ? reserves[1] : reserves[0];

  console.log("  Reserve USDC:", reserveUSDC.toString(), "wei =", ethers.formatUnits(reserveUSDC, 6));
  console.log("  Reserve WDOT:", reserveWDOT.toString(), "wei =", ethers.formatUnits(reserveWDOT, 10));
  console.log("  Current ratio (WDOT/USDC raw):", (reserveWDOT / reserveUSDC).toString());
  console.log("  Target  ratio (WDOT/USDC raw):", TARGET_RATIO.toString());

  // ── Step 2: Calculate how much USDC to add to hit target ratio ────────────
  // We want: reserveWDOT / (reserveUSDC + extraUSDC) = TARGET_RATIO
  // So: reserveUSDC + extraUSDC = reserveWDOT / TARGET_RATIO
  // extraUSDC = reserveWDOT / TARGET_RATIO - reserveUSDC
  console.log("\n Step 2: Calculate rebalance amount");

  const targetUSDC = reserveWDOT / TARGET_RATIO;
  console.log("  Target USDC reserve:", targetUSDC.toString(), "wei =", ethers.formatUnits(targetUSDC, 6));

  if (targetUSDC <= reserveUSDC) {
    // USDC is already too high — need to add WDOT instead
    const targetWDOT = reserveUSDC * TARGET_RATIO;
    const extraWDOT  = targetWDOT - reserveWDOT;
    console.log("  USDC reserve already >= target — adding WDOT instead");
    console.log("  Extra WDOT needed:", ethers.formatUnits(extraWDOT, 10));

    const wdotBal = await wdot.balanceOf(deployer.address) as bigint;
    if (wdotBal < extraWDOT) {
      console.error("   Insufficient WDOT. Have:", ethers.formatUnits(wdotBal, 10), "Need:", ethers.formatUnits(extraWDOT, 10));
      process.exit(1);
    }

    console.log("  Transferring WDOT to pair...");
    const tx = await wdot.transfer(PAIR_ADDRESS, extraWDOT);
    await tx.wait();
    console.log("   WDOT transferred");
  } else {
    const extraUSDC = targetUSDC - reserveUSDC;
    console.log("  Extra USDC needed:", extraUSDC.toString(), "wei =", ethers.formatUnits(extraUSDC, 6));

    const usdcBal = await usdc.balanceOf(deployer.address) as bigint;
    if (usdcBal < extraUSDC) {
      console.error("   Insufficient USDC. Have:", ethers.formatUnits(usdcBal, 6), "Need:", ethers.formatUnits(extraUSDC, 6));
      process.exit(1);
    }

    console.log("  Transferring USDC to pair...");
    const tx = await usdc.transfer(PAIR_ADDRESS, extraUSDC);
    await tx.wait();
    console.log("   USDC transferred");
  }

  // ── Step 3: Sync to commit new reserves ───────────────────────────────────
  console.log("\n Step 3: Calling pair.sync()");
  const syncTx = await pair.sync();
  await syncTx.wait();
  console.log("   Sync complete");

  // ── Step 4: Verify new ratio ───────────────────────────────────────────────
  console.log("\n Step 4: Verify reserves");
  const newReserves = await pair.getReserves() as [bigint, bigint, number];
  reserveUSDC = usdcIsToken0 ? newReserves[0] : newReserves[1];
  reserveWDOT = usdcIsToken0 ? newReserves[1] : newReserves[0];
  const newRatio = reserveWDOT / reserveUSDC;

  console.log("  Reserve USDC:", ethers.formatUnits(reserveUSDC, 6));
  console.log("  Reserve WDOT:", ethers.formatUnits(reserveWDOT, 10));
  console.log("  New ratio (WDOT/USDC raw):", newRatio.toString(), newRatio === TARGET_RATIO ? " exact" : `(target: ${TARGET_RATIO})`);

  // ── Step 5: Test direct swap ───────────────────────────────────────────────
  console.log("\n Step 5: Test direct pair.swap()");
  const testIn  = ethers.parseUnits("100", 6);
  const testOut = calcAmountOut(testIn, reserveUSDC, reserveWDOT);
  console.log("  Swapping 100 USDC, expecting ~", ethers.formatUnits(testOut, 10), "WDOT");

  const wdotBefore = await wdot.balanceOf(deployer.address) as bigint;

  const t = await usdc.transfer(PAIR_ADDRESS, testIn);
  await t.wait();

  const amount0Out = usdcIsToken0 ? 0n : testOut;
  const amount1Out = usdcIsToken0 ? testOut : 0n;

  try {
    const swapTx = await pair.swap(amount0Out, amount1Out, deployer.address, "0x");
    await swapTx.wait();

    const wdotAfter  = await wdot.balanceOf(deployer.address) as bigint;
    const received   = wdotAfter - wdotBefore;
    console.log("   Direct swap succeeded!");
    console.log("  WDOT received:", ethers.formatUnits(received, 10));
    console.log("\n Pair is healthy. Now redeploy UniswapV2Adapter and run your deploy script.");
    console.log("   The new adapter calls pair.swap() directly — no router needed.\n");
  } catch (e: any) {
    console.error("   Swap still failing:", e.message);
    console.log("\n  Final reserves after sync:");
    const fr = await pair.getReserves() as [bigint, bigint, number];
    console.log("  ", fr[0].toString(), "/", fr[1].toString());
    console.log("\n  The pair on this fork may enforce additional invariants.");
    console.log("  Consider deploying fresh tokens and a fresh pair.\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });