import { useState, useCallback } from 'react'
import { usePublicClient, useWalletClient, useAccount } from 'wagmi'
import { parseUnits, erc20Abi, type Address, type Hash } from 'viem'
import { CONTRACT_ADDRESSES } from '../contracts/addresses'
import { useTransactionStore } from '../store/useTransactionStore'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CrossChainStage =
  | 'idle'
  | 'approving'
  | 'approved'
  | 'swapping'
  | 'swap_done'
  | 'approving_wdot'
  | 'xcm_dispatching'
  | 'xcm_pending'
  | 'xcm_executed'
  | 'failed'

export interface CrossChainTx {
  stage:            CrossChainStage
  approveTxHash?:   Hash
  swapTxHash?:      Hash
  approveWdotHash?: Hash
  xcmTxHash?:       Hash
  messageId?:       `0x${string}`
  error?:           string
  amountIn:         string
  amountOut:        string
  tokenIn:          string
  tokenOut:         string
  destinationChain: number
  recipient:        string
}

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const adapterABI = [
  {
    name: 'swapExactTokensForTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn',      type: 'address' },
      { name: 'tokenOut',     type: 'address' },
      { name: 'amountIn',     type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'recipient',    type: 'address' },
      { name: 'data',         type: 'bytes'   },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'fee',       type: 'uint256' },
    ],
  },
] as const

const executorABI = [
  {
    name: 'sendParachainAssets',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'parachainId', type: 'uint32'  },
      { name: 'recipient',   type: 'address' },
      {
        name: 'assets',
        type: 'tuple[]',
        components: [
          { name: 'assetId',  type: 'bytes32' },
          { name: 'amount',   type: 'uint128' },
          { name: 'isNative', type: 'bool'    },
        ],
      },
      { name: 'callData', type: 'bytes'  },
      { name: 'timeout',  type: 'uint64' },
    ],
    outputs: [{ name: 'messageId', type: 'bytes32' }],
  },
  {
    name: 'getMessageStatus',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'messageId', type: 'bytes32' }],
    outputs: [{ name: 'status',    type: 'uint8'   }],
  },
  {
    name: 'calculateFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'destinationChainId', type: 'uint32'  },
      { name: 'weight',             type: 'uint64'  },
      { name: 'amount',             type: 'uint256' },
    ],
    outputs: [{ name: 'fee', type: 'uint256' }],
  },
] as const

