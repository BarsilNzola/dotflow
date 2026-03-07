/**
 * CrossChainStatus.tsx
 *
 * Full-screen overlay (or card) showing the 4-stage cross-chain swap progress:
 *
 *  ① Approve       — user signs ERC-20 approval
 *  ② Swap on Hub   — USDC→WDOT on Uniswap V2 pair
 *  ③ XCM Dispatch  — CrossChainExecutor.sendParachainAssets → xcmSend
 *  ④ Destination   — polling getMessageStatus until Executed
 */

import { type CrossChainTx, type CrossChainStage } from '../../hooks/useCrossChainSwap'
import { CheckCircleIcon, ClockIcon, XCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

// ─── Stage metadata ────────────────────────────────────────────────────────────

interface StageInfo {
  id:       CrossChainStage | CrossChainStage[]
  label:    string
  sublabel: string
}

const STAGES: StageInfo[] = [
  {
    id:       ['approving', 'approved'],
    label:    '① Approve',
    sublabel: 'Sign ERC-20 approval for the router',
  },
  {
    id:       'swapping',
    label:    '② Swap on Hub',
    sublabel: 'USDC → WDOT via Uniswap V2 pair',
  },
  {
    id:       'xcm_dispatching',
    label:    '③ XCM Dispatch',
    sublabel: 'Locking tokens & sending XCM message',
  },
  {
    id:       ['xcm_pending', 'xcm_executed'],
    label:    '④ Destination Chain',
    sublabel: 'Waiting for execution on destination',
  },
]

// ─── Stage progress helpers ────────────────────────────────────────────────────

const STAGE_ORDER: CrossChainStage[] = [
  'approving', 'approved', 'swapping',
  'xcm_dispatching', 'xcm_pending', 'xcm_executed',
]

function stageIndex(stage: CrossChainStage): number {
  return STAGE_ORDER.indexOf(stage)
}

function stepStatus(
  stepStages: CrossChainStage | CrossChainStage[],
  currentStage: CrossChainStage,
  failed: boolean
): 'done' | 'active' | 'waiting' | 'failed' {
  const stages = Array.isArray(stepStages) ? stepStages : [stepStages]
  const maxIdx = Math.max(...stages.map(stageIndex))
  const curIdx = stageIndex(currentStage)

  if (failed && stages.some(s => s === currentStage)) return 'failed'
  if (curIdx > maxIdx)                                  return 'done'
  if (stages.includes(currentStage))                    return 'active'
  return 'waiting'
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: 'done' | 'active' | 'waiting' | 'failed' }) {
  if (status === 'done')    return <CheckCircleIcon className="w-7 h-7 text-green-400" />
  if (status === 'active')  return <ArrowPathIcon   className="w-7 h-7 text-blue-400 animate-spin" />
  if (status === 'failed')  return <XCircleIcon     className="w-7 h-7 text-red-400" />
  return <ClockIcon className="w-7 h-7 text-gray-500" />
}

function TxLink({ hash, label }: { hash?: string; label: string }) {
  if (!hash) return null
  const url = `https://blockscout-westend.polkadot.io/tx/${hash}`
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-blue-400 hover:underline truncate max-w-[180px]"
    >
      {label}: {hash.slice(0, 10)}…
    </a>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

interface Props {
  tx:      CrossChainTx
  onClose: () => void
}

export function CrossChainStatus({ tx, onClose }: Props) {
  const failed   = tx.stage === 'failed'
  const complete = tx.stage === 'xcm_executed'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0f0f13] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">Cross-Chain Swap</h2>
          {(complete || failed) && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-sm"
            >
              Close
            </button>
          )}
        </div>

        {/* Amount summary */}
        <div className="bg-white/5 rounded-xl px-4 py-3 mb-6 text-sm text-gray-300 flex justify-between">
          <span>{tx.amountIn} {tx.tokenIn.slice(0,6)}…</span>
          <span className="text-gray-500">→</span>
          <span>Chain {tx.destinationChain}</span>
          <span className="text-gray-400 text-xs truncate max-w-[100px]">{tx.recipient.slice(0,8)}…</span>
        </div>

        {/* Stage tracker */}
        <div className="space-y-4">
          {STAGES.map((step, i) => {
            const status = stepStatus(step.id, tx.stage, failed)
            return (
              <div key={i} className="flex items-start gap-3">
                <StepIcon status={status} />
                <div className="flex-1 min-w-0">
                  <div className={`font-medium text-sm ${
                    status === 'done'    ? 'text-green-400' :
                    status === 'active'  ? 'text-white' :
                    status === 'failed'  ? 'text-red-400' :
                    'text-gray-500'
                  }`}>
                    {step.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{step.sublabel}</div>

                  {/* Transaction hashes */}
                  {i === 0 && <TxLink hash={tx.approveTxHash} label="Approval" />}
                  {i === 1 && <TxLink hash={tx.swapTxHash}   label="Swap tx"  />}
                  {i === 2 && <TxLink hash={tx.xcmTxHash}    label="XCM tx"   />}
                  {i === 3 && tx.messageId && (
                    <div className="text-xs text-gray-500 mt-0.5 font-mono">
                      Message: {tx.messageId.slice(0, 18)}…
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Error message */}
        {failed && tx.error && (
          <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">
            {tx.error}
          </div>
        )}

        {/* Success message */}
        {complete && (
          <div className="mt-4 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-sm text-green-400 text-center">
            ✅ Tokens arrived on destination chain!
          </div>
        )}

        {/* Pending note */}
        {tx.stage === 'xcm_pending' && (
          <div className="mt-4 text-xs text-gray-500 text-center">
            XCM messages typically take 30–90 seconds. You can safely close this window.
          </div>
        )}
      </div>
    </div>
  )
}
