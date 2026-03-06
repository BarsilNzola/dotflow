/**
 * diagnoseSwap.ts
 * 
 * Paste this into your browser console (or run as a script with viem + wagmi already imported)
 * to trace EXACTLY which step in the swap chain is reverting.
 * 
 * Replace the constants at the top with your current deployed addresses.
 */

import { createPublicClient, http, parseUnits, formatUnits, erc20Abi } from 'viem'
import type { Address } from 'viem'

// ─── CONFIG — update these ───────────────────────────────────────────────────
const ROUTER         = '0xf35B4d277AbFd46f71A838a72b33ad58f304E09B' as Address
const ADAPTER        = '0x448928adc4a26aE816B8CB343305c4136a91dfEd' as Address
const UNISWAP_ROUTER = '0x4288D462626ba3e7761A9aF2A7281f1f6F949Afb' as Address
const USDC           = '0x5a5306B699d21c9d6a16A792b266215d550cc338' as Address
const WDOT           = '0xE32Abcaa249aB85bC995377E6DDd96f283343B28' as Address
const USER           = '0x8a4F565EB4af450C88958333bD95fDb140c0f5CE' as Address
const AMOUNT_IN   = parseUnits('100', 6)   // 100 USDC
const AMOUNT_OUT_MIN = 0n                  // 0 for diagnosis — we don't want slippage masking the real error
// ─────────────────────────────────────────────────────────────────────────────

const adapterABI = [
  { name: 'isActive',          type: 'function', stateMutability: 'view',       inputs: [],                                                                   outputs: [{ type: 'bool' }] },
  { name: 'isTokenSupported',  type: 'function', stateMutability: 'view',       inputs: [{ name: 'token', type: 'address' }],                                  outputs: [{ type: 'bool' }] },
  { name: 'getPairInfo',       type: 'function', stateMutability: 'view',       inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }], outputs: [{ type: 'address' }, { type: 'uint112' }, { type: 'uint112' }, { type: 'uint24' }, { type: 'uint256' }] },
  { name: 'minSwapAmount',     type: 'function', stateMutability: 'view',       inputs: [],                                                                   outputs: [{ type: 'uint256' }] },
  { name: 'maxSwapAmount',     type: 'function', stateMutability: 'view',       inputs: [],                                                                   outputs: [{ type: 'uint256' }] },
  { name: 'getAmountOut',      type: 'function', stateMutability: 'view',       inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }], outputs: [{ type: 'uint256' }, { type: 'uint24' }, { type: 'uint256' }] },
  { name: 'swapExactTokensForTokens', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' }, { name: 'recipient', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
] as const

const uniswapABI = [
  { name: 'getAmountsOut', type: 'function', stateMutability: 'view', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], outputs: [{ name: 'amounts', type: 'uint256[]' }] },
  { name: 'swapExactTokensForTokens', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256[]' }] },
] as const