export const MESSAGE_STATUS: Record<number, string> = {
  0: 'Pending',
  1: 'Executed',
  2: 'Failed',
  3: 'Cancelled',
  4: 'Expired',
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCrossChainSwap() {
  const { address: userAddress }             = useAccount()
  const publicClient                         = usePublicClient()
  const { data: walletClient }               = useWalletClient()
  const { addTransaction, updateTransaction } = useTransactionStore()

  const [tx, setTx] = useState<CrossChainTx | null>(null)

  const addresses = CONTRACT_ADDRESSES[420420417]

  const setStage = (stage: CrossChainStage, extra?: Partial<CrossChainTx>) =>
    setTx(prev => prev ? { ...prev, stage, ...extra } : null)

  // ── Poll until Executed / Failed / Expired ─────────────────────────────────
  const pollMessageStatus = useCallback(async (
    messageId:        `0x${string}`,
    xcmTxHash:        Hash,
  ) => {
    if (!publicClient) return
    const MAX_POLLS = 60
    const INTERVAL  = 5_000

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, INTERVAL))
      try {
        const status = await publicClient.readContract({
          address:      addresses.crossChainExecutor as Address,
          abi:          executorABI,
          functionName: 'getMessageStatus',
          args:         [messageId],
        }) as number

        console.log(`[crossChainSwap] poll ${i + 1}: status = ${MESSAGE_STATUS[status] ?? status}`)

        if (status === 1) {
          setStage('xcm_executed')
          updateTransaction(xcmTxHash, { status: 'confirmed' })
          return
        }
        if (status === 2) {
          setStage('failed', { error: 'XCM failed on destination' })
          updateTransaction(xcmTxHash, { status: 'failed' })
          return
        }
        if (status === 3) {
          setStage('failed', { error: 'Message cancelled' })
          updateTransaction(xcmTxHash, { status: 'failed' })
          return
        }
        if (status === 4) {
          setStage('failed', { error: 'Message expired' })
          updateTransaction(xcmTxHash, { status: 'failed' })
          return
        }
      } catch (e) {
        console.warn(`[crossChainSwap] poll ${i + 1} error:`, e)
      }
    }

    setStage('failed', { error: 'Timeout waiting for XCM execution' })
    updateTransaction(xcmTxHash, { status: 'failed' })
  }, [publicClient, addresses.crossChainExecutor, updateTransaction])

  // ── Main execute ───────────────────────────────────────────────────────────
  const executeCrossChainSwap = useCallback(async ({
    tokenIn,
    tokenOut,
    amountIn,
    amountOutMin = 0n,
    destinationChain,
    recipient,
    uniswapAdapterAddress,
    tokenInDecimals = 6,
    tokenOutDecimals: _tokenOutDecimals = 18,
    xcmTimeout = 3600,
  }: {
    tokenIn:               string
    tokenOut:              string
    amountIn:              string
    amountOutMin?:         bigint
    destinationChain:      number
    recipient:             string
    uniswapAdapterAddress: string
    tokenInDecimals?:      number
    tokenOutDecimals?:     number
    xcmTimeout?:           number
  }) => {
    if (!userAddress || !walletClient || !publicClient) throw new Error('Wallet not connected')

    const amountInRaw = parseUnits(amountIn, tokenInDecimals)

    setTx({
      stage: 'approving', amountIn, amountOut: '0',
      tokenIn, tokenOut, destinationChain, recipient,
    })

    console.log('[crossChainSwap] starting direct flow')
    console.log('[crossChainSwap] adapter:', uniswapAdapterAddress)
    console.log('[crossChainSwap] executor:', addresses.crossChainExecutor)
    console.log('[crossChainSwap] amountIn:', amountInRaw.toString())

    try {
      // ── Stage 1: Approve USDC → UniswapV2Adapter ─────────────────────────
      console.log('[crossChainSwap] [1] checking USDC allowance on adapter...')
      const allowance = await publicClient.readContract({
        address:      tokenIn as Address,
        abi:          erc20Abi,
        functionName: 'allowance',
        args:         [userAddress, uniswapAdapterAddress as Address],
      }) as bigint

      if (allowance < amountInRaw) {
        console.log('[crossChainSwap] approving USDC → adapter...')
        const approveTxHash = await walletClient.writeContract({
          address:      tokenIn as Address,
          abi:          erc20Abi,
          functionName: 'approve',
          args:         [uniswapAdapterAddress as Address, amountInRaw],
        })
        console.log('[crossChainSwap] approve tx:', approveTxHash)
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash })
        setStage('approved', { approveTxHash })
        console.log('[crossChainSwap] ✓ USDC approved')
      } else {
        console.log('[crossChainSwap] ✓ USDC already approved')
        setStage('approved')
      }

      // ── Stage 2: Swap USDC → WDOT via adapter directly ───────────────────
      console.log('[crossChainSwap] [2] swapping USDC → WDOT via adapter...')
      setStage('swapping')

      let swapTxHash: Hash
      try {
        swapTxHash = await walletClient.writeContract({
          address:      uniswapAdapterAddress as Address,
          abi:          adapterABI,
          functionName: 'swapExactTokensForTokens',
          gas:          300_000n,
          args: [
            tokenIn  as Address,
            tokenOut as Address,
            amountInRaw,
            amountOutMin,
            userAddress,
            '0x',
          ],
        })
        console.log('[crossChainSwap] swap tx:', swapTxHash)
      } catch (e: any) {
        console.error('[crossChainSwap] swap FAILED:', e)
        throw e
      }

      const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapTxHash })
      console.log('[crossChainSwap] swap receipt status:', swapReceipt.status)
      console.log('[crossChainSwap] swap gasUsed:', swapReceipt.gasUsed.toString())

      if (swapReceipt.status === 'reverted') {
        throw new Error(`Swap reverted on-chain (tx: ${swapTxHash})`)
      }

      setStage('swap_done', { swapTxHash })
      console.log('[crossChainSwap] ✓ swap done')

      // ── Read WDOT balance ──
      const wdotBalance = await publicClient.readContract({
        address:      tokenOut as Address,
        abi:          erc20Abi,
        functionName: 'balanceOf',
        args:         [userAddress],
      }) as bigint

      console.log('[crossChainSwap] WDOT balance after swap:', wdotBalance.toString())

      if (wdotBalance === 0n) throw new Error('Swap produced 0 WDOT — check pair liquidity')

      const wdotToSend = wdotBalance

      // ── Stage 3: Calculate XCM fee ──
      const xcmFee = await publicClient.readContract({
        address:      addresses.crossChainExecutor as Address,
        abi:          executorABI,
        functionName: 'calculateFee',
        args:         [destinationChain, 1_010_000_000n, wdotToSend],
      }) as bigint

      const xcmFeeWithBuffer = (xcmFee * 120n) / 100n
      console.log('[crossChainSwap] xcmFee:', xcmFee.toString(), 'with buffer:', xcmFeeWithBuffer.toString())

      // ── Stage 4: Approve WDOT → CrossChainExecutor ──
      console.log('[crossChainSwap] [3] checking WDOT allowance on executor...')
      setStage('approving_wdot')

      const wdotAllowance = await publicClient.readContract({
        address:      tokenOut as Address,
        abi:          erc20Abi,
        functionName: 'allowance',
        args:         [userAddress, addresses.crossChainExecutor as Address],
      }) as bigint

      if (wdotAllowance < wdotToSend) {
        console.log('[crossChainSwap] approving WDOT → executor...')
        const approveWdotHash = await walletClient.writeContract({
          address:      tokenOut as Address,
          abi:          erc20Abi,
          functionName: 'approve',
          args:         [addresses.crossChainExecutor as Address, wdotToSend],
        })
        console.log('[crossChainSwap] WDOT approve tx:', approveWdotHash)
        await publicClient.waitForTransactionReceipt({ hash: approveWdotHash })
        setStage('approving_wdot', { approveWdotHash })
        console.log('[crossChainSwap] ✓ WDOT approved')
      } else {
        console.log('[crossChainSwap] ✓ WDOT already approved')
      }

      // ── Stage 5: sendParachainAssets ──
      const wdotAssetId = `0x${tokenOut.toLowerCase().replace('0x', '').padStart(64, '0')}` as `0x${string}`

      console.log('[crossChainSwap] [4] dispatching XCM...')
      setStage('xcm_dispatching')

      let xcmTxHash: Hash
      try {
        xcmTxHash = await walletClient.writeContract({
          address:      addresses.crossChainExecutor as Address,
          abi:          executorABI,
          functionName: 'sendParachainAssets',
          gas:          500_000n,
          value:        xcmFeeWithBuffer,
          args: [
            destinationChain,
            recipient as Address,
            [{ assetId: wdotAssetId, amount: wdotToSend, isNative: false }],
            '0x',
            BigInt(xcmTimeout),
          ],
        })
        console.log('[crossChainSwap] XCM tx:', xcmTxHash)
      } catch (e: any) {
        console.error('[crossChainSwap] XCM dispatch FAILED:', e)
        throw e
      }

      const xcmReceipt = await publicClient.waitForTransactionReceipt({ hash: xcmTxHash })
      console.log('[crossChainSwap] XCM receipt status:', xcmReceipt.status)
      console.log('[crossChainSwap] XCM gasUsed:', xcmReceipt.gasUsed.toString())

      if (xcmReceipt.status === 'reverted') {
        throw new Error(`XCM dispatch reverted on-chain (tx: ${xcmTxHash})`)
      }

      // ── Record in transaction store → shows up in Dashboard ──
      addTransaction({
        hash:        xcmTxHash,
        type:        'cross-chain-swap',
        status:      'pending',
        from:        userAddress,
        to:          addresses.crossChainExecutor,
        value:       amountInRaw,
        timestamp:   Date.now(),
        description: `Cross-chain swap ${amountIn} → Chain ${destinationChain}`,
      })

      // ── Extract messageId from executor logs ──
      let messageId: `0x${string}` | null = null
      for (const log of xcmReceipt.logs) {
        if (
          log.address.toLowerCase() === addresses.crossChainExecutor.toLowerCase() &&
          log.topics.length >= 2 && log.topics[1]
        ) {
          messageId = log.topics[1] as `0x${string}`
          console.log('[crossChainSwap] ✓ found messageId:', messageId)
          break
        }
      }

      if (!messageId) {
        throw new Error(`XCM tx mined but no messageId found in logs. tx: ${xcmTxHash}`)
      }

      // ── Stage 6: poll for execution on destination ──
      setStage('xcm_pending', { xcmTxHash, messageId })
      await pollMessageStatus(messageId, xcmTxHash)

    } catch (err: any) {
      console.error('[crossChainSwap] FAILED:', err)
      setStage('failed', { error: err.shortMessage ?? err.message ?? 'Unknown error' })
      throw err
    }
  }, [userAddress, walletClient, publicClient, addresses, addTransaction, pollMessageStatus])

  const reset = useCallback(() => setTx(null), [])

  return { tx, executeCrossChainSwap, reset }
}