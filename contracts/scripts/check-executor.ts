import { ethers } from 'hardhat'

const ROUTER   = '0x6c964D065A25047563D0148a22F9eC296513A593'
const EXECUTOR = '0x97B4eEc143f98f08c25e9e2960448BaCbe0E78CF'
const USDC     = '0x399ae6bf402a89f18993A97Ff50Bd50A891DaD37'
const WDOT     = '0x38183Ef90FDFed16b6b60254A1A18832e5ea0F23'
const ADAPTER  = '0xcE6e8394eaEBA3dcC320189D750F55e3Bc3De9D9'
const WESTEND  = 420420421

async function main() {
  const [signer] = await ethers.getSigners()
  const router   = await ethers.getContractAt('DotFlowRouter', ROUTER)
  const executor = await ethers.getContractAt('CrossChainExecutor', EXECUTOR)

  // 1. EXECUTOR_ROLE
  console.log('\n[1] EXECUTOR_ROLE...')
  const EXECUTOR_ROLE = await executor.EXECUTOR_ROLE()
  const hasRole = await executor.hasRole(EXECUTOR_ROLE, ROUTER)
  console.log('  Router has EXECUTOR_ROLE:', hasRole ? '✓' : '✗ MISSING — run grantRole')

  // 2. XCM fee
  console.log('\n[2] XCM fee...')
  const amountIn = ethers.parseUnits('10', 6)
  const xcmFee   = await executor.calculateFee(WESTEND, 1_010_000_000n, amountIn)
  const value    = xcmFee * 3n
  console.log('  xcmFee:', ethers.formatEther(xcmFee), 'PAS  (3x =', ethers.formatEther(value), ')')

  // 3. Approve
  console.log('\n[3] Allowance...')
  const usdc = await ethers.getContractAt('IERC20', USDC)
  const allowance = await usdc.allowance(signer.address, ROUTER)
  if (allowance < amountIn) {
    console.log('  Approving...')
    await (await (usdc as any).approve(ROUTER, amountIn)).wait()
    console.log('  ✓ Approved')
  } else {
    console.log('  ✓ Already approved')
  }

  // 4. Chain config on executor
  console.log('\n[4] Chain config for WESTEND...')
  const cfg = await executor.getChainConfig(WESTEND)
  console.log('  chainId:     ', cfg.chainId.toString())
  console.log('  isActive:    ', cfg.isActive ? '✓' : '✗ NOT ACTIVE — run configureChain()')
  console.log('  baseFee:     ', ethers.formatEther(cfg.baseFee), 'PAS')
  console.log('  weightFee:   ', ethers.formatEther(cfg.weightFee), 'PAS')
  console.log('  minFee:      ', ethers.formatEther(cfg.minFee), 'PAS')
  console.log('  xcmRefTime:  ', cfg.xcmRefTime.toString())
  console.log('  xcmProofSize:', cfg.xcmProofSize.toString())

  // 5. Asset mapping — router passes bytes32(uint256(uint160(tokenOut))) as assetId
  console.log('\n[5] Asset mapping for WDOT on WESTEND...')
  const wdotAssetId = ethers.zeroPadValue(WDOT, 32)
  console.log('  Expected assetId:', wdotAssetId)
  const mappedToken = await executor.getTokenForAsset(WESTEND, wdotAssetId)
  if (mappedToken === ethers.ZeroAddress) {
    console.log('  ✗ NOT MAPPED — run mapAsset():')
    console.log(`    executor.mapAsset(${WESTEND}, "${wdotAssetId}", "${WDOT}", 18, false)`)
  } else {
    console.log('  Mapped to token:', mappedToken)
    console.log('  Matches WDOT:   ', mappedToken.toLowerCase() === WDOT.toLowerCase() ? '✓' : '✗ WRONG ADDRESS')
  }

  // 6. XCM executor set on router
  console.log('\n[6] XCM executor on router...')
  try {
    const routerExecutor = await (router as any).getXCMExecutor()
    console.log('  Router xcmExecutor:', routerExecutor)
    console.log('  Matches EXECUTOR:  ', routerExecutor.toLowerCase() === EXECUTOR.toLowerCase() ? '✓' : '✗ MISMATCH — run setXCMExecutor()')
  } catch {
    console.log('  (no getXCMExecutor() getter — verify setXCMExecutor was called with', EXECUTOR, ')')
  }

  // 7. Adapter registered on router
  console.log('\n[7] Adapter registered on router...')
  const activeAdapters: string[] = await router.getActiveAdapters()
  const adapterRegistered = activeAdapters.map(a => a.toLowerCase()).includes(ADAPTER.toLowerCase())
  console.log('  Active adapters:   ', activeAdapters)
  console.log('  ADAPTER registered:', adapterRegistered ? '✓' : '✗ MISSING — run addAdapter()')

  // 8. Static call — the real end-to-end test
  console.log('\n[8] crossChainSwap static call...')
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)
  try {
    await router.crossChainSwap.staticCall(
      USDC, WDOT, amountIn, 0n, signer.address,
      { adapters: [ADAPTER], path: [USDC, WDOT], isCrossChain: true, destinationChains: [WESTEND] },
      WESTEND, '0x', 3600n, deadline,
      { value }
    )
    console.log('  ✓ Static call succeeded!')
  } catch (e: any) {
    console.log('  ✗ REVERT:', e.message?.split('\n')[0])
    if (e.reason) console.log('  Reason:', e.reason)
    if (e.data)   console.log('  Data:  ', e.data)
  }
}

main().catch(console.error)