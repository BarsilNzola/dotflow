/**
 * Isolates exactly which step of crossChainSwap is reverting.
 */
import { ethers } from 'hardhat'

const ROUTER   = '0x37A5aeB32102157f19d7fFf139ecf65dC33f07aE'
const EXECUTOR = '0xA841956B969BEA2b8ab62f5D29CDCa3780B77C8a'
const USDC     = '0x399ae6bf402a89f18993A97Ff50Bd50A891DaD37'
const WDOT     = '0x38183Ef90FDFed16b6b60254A1A18832e5ea0F23'
const ADAPTER  = '0x9554cf878170E80b7eF8b8Bc8850ADB738c1e7A5'
const WESTEND  = 420420421

async function main() {
  const [signer] = await ethers.getSigners()
  const amountIn = ethers.parseUnits('10', 6)

  const usdc     = await ethers.getContractAt('IERC20', USDC)
  const wdot     = await ethers.getContractAt('IERC20', WDOT)
  const executor = await ethers.getContractAt('CrossChainExecutor', EXECUTOR)
  const adapter  = await ethers.getContractAt('UniswapV2Adapter', ADAPTER)
  const router   = await ethers.getContractAt('DotFlowRouter', ROUTER)

  console.log('\n════════════════════════════════════')
  console.log(' STEP A — Uniswap adapter quote')
  console.log('════════════════════════════════════')
  try {
    const [amountOut, fee, impact] = await adapter.getAmountOut(USDC, WDOT, amountIn)
    console.log('  amountOut :', ethers.formatUnits(amountOut, 18), 'WDOT')
    console.log('  fee       :', fee.toString(), 'bps')
    console.log('  priceImpact:', impact.toString())
    if (amountOut === 0n) {
      console.log('  ✗ amountOut is ZERO — pair has no liquidity or wrong reserves')
    } else {
      console.log('  ✓ quote looks valid')
    }
  } catch (e: any) {
    console.log('  ✗ getAmountOut REVERT:', e.message?.split('\n')[0])
    console.log('  → Pair not initialized in adapter, or min/max swap limits exceeded')
  }

  console.log('\n════════════════════════════════════')
  console.log(' STEP B — Pair info & reserves')
  console.log('════════════════════════════════════')
  try {
    const [pair, r0, r1, swapFee, liquidity] = await adapter.getPairInfo(USDC, WDOT)
    console.log('  pair     :', pair)
    console.log('  reserve0 :', r0.toString())
    console.log('  reserve1 :', r1.toString())
    console.log('  swapFee  :', swapFee.toString())
    console.log('  liquidity:', liquidity.toString())
    if (pair === ethers.ZeroAddress) {
      console.log('  ✗ Pair address is zero — initializePair() was never called')
    }
    if (r0 === 0n || r1 === 0n) {
      console.log('  ✗ One or both reserves are ZERO — no liquidity in the pair')
    }
  } catch (e: any) {
    console.log('  ✗ getPairInfo REVERT:', e.message?.split('\n')[0])
  }

  console.log('\n════════════════════════════════════')
  console.log(' STEP C — Adapter swap limits')
  console.log('════════════════════════════════════')
  try {
    const info = await adapter.getAdapterInfo()
    const amountIn18 = amountIn * BigInt(10 ** 12) // USDC 6dec → 18dec
    console.log('  minSwapAmount:', ethers.formatUnits(info.minSwapAmount, 18))
    console.log('  maxSwapAmount:', ethers.formatUnits(info.maxSwapAmount, 18))
    console.log('  amountIn(18d):', ethers.formatUnits(amountIn18, 18))
    console.log('  isActive     :', info.isActive ? '✓' : '✗ ADAPTER INACTIVE')
    if (amountIn18 < info.minSwapAmount) {
      console.log('  ✗ amountIn BELOW minSwapAmount — increase amount or lower limit')
    } else if (amountIn18 > info.maxSwapAmount) {
      console.log('  ✗ amountIn ABOVE maxSwapAmount — decrease amount or raise limit')
    } else {
      console.log('  ✓ amount within limits')
    }
  } catch (e: any) {
    console.log('  ✗ getAdapterInfo REVERT:', e.message?.split('\n')[0])
  }

  console.log('\n════════════════════════════════════')
  console.log(' STEP D — Adapter swap staticCall')
  console.log(' (simulates what router._executeSwap does)')
  console.log('════════════════════════════════════')
  try {
    // Router first sets allowance then calls swapExactTokensForTokens
    // We simulate: signer → adapter directly (need allowance on adapter)
    const [amountOut] = await adapter.swapExactTokensForTokens.staticCall(
      USDC, WDOT, amountIn, 0n, signer.address, '0x',
      // staticCall from signer: adapter will try safeTransferFrom(signer, pair, amountIn)
    )
    console.log('  ✓ adapter swap static call succeeded, amountOut:', ethers.formatUnits(amountOut, 18), 'WDOT')
  } catch (e: any) {
    console.log('  ✗ adapter.swapExactTokensForTokens REVERT:', e.message?.split('\n')[0])
    if (e.data) console.log('  Data:', e.data)
  }

  console.log('\n════════════════════════════════════')
  console.log(' STEP E — executor.sendParachainAssets staticCall')
  console.log(' (simulates what router calls after local swap)')
  console.log('════════════════════════════════════')
  // Simulate with a mock swapOutput — use a small WDOT amount
  const mockSwapOutput = ethers.parseUnits('1', 18) // 1 WDOT
  const wdotAssetId    = ethers.zeroPadValue(WDOT, 32)
  const xcmFee         = await executor.calculateFee(WESTEND, 1_010_000_000n, mockSwapOutput)
  const assets = [{
    assetId:  wdotAssetId,
    amount:   mockSwapOutput,
    isNative: false,
  }]
  try {
    // executor.sendParachainAssets will try to pull WDOT from caller (router)
    // In staticCall from signer, it'll fail on allowance — but we want to see
    // if it gets past the chain/asset checks first
    await executor.sendParachainAssets.staticCall(
      WESTEND, signer.address, assets, '0x', 3600n,
      { value: xcmFee * 3n }
    )
    console.log('  ✓ sendParachainAssets static call succeeded')
  } catch (e: any) {
    const msg = e.message?.split('\n')[0]
    console.log('  ✗ REVERT:', msg)
    if (e.data) console.log('  Data:', e.data)
    // Distinguish expected vs unexpected reverts
    if (msg?.includes('ERC20') || msg?.includes('allowance') || msg?.includes('transfer')) {
      console.log('  → Expected: no WDOT allowance from signer to executor (router would set this)')
      console.log('  → Chain config and asset mapping are fine')
    }
  }

  console.log('\n════════════════════════════════════')
  console.log(' STEP F — router.crossChainSwap staticCall with verbose trace')
  console.log('════════════════════════════════════')
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)
  const value    = xcmFee * 3n
  try {
    const [swapId, xcmMessageId] = await router.crossChainSwap.staticCall(
      USDC, WDOT, amountIn, 0n, signer.address,
      { adapters: [ADAPTER], path: [USDC, WDOT], isCrossChain: true, destinationChains: [WESTEND] },
      WESTEND, '0x', 3600n, deadline,
      { value }
    )
    console.log('  ✓ Full static call succeeded!')
    console.log('  swapId      :', swapId)
    console.log('  xcmMessageId:', xcmMessageId)
  } catch (e: any) {
    console.log('  ✗ REVERT:', e.message?.split('\n')[0])
    if (e.reason) console.log('  Reason:', e.reason)
    if (e.data)   console.log('  Data:  ', e.data)
    // Try to decode known error selectors
    if (e.data && e.data !== '0x') {
      const knownErrors: Record<string, string> = {
        '0x7939f424': 'TransferFromFailed',
        '0x90b8ec18': 'TransferFailed',
        '0xf4d678b8': 'InsufficientBalance',
        '0xdb4e7c27': 'SlippageExceeded',
        '0x10b56b6a': 'AdapterInactive',
        '0x6f7eac26': 'InvalidAmount',
        '0xb32cf811': 'TokenNotSupported',
      }
      const selector = e.data.slice(0, 10)
      const name = knownErrors[selector]
      console.log('  Error selector:', selector, name ? `→ ${name}` : '(unknown)')
    }
  }
}

main().catch(console.error)