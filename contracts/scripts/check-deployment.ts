/**
 * Checks every prerequisite for crossChainSwap to succeed:
 *  1. Pair exists and has reserves
 *  2. UniswapV2Adapter has the pair initialized
 *  3. CrossChainExecutor has chain + asset configured
 *  4. Router has executor set
 *  5. Quote succeeds end-to-end
 */
import { ethers } from 'hardhat'

const ADDRESSES = {
  router:           '0x955E01C6CfE3D48F752C958DB42da5997C6C3a5F',
  executor:         '0xD21a7497551A05DF3018202aE28AB0056fD2B15b',
  uniswapAdapter:   '0xB339908346d5307a16DEcD80bB64e6D1cDB46c0a',
  parachainAdapter: '0x764b1777E66a1aCCd87aC83ffEd35E0141230B82',
  usdc:             '0x5a5306B699d21c9d6a16A792b266215d550cc338',
  wdot:             '0xE32Abcaa249aB85bC995377E6DDd96f283343B28',
  uniswapFactory:   '0xb2CA69fda5644aCd262EA526181C529882121c9d',
  WESTEND_CHAIN_ID: 420420421,
}

async function main() {
  const [signer] = await ethers.getSigners()
  console.log('\n=== DotFlow Deployment Health Check ===\n')

  // ── 1. Pair reserves ────────────────────────────────────────────────────────
  console.log('[1] Uniswap pair reserves...')
  const factory = await ethers.getContractAt(
    'contracts/adapters/UniswapV2Adapter.sol:IUniswapV2Factory',
    ADDRESSES.uniswapFactory
  )
  const pairAddr = await factory.getPair(ADDRESSES.usdc, ADDRESSES.wdot)
  if (pairAddr === ethers.ZeroAddress) {
    console.log('  ✗ PAIR DOES NOT EXIST — run deploy script to create it')
  } else {
    console.log(`  Pair address: ${pairAddr}`)
    const pair = await ethers.getContractAt([
      'function getReserves() view returns (uint112,uint112,uint32)',
      'function token0() view returns (address)',
    ], pairAddr)
    const [r0, r1] = await pair.getReserves()
    const t0 = await pair.token0()
    const isUSDCFirst = t0.toLowerCase() === ADDRESSES.usdc.toLowerCase()
    const usdcReserve = isUSDCFirst ? r0 : r1
    const wdotReserve = isUSDCFirst ? r1 : r0
    if (r0 === 0n && r1 === 0n) {
      console.log('  ✗ PAIR HAS NO LIQUIDITY — add liquidity before swapping')
    } else {
      console.log(`  ✓ USDC reserve: ${ethers.formatUnits(usdcReserve, 6)}`)
      console.log(`  ✓ WDOT reserve: ${ethers.formatUnits(wdotReserve, 10)}`)
    }
  }

  // ── 2. UniswapV2Adapter pair initialized ────────────────────────────────────
  console.log('\n[2] UniswapV2Adapter pair initialized...')
  const adapter = await ethers.getContractAt('UniswapV2Adapter', ADDRESSES.uniswapAdapter)
  try {
    const [amtOut] = await adapter.getAmountOut(ADDRESSES.usdc, ADDRESSES.wdot, ethers.parseUnits('10', 6))
    console.log(`  ✓ Quote 10 USDC → ${ethers.formatUnits(amtOut, 10)} WDOT`)
  } catch (e: any) {
    console.log(`  ✗ getAmountOut failed: ${e.message}`)
    console.log('  → Fix: call uniswapAdapter.initializePair(usdc, wdot)')
  }

  // ── 3. CrossChainExecutor chain configured ──────────────────────────────────
  console.log('\n[3] CrossChainExecutor chain config...')
  const executor = await ethers.getContractAt('CrossChainExecutor', ADDRESSES.executor)
  try {
    const fee = await executor.calculateFee(ADDRESSES.WESTEND_CHAIN_ID, 1_010_000_000n, 0n)
    if (fee === ethers.MaxUint256) {
      console.log('  ✗ Chain NOT configured (returns MaxUint256)')
      console.log('  → Fix: call executor.configureChain(420420421, ...)')
    } else {
      console.log(`  ✓ XCM fee for Westend: ${ethers.formatEther(fee)} PAS`)
    }
  } catch (e: any) {
    console.log(`  ✗ calculateFee failed: ${e.message}`)
  }

  // ── 4. CrossChainExecutor asset mapped ─────────────────────────────────────
  console.log('\n[4] CrossChainExecutor asset mapping (WDOT on Westend)...')
  const assetId = ethers.zeroPadValue(ethers.toBeHex(ADDRESSES.wdot), 32)
  try {
    const mapped = await executor.getTokenForAsset(ADDRESSES.WESTEND_CHAIN_ID, assetId)
    if (mapped === ethers.ZeroAddress) {
      console.log('  ✗ WDOT NOT MAPPED on Westend chain')
      console.log('  → Fix: call executor.mapAsset(420420421, assetId, wdot, 10, false)')
    } else {
      console.log(`  ✓ WDOT mapped: ${mapped}`)
    }
  } catch (e: any) {
    console.log(`  ✗ getTokenAddress failed: ${e.message}`)
  }

  // ── 5. Router has executor set ──────────────────────────────────────────────
  console.log('\n[5] Router XCM executor...')
  const router = await ethers.getContractAt('DotFlowRouter', ADDRESSES.router)
  try {
    const adapters = await router.getActiveAdapters()
    console.log(`  ✓ Active adapters: ${adapters.length}`)
    adapters.forEach((a: string) => console.log(`    - ${a}`))
  } catch (e: any) {
    console.log(`  ✗ getActiveAdapters failed: ${e.message}`)
  }

  // ── 6. Full router quote ────────────────────────────────────────────────────
  console.log('\n[6] Router getAmountOut (end-to-end quote)...')
  try {
    const [amtOut, totalFee] = await router.getAmountOut(
      ADDRESSES.usdc, ADDRESSES.wdot,
      ethers.parseUnits('100', 6),
      {
        adapters: [ADDRESSES.uniswapAdapter],
        path: [ADDRESSES.usdc, ADDRESSES.wdot],
        isCrossChain: true,
        destinationChains: [ADDRESSES.WESTEND_CHAIN_ID],
      }
    )
    console.log(`  ✓ 100 USDC → ${ethers.formatUnits(amtOut, 10)} WDOT (fee: ${ethers.formatUnits(totalFee, 10)})`)
  } catch (e: any) {
    console.log(`  ✗ Router quote failed: ${e.message}`)
  }

  console.log('\n=== Done ===\n')
}

main().catch(console.error)