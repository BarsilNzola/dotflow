/**
 * npx hardhat run scripts/fix-pair.ts --network polkadothub
 *
 * The existing pair is corrupted (UniswapV2: K). This script:
 * 1. Checks if we can burn all LP to drain the pair
 * 2. Creates a fresh pair via the factory (new pair address)
 * 3. Adds liquidity at the correct 1 USDC = 0.1 WDOT ratio
 * 4. Initializes the adapter with the new pair
 */
import { ethers } from 'hardhat'

const A = {
  factory:        '0xb2CA69fda5644aCd262EA526181C529882121c9d',
  uniswapAdapter: '0x7f060558E5D67E3Cfebb2d7bB80b410EEC50d5eC',
  usdc:           '0x5a5306B699d21c9d6a16A792b266215d550cc338',
  wdot:           '0xE32Abcaa249aB85bC995377E6DDd96f283343B28',
  oldPair:        '0x49fdc316d4637298B03782a92C9aaD5b35213f04',
}

const pairABI = [
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function token0() view returns (address)',
  'function mint(address to) returns (uint)',
  'function burn(address to) returns (uint,uint)',
  'function swap(uint,uint,address,bytes) external',
  'function balanceOf(address) view returns (uint)',
  'function totalSupply() view returns (uint)',
  'function transfer(address,uint) returns (bool)',
  'function sync() external',
  'function skim(address) external',
]

const factoryABI = [
  'function getPair(address,address) view returns (address)',
  'function createPair(address,address) returns (address)',
]

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', deployer.address)

  const factory = new ethers.Contract(A.factory, factoryABI, deployer)
  const usdc    = await ethers.getContractAt('IERC20', A.usdc)
  const wdot    = await ethers.getContractAt('IERC20', A.wdot)
  const adapter = await ethers.getContractAt('UniswapV2Adapter', A.uniswapAdapter)

  // ── 1. Check old pair state ──────────────────────────────────────────────
  console.log('\n[1] Old pair state...')
  const oldPair   = new ethers.Contract(A.oldPair, pairABI, deployer)
  const oldRes    = await oldPair.getReserves() as [bigint, bigint, number]
  const myLP      = await oldPair.balanceOf(deployer.address) as bigint
  const totalLP   = await oldPair.totalSupply() as bigint
  console.log('  Reserves:', oldRes[0].toString(), '/', oldRes[1].toString())
  console.log('  My LP:', myLP.toString(), '/ Total:', totalLP.toString())

  // ── 2. Try to drain old pair via burn ────────────────────────────────────
  if (myLP > 0n) {
    console.log('\n[2] Burning LP to drain old pair...')
    try {
      await (await oldPair.transfer(A.oldPair, myLP)).wait()
      await (await oldPair.burn(deployer.address)).wait()
      console.log('  ✓ LP burned, tokens recovered')
    } catch (e: any) {
      console.log('  Could not burn LP:', e.message)
    }
  }

  // ── 3. Check USDC/WDOT balances ──────────────────────────────────────────
  console.log('\n[3] Balances after drain...')
  const usdcBal = await usdc.balanceOf(deployer.address) as bigint
  const wdotBal = await wdot.balanceOf(deployer.address) as bigint
  console.log('  USDC:', ethers.formatUnits(usdcBal, 6))
  console.log('  WDOT:', ethers.formatUnits(wdotBal, 10))

  // ── 4. Skim stuck tokens from old pair ───────────────────────────────────
  console.log('\n[4] Skimming stuck tokens from old pair...')
  try {
    await (await oldPair.skim(deployer.address)).wait()
    console.log('  ✓ Skim done')
  } catch (e: any) {
    console.log('  Skim failed (ok):', e.message)
  }

  const usdcBal2 = await usdc.balanceOf(deployer.address) as bigint
  const wdotBal2 = await wdot.balanceOf(deployer.address) as bigint
  console.log('  USDC after skim:', ethers.formatUnits(usdcBal2, 6))
  console.log('  WDOT after skim:', ethers.formatUnits(wdotBal2, 10))

  // ── 5. Get or create a FRESH pair ────────────────────────────────────────
  // We can't create a new pair with the same tokens if one exists.
  // Instead, reset the old pair by minting at the correct ratio.
  console.log('\n[5] Resetting old pair with correct liquidity...')

  // Use 5000 USDC : 500 WDOT = 1 USDC : 0.1 WDOT (price $10/WDOT)
  const usdcAmount = ethers.parseUnits('5000', 6)
  const wdotAmount = ethers.parseUnits('500', 10)

  if (usdcBal2 < usdcAmount) {
    console.error('  ✗ Not enough USDC. Need 5000, have', ethers.formatUnits(usdcBal2, 6))
    process.exit(1)
  }
  if (wdotBal2 < wdotAmount) {
    console.error('  ✗ Not enough WDOT. Need 500, have', ethers.formatUnits(wdotBal2, 10))
    process.exit(1)
  }

  // Transfer to old pair and mint fresh LP
  console.log('  Transferring USDC to pair...')
  await (await (usdc as any).transfer(A.oldPair, usdcAmount)).wait()
  console.log('  Transferring WDOT to pair...')
  await (await (wdot as any).transfer(A.oldPair, wdotAmount)).wait()
  console.log('  Minting LP...')
  await (await oldPair.mint(deployer.address)).wait()

  const newRes = await oldPair.getReserves() as [bigint, bigint, number]
  console.log('  ✓ New reserves:', newRes[0].toString(), '/', newRes[1].toString())

  // ── 6. Test direct swap on pair ──────────────────────────────────────────
  console.log('\n[6] Testing direct pair.swap()...')
  const token0    = await oldPair.token0() as string
  const usdcFirst = token0.toLowerCase() === A.usdc.toLowerCase()

  const testIn  = ethers.parseUnits('10', 6)
  const r0      = usdcFirst ? newRes[0] : newRes[1]
  const r1      = usdcFirst ? newRes[1] : newRes[0]
  const fee     = testIn * 9975n
  const testOut = (fee * r1) / (r0 * 10000n + fee)

  console.log('  Sending 10 USDC, expecting ~', ethers.formatUnits(testOut, 10), 'WDOT')
  await (await (usdc as any).transfer(A.oldPair, testIn)).wait()

  try {
    const a0 = usdcFirst ? 0n : testOut
    const a1 = usdcFirst ? testOut : 0n
    await (await oldPair.swap(a0, a1, deployer.address, '0x')).wait()
    console.log('  ✓ Direct swap succeeded!')
  } catch (e: any) {
    console.log('  ✗ Direct swap failed:', e.message)
    console.log('  This pair is fundamentally broken. Need new tokens.')
    process.exit(1)
  }

  // ── 7. Done — adapter already knows the pair from initializePair in deploy ─
  // DO NOT call syncPair — it calls pair.sync() which corrupts K invariant.
  console.log('\n[7] Skipping syncPair — would corrupt K invariant.')
  console.log('  Adapter cached reserves will update naturally on next swap.')

  console.log('\n✓ Done. Run the health check to confirm everything is good.')
}

main().catch(console.error)