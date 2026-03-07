/**
 * useCrossChainSwap.ts
 *
 * Hook that handles the full cross-chain swap UI flow:
 *
 *  Stage 1 — Approve (user signs approval tx)
 *  Stage 2 — Swap on Hub (UniswapV2: USDC→WDOT via crossChainSwap)
 *  Stage 3 — XCM Dispatch (CrossChainExecutor.sendParachainAssets emits XCMSent)
 *  Stage 4 — Pending on destination (polling getMessageStatus until Executed)
 *
 * IMPORTANT: DotFlowRouter.crossChainSwap handles XCM internally.
 * Path should contain ONLY the local UniswapV2Adapter — NOT ParachainAdapter.
 */

import { useState, useCallback } from 'react'
import { usePublicClient, useWalletClient, useAccount } from 'wagmi'
import { parseUnits, erc20Abi, type Address, type Hash } from 'viem'
import { CONTRACT_ADDRESSES } from '../contracts/addresses'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CrossChainStage =
  | 'idle'
  | 'approving'
  | 'approved'
  | 'swapping'
  | 'xcm_dispatching'
  | 'xcm_pending'
  | 'xcm_executed'
  | 'failed'

export interface CrossChainTx {
  stage:            CrossChainStage
  approveTxHash?:   Hash
  swapTxHash?:      Hash
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

const crossChainSwapABI = [
  {
    name: 'crossChainSwap',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'tokenIn',            type: 'address' },
      { name: 'tokenOut',           type: 'address' },
      { name: 'amountIn',           type: 'uint256' },
      { name: 'amountOutMin',       type: 'uint256' },
      { name: 'recipient',          type: 'address' },
      {
        name: 'path',
        type: 'tuple',
        components: [
          { name: 'adapters',          type: 'address[]' },
          { name: 'path',              type: 'address[]' },
          { name: 'isCrossChain',      type: 'bool'      },
          { name: 'destinationChains', type: 'uint32[]'  },
        ],
      },
      { name: 'destinationChainId', type: 'uint32'  },
      { name: 'xcmCallData',        type: 'bytes'   },
      { name: 'xcmTimeout',         type: 'uint64'  },
      { name: 'deadline',           type: 'uint256' },
    ],
    outputs: [
      { name: 'swapId',       type: 'bytes32' },
      { name: 'xcmMessageId', type: 'bytes32' },
    ],
  },
] as const

const executorABI = [
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
  const { address: userAddress } = useAccount()
  const publicClient             = usePublicClient()
  const { data: walletClient }   = useWalletClient()

  const [tx, setTx] = useState<CrossChainTx | null>(null)

  const addresses = CONTRACT_ADDRESSES[420420417]

  const setStage = (stage: CrossChainStage, extra?: Partial<CrossChainTx>) =>
    setTx(prev => prev ? { ...prev, stage, ...extra } : null)

  // ── Poll until Executed / Failed / Expired ─────────────────────────────────
  const pollMessageStatus = useCallback(async (messageId: `0x${string}`) => {
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

        if (status === 1) { setStage('xcm_executed');                                   return }
        if (status === 2) { setStage('failed', { error: 'XCM failed on destination' }); return }
        if (status === 3) { setStage('failed', { error: 'Message cancelled' });         return }
        if (status === 4) { setStage('failed', { error: 'Message expired' });           return }
      } catch { /* keep polling */ }
    }
    setStage('failed', { error: 'Timeout waiting for XCM execution' })
  }, [publicClient, addresses.crossChainExecutor])

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
    xcmTimeout?:           number
  }) => {
    if (!userAddress || !walletClient || !publicClient) throw new Error('Wallet not connected')

    const amountInRaw = parseUnits(amountIn, tokenInDecimals)

    setTx({
      stage: 'approving', amountIn, amountOut: '0',
      tokenIn, tokenOut, destinationChain, recipient,
    })

    try {
      // ── Stage 1: Approve ─────────────────────────────────────────────────
      const allowance = await publicClient.readContract({
        address: tokenIn as Address, abi: erc20Abi,
        functionName: 'allowance',
        args: [userAddress, addresses.dotFlowRouter as Address],
      }) as bigint

      if (allowance < amountInRaw) {
        const approveTxHash = await walletClient.writeContract({
          address: tokenIn as Address, abi: erc20Abi,
          functionName: 'approve',
          args: [addresses.dotFlowRouter as Address, amountInRaw],
        })
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash })
        setStage('approved', { approveTxHash })
      } else {
        setStage('approved')
      }

      // ── Stage 2: Calculate XCM fee ───────────────────────────────────────
      // Router._calculateWeight("0x") = 1_010_000_000
      const xcmFee = await publicClient.readContract({
        address: addresses.crossChainExecutor as Address, abi: executorABI,
        functionName: 'calculateFee',
        args: [destinationChain, 1_010_000_000n, amountInRaw],
      }) as bigint

      // 20% buffer so router's internal check always passes
      const xcmFeeWithBuffer = (xcmFee * 120n) / 100n

      // ── Stage 3: crossChainSwap ──────────────────────────────────────────
      // Only UniswapV2Adapter in path — router handles XCM dispatch itself
      setStage('swapping')
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)

      const swapTxHash = await walletClient.writeContract({
        address: addresses.dotFlowRouter as Address,
        abi: crossChainSwapABI,
        functionName: 'crossChainSwap',
        args: [
          tokenIn  as Address,
          tokenOut as Address,
          amountInRaw,
          amountOutMin,
          recipient as Address,
          {
            adapters:          [uniswapAdapterAddress as Address],
            path:              [tokenIn as Address, tokenOut as Address],
            isCrossChain:      true,
            destinationChains: [destinationChain],
          },
          destinationChain,
          '0x',
          BigInt(xcmTimeout),
          deadline,
        ],
        value: xcmFeeWithBuffer,
      })

      setStage('xcm_dispatching', { swapTxHash })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: swapTxHash })

      // ── Stage 4: Extract messageId from CrossChainSwapInitiated event ────
      // CrossChainSwapInitiated(bytes32 swapId, bytes32 xcmMessageId, uint32 destinationChain, uint256 amount)
      // xcmMessageId is the second indexed topic (topics[2])
      const ccEvent = receipt.logs.find(log => log.topics.length >= 3)
      const messageId = (ccEvent?.topics?.[2] ?? null) as `0x${string}` | null

      setStage('xcm_pending', { xcmTxHash: swapTxHash, messageId: messageId ?? undefined })

      if (messageId) await pollMessageStatus(messageId)

    } catch (err: any) {
      setStage('failed', { error: err.shortMessage ?? err.message ?? 'Unknown error' })
      throw err
    }
  }, [userAddress, walletClient, publicClient, addresses, pollMessageStatus])

  const reset = useCallback(() => setTx(null), [])

  return { tx, executeCrossChainSwap, reset }
}