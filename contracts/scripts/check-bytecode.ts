import { ethers } from 'hardhat'

const ROUTER = '0x6c964D065A25047563D0148a22F9eC296513A593'

async function main() {
  const bytecode = await ethers.provider.getCode(ROUTER)
  console.log('Bytecode length:', bytecode.length)
  
  // _directAdapterSwap has a unique string we can search for in the bytecode
  // keccak256("Swap failed at adapter") selector will be in the bytecode if the function exists
  const swapFailedSelector = ethers.id('Swap failed at adapter').slice(0, 10)
  console.log('Looking for "Swap failed at adapter" in bytecode...')
  console.log('Found:', bytecode.includes(swapFailedSelector.slice(2)) ? '✓ NEW CODE DEPLOYED' : '✗ OLD CODE — _directAdapterSwap not found')

  // Also check for the old _executeSwap revert string "Swap failed at adapter" (same)
  // Check for XCM executor not set string
  const xcmNotSetHex = Buffer.from('XCM executor not set').toString('hex')
  console.log('Found "XCM executor not set":', bytecode.includes(xcmNotSetHex) ? '✓' : '✗')

  const directSwapHex = Buffer.from('Path must be cross-chain').toString('hex')
  console.log('Found "Path must be cross-chain":', bytecode.includes(directSwapHex) ? '✓' : '✗')
}

main().catch(console.error)