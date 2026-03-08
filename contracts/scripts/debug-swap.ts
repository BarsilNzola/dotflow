/**
 * npx hardhat run scripts/debug-swap.ts --network polkadothub
 */
import { ethers } from 'hardhat'

const A = {
  router:         '0x955E01C6CfE3D48F752C958DB42da5997C6C3a5F',
  executor:       '0xD21a7497551A05DF3018202aE28AB0056fD2B15b',
  uniswapAdapter: '0xB339908346d5307a16DEcD80bB64e6D1cDB46c0a',
  usdc:           '0x5a5306B699d21c9d6a16A792b266215d550cc338',
  wdot:           '0xE32Abcaa249aB85bC995377E6DDd96f283343B28',
  WESTEND:        420420421,
}

async function main() {
  const [signer] = await ethers.getSigners()
  console.log('Signer:', signer.address)

  const executor = await ethers.getContractAt('CrossChainExecutor', A.executor)
  const router   = await ethers.getContractAt('DotFlowRouter', A.router)
  const usdc     = await ethers.getContractAt('IERC20', A.usdc)
  const amountIn = ethers.parseUnits('10', 6)

  // 1. EXECUTOR_ROLE
  console.log('\n[1] EXECUTOR_ROLE check...')
  try {
    const EXECUTOR_ROLE = await executor.EXECUTOR_ROLE()
    const routerHasRole = await executor.hasRole(EXECUTOR_ROLE, A.router)
    console.log('  Router has EXECUTOR_ROLE:', routerHasRole)
    if (!routerHasRole) console.log('  FIX: executor.grantRole(EXECUTOR_ROLE, router)')
  } catch (e: any) { console.log(' ', e.message) }

  // 2. Normal swap
  console.log('\n[2] Normal swap static call...')
  try {
    const deadline  = BigInt(Math.floor(Date.now() / 1000) + 1800)
    const normalPath = { adapters: [A.uniswapAdapter], path: [A.usdc, A.wdot], isCrossChain: false, destinationChains: [] }
    await router.swap.staticCall(A.usdc, A.wdot, amountIn, 0n, signer.address, normalPath, deadline)
    console.log('  OK')
  } catch (e: any) {
    console.log('  REVERT:', e.message)
    if (e.reason) console.log('  Reason:', e.reason)
    if (e.data)   console.log('  Data:', e.data)
  }

  // 3. XCM fee
  console.log('\n[3] XCM fee...')
  let xcmFeeWithBuffer = 0n
  try {
    const xcmFee = await executor.calculateFee(A.WESTEND, 1_010_000_000n, amountIn)
    xcmFeeWithBuffer = xcmFee * 3n
    console.log('  fee:', ethers.formatEther(xcmFee), 'PAS  (3x =', ethers.formatEther(xcmFeeWithBuffer), ')')
  } catch (e: any) { console.log(' ', e.message) }

  // 4. Allowance
  console.log('\n[4] USDC allowance...')
  try {
    const allowance = await usdc.allowance(signer.address, A.router)
    console.log(' ', ethers.formatUnits(allowance, 6), 'USDC')
    if (allowance < amountIn) {
      await (await usdc.approve(A.router, amountIn)).wait()
      console.log('  Approved')
    }
  } catch (e: any) { console.log(' ', e.message) }

  // 5. CrossChainSwap static call
  console.log('\n[5] CrossChainSwap static call...')
  try {
    const deadline  = BigInt(Math.floor(Date.now() / 1000) + 1800)
    const crossPath = { adapters: [A.uniswapAdapter], path: [A.usdc, A.wdot], isCrossChain: true, destinationChains: [A.WESTEND] }
    await router.crossChainSwap.staticCall(
      A.usdc, A.wdot, amountIn, 0n, signer.address,
      crossPath, A.WESTEND, '0x', 3600n, deadline,
      { value: xcmFeeWithBuffer }
    )
    console.log('  OK')
  } catch (e: any) {
    console.log('  REVERT:', e.message)
    if (e.reason) console.log('  Reason:', e.reason)
    if (e.data)   console.log('  Data:', e.data)
  }
}

main().catch(console.error)