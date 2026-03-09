/**
 * Full-screen overlay showing the 4-stage cross-chain swap progress.
 */
import { type CrossChainTx, type CrossChainStage } from '../../hooks/useCrossChainSwap'

interface StageInfo {
  id:       CrossChainStage | CrossChainStage[]
  label:    string
  sublabel: string
}

const STAGES: StageInfo[] = [
  { id: ['approving', 'approved'], label: 'Approve',        sublabel: 'Sign ERC-20 approval for the adapter'      },
  { id: 'swapping',               label: 'Swap on Hub',    sublabel: 'USDC → WDOT via Uniswap V2 pair'           },
  { id: ['approving_wdot'],       label: 'Approve WDOT',   sublabel: 'Sign ERC-20 approval for the executor'     },
  { id: 'xcm_dispatching',        label: 'XCM Dispatch',   sublabel: 'Locking tokens & sending XCM message'      },
  { id: 'xcm_pending',            label: 'Destination',    sublabel: 'Waiting for execution on destination chain' },
]

const STAGE_ORDER: CrossChainStage[] = [
  'approving', 'approved', 'swapping', 'swap_done',
  'approving_wdot', 'xcm_dispatching', 'xcm_pending', 'xcm_executed', 'failed',
]

function stageIndex(s: CrossChainStage) { return STAGE_ORDER.indexOf(s) }

function stepStatus(
  stepStages: CrossChainStage | CrossChainStage[],
  currentStage: CrossChainStage,
  failed: boolean
): 'done' | 'active' | 'waiting' | 'failed' {
  const stages = Array.isArray(stepStages) ? stepStages : [stepStages]
  const maxIdx = Math.max(...stages.map(stageIndex))
  const curIdx = stageIndex(currentStage)
  if (failed && stages.some(s => s === currentStage)) return 'failed'
  if (curIdx > maxIdx)          return 'done'
  if (stages.includes(currentStage)) return 'active'
  return 'waiting'
}

function StepDot({ status }: { status: 'done' | 'active' | 'waiting' | 'failed' }) {
  if (status === 'done') return (
    <div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/40 flex items-center justify-center shrink-0">
      <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  )
  if (status === 'active') return (
    <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center shrink-0">
      <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
    </div>
  )
  if (status === 'failed') return (
    <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/40 flex items-center justify-center shrink-0">
      <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  )
  return (
    <div className="w-8 h-8 rounded-full border border-border flex items-center justify-center shrink-0">
      <div className="w-2 h-2 rounded-full bg-border" />
    </div>
  )
}

function TxLink({ hash, label }: { hash?: string; label: string }) {
  if (!hash) return null
  return (
    <a
      href={`https://blockscout-westend.polkadot.io/tx/${hash}`}
      target="_blank" rel="noopener noreferrer"
      className="font-mono text-[10px] text-primary hover:underline truncate"
    >
      {label}: {hash.slice(0, 12)}…
    </a>
  )
}

interface Props { tx: CrossChainTx; onClose: () => void }

export function CrossChainStatus({ tx, onClose }: Props) {
  const failed   = tx.stage === 'failed'
  const complete = tx.stage === 'xcm_executed'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="swap-card w-full max-w-md shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div>
            <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">In progress</div>
            <h2 className="font-bold text-base">Cross-Chain Swap</h2>
          </div>
          {(complete || failed) && (
            <button onClick={onClose} className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors">
              Close ✕
            </button>
          )}
        </div>

        {/* Amount row */}
        <div className="px-6 py-4 border-b border-border flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span className="text-foreground font-semibold">{tx.amountIn} {tx.tokenIn.slice(0, 8)}…</span>
          <span>→</span>
          <span>Chain {tx.destinationChain}</span>
          <span className="ml-auto truncate max-w-[100px]">{tx.recipient.slice(0, 10)}…</span>
        </div>

        {/* Stages */}
        <div className="px-6 py-5 space-y-5">
          {STAGES.map((step, i) => {
            const status = stepStatus(step.id, tx.stage, failed)
            return (
              <div key={i} className="flex items-start gap-3">
                <StepDot status={status} />
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className={`text-sm font-semibold leading-none mb-1 ${
                    status === 'done'   ? 'text-green-500' :
                    status === 'active' ? 'text-foreground' :
                    status === 'failed' ? 'text-red-500' :
                    'text-muted-foreground'
                  }`}>
                    {step.label}
                  </div>
                  <div className="text-xs text-muted-foreground">{step.sublabel}</div>
                  <div className="mt-1">
                    {i === 0 && <TxLink hash={tx.approveTxHash}   label="Approval tx" />}
                    {i === 1 && <TxLink hash={tx.swapTxHash}      label="Swap tx"     />}
                    {i === 3 && <TxLink hash={tx.xcmTxHash}       label="XCM tx"      />}
                    {i === 4 && tx.messageId && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        msg: {tx.messageId.slice(0, 18)}…
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer states */}
        {failed && tx.error && (
          <div className="mx-6 mb-5 bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-3 font-mono text-xs text-red-500">
            {tx.error}
          </div>
        )}
        {complete && (
          <div className="mx-6 mb-5 bg-green-500/5 border border-green-500/20 rounded-xl px-4 py-3 text-sm text-green-500 text-center font-semibold">
            Tokens arrived on destination chain ✓
          </div>
        )}
        {tx.stage === 'xcm_pending' && (
          <div className="px-6 pb-5 font-mono text-[10px] text-muted-foreground text-center">
            XCM messages typically settle in 30–90 seconds.
          </div>
        )}
      </div>
    </div>
  )
}