const uniswapPairABI = [
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }] },
  { name: 'token0',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'allowance',   type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

export async function diagnoseSwap(publicClient: ReturnType<typeof createPublicClient>) {
  console.log('\n🏥 ========== SWAP DIAGNOSIS ==========\n')

  // ── 1. ERC20 state ──────────────────────────────────────────────────────────
  console.log('1️⃣  ERC20 STATE')
  const usdcBalance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [USER] })
  const routerAllowance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'allowance', args: [USER, ROUTER] })
  const adapterAllowanceFromRouter = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'allowance', args: [ROUTER, ADAPTER] })
  const adapterUSDCBalance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [ADAPTER] })
  const adapterWDOTBalance = await publicClient.readContract({ address: WDOT, abi: erc20Abi, functionName: 'balanceOf', args: [ADAPTER] })
  const uniswapAllowanceFromAdapter = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'allowance', args: [ADAPTER, UNISWAP_ROUTER] })

  console.log(`   User USDC balance:                 ${formatUnits(usdcBalance as bigint, 6)} USDC`)
  console.log(`   User → Router allowance:           ${formatUnits(routerAllowance as bigint, 6)} USDC  ${(routerAllowance as bigint) >= AMOUNT_IN ? '✅' : '❌ INSUFFICIENT'}`)
  console.log(`   Router → Adapter allowance:        ${formatUnits(adapterAllowanceFromRouter as bigint, 6)} USDC  (set dynamically in _executeSwap)`)
  console.log(`   Adapter → UniswapRouter allowance: ${formatUnits(uniswapAllowanceFromAdapter as bigint, 6)} USDC`)
  console.log(`   Adapter USDC balance:              ${formatUnits(adapterUSDCBalance as bigint, 6)} USDC`)
  console.log(`   Adapter WDOT balance:              ${formatUnits(adapterWDOTBalance as bigint, 10)} WDOT`)

  // ── 2. Adapter state ────────────────────────────────────────────────────────
  console.log('\n2️⃣  ADAPTER STATE')
  const isActive = await publicClient.readContract({ address: ADAPTER, abi: adapterABI, functionName: 'isActive' })
  const usdcSupported = await publicClient.readContract({ address: ADAPTER, abi: adapterABI, functionName: 'isTokenSupported', args: [USDC] })
  const wdotSupported = await publicClient.readContract({ address: ADAPTER, abi: adapterABI, functionName: 'isTokenSupported', args: [WDOT] })
  const minSwap = await publicClient.readContract({ address: ADAPTER, abi: adapterABI, functionName: 'minSwapAmount' })
  const maxSwap = await publicClient.readContract({ address: ADAPTER, abi: adapterABI, functionName: 'maxSwapAmount' })
  const pairInfo = await publicClient.readContract({ address: ADAPTER, abi: adapterABI, functionName: 'getPairInfo', args: [USDC, WDOT] }) as [Address, bigint, bigint, number, bigint]

  // Check if amountIn passes limit check (limits in 18d, amountIn needs normalising)
  const amountIn18 = AMOUNT_IN * 10n ** 12n  // USDC is 6d → 18d
  const limitsOk = amountIn18 >= (minSwap as bigint) && amountIn18 <= (maxSwap as bigint)

  console.log(`   Active:           ${isActive}`)
  console.log(`   USDC supported:   ${usdcSupported}`)
  console.log(`   WDOT supported:   ${wdotSupported}`)
  console.log(`   minSwap (18d):    ${minSwap}`)
  console.log(`   maxSwap (18d):    ${maxSwap}`)
  console.log(`   amountIn (18d):   ${amountIn18}`)
  console.log(`   Limits check:     ${limitsOk ? '✅ PASS' : '❌ FAIL — amountIn outside [min, max]'}`)
  console.log(`   Pair address:     ${pairInfo[0]}  ${pairInfo[0] === '0x0000000000000000000000000000000000000000' ? '❌ ZERO — pair not initialized!' : '✅'}`)
  console.log(`   reserve0 (USDC):  ${formatUnits(pairInfo[1], 6)}`)
  console.log(`   reserve1 (WDOT):  ${formatUnits(pairInfo[2], 10)}`)
  console.log(`   liquidity:        ${pairInfo[4]}`)

  // ── 3. Uniswap pair state ───────────────────────────────────────────────────
  console.log('\n3️⃣  UNISWAP PAIR STATE')
  if (pairInfo[0] !== '0x0000000000000000000000000000000000000000') {
    const pairAddr = pairInfo[0]
    const reserves = await publicClient.readContract({ address: pairAddr, abi: uniswapPairABI, functionName: 'getReserves' }) as [bigint, bigint, number]
    const token0   = await publicClient.readContract({ address: pairAddr, abi: uniswapPairABI, functionName: 'token0' }) as Address
    const token1   = await publicClient.readContract({ address: pairAddr, abi: uniswapPairABI, functionName: 'token1' }) as Address

    console.log(`   Pair:     ${pairAddr}`)
    console.log(`   token0:   ${token0}  (${token0.toLowerCase() === USDC.toLowerCase() ? 'USDC' : 'WDOT'})`)
    console.log(`   token1:   ${token1}  (${token1.toLowerCase() === WDOT.toLowerCase() ? 'WDOT' : 'USDC'})`)
    console.log(`   reserve0: ${reserves[0]}`)
    console.log(`   reserve1: ${reserves[1]}`)
    console.log(`   Reserves non-zero: ${reserves[0] > 0n && reserves[1] > 0n ? '✅' : '❌ EMPTY POOL — no liquidity!'}`)

    // Also check raw pair K invariant
    const k = reserves[0] * reserves[1]
    console.log(`   K = reserve0 * reserve1: ${k.toString()}`)
  } else {
    console.log('   ⏭️  Skipped — pair address is zero')
  }

  // ── 4. Adapter getAmountOut simulation ──────────────────────────────────────
  console.log('\n4️⃣  ADAPTER getAmountOut (view call)')
  try {
    const result = await publicClient.readContract({
      address: ADAPTER,
      abi: adapterABI,
      functionName: 'getAmountOut',
      args: [USDC, WDOT, AMOUNT_IN]
    }) as [bigint, number, bigint]
    console.log(`   amountOut:   ${formatUnits(result[0], 10)} WDOT  ✅`)
    console.log(`   fee:         ${result[1]}`)
    console.log(`   priceImpact: ${result[2]}`)
  } catch (e: any) {
    console.log(`   ❌ FAILED: ${e.message}`)
  }

  // ── 5. Adapter swapExactTokensForTokens simulation (from router's perspective) ──
  console.log('\n5️⃣  ADAPTER swapExactTokensForTokens SIMULATION (caller = router)')
  try {
    const { result } = await publicClient.simulateContract({
      address: ADAPTER,
      abi: adapterABI,
      functionName: 'swapExactTokensForTokens',
      args: [USDC, WDOT, AMOUNT_IN, AMOUNT_OUT_MIN, ROUTER, '0x'],
      account: ROUTER,
    })
    console.log(`   ✅ Adapter simulation succeeded! amountOut=${result[0]}, fee=${result[1]}`)
  } catch (e: any) {
    console.log(`   ❌ FAILED: ${e.message}`)
    if (e.cause?.data) console.log(`   Error data: ${e.cause.data}`)
  }

  console.log('\n🏁 ========== DIAGNOSIS COMPLETE ==========')
  console.log('Look for ❌ above — the first failure is your revert cause.\n')
}