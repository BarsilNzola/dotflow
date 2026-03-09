import { Link } from 'react-router-dom'
import { useEffect, useRef } from 'react'

const TECH_PILLS = ['Polkadot Hub', 'XCM v3', 'EVM', 'SCALE Encoding', 'Uniswap V2', 'Parachains']

const FLOW_STEPS = [
  { step: '01', label: 'Approve', detail: 'Token access granted to adapter' },
  { step: '02', label: 'Swap',    detail: 'Direct pair swap on Polkadot Hub' },
  { step: '03', label: 'Approve', detail: 'WDOT access granted to executor' },
  { step: '04', label: 'Bridge',  detail: 'XCM dispatch to destination chain' },
]

const STATS = [
  { value: 'XCM v3',  label: 'Native Messaging' },
  { value: '~5s',     label: 'Avg Bridge Time'  },
  { value: '0.1 PAS', label: 'Base XCM Fee'     },
  { value: '100%',    label: 'On-Chain'          },
]

export function Home() {
  const gridRef = useRef<HTMLDivElement>(null)

  // subtle parallax dot grid on mouse move
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!gridRef.current) return
      const x = (e.clientX / window.innerWidth  - 0.5) * 12
      const y = (e.clientY / window.innerHeight - 0.5) * 12
      gridRef.current.style.transform = `translate(${x}px, ${y}px)`
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div className="relative overflow-hidden">

      {/* ── Background dot grid ─────────────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden opacity-30">
        <div
          ref={gridRef}
          className="absolute inset-[-10%] transition-transform duration-300 ease-out text-primary"
          style={{
            backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
            backgroundSize: '28px 28px',
          }}
        />
      </div>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[88vh] flex flex-col items-center justify-center text-center px-4 py-24">

        {/* glow blob */}
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[120px] opacity-20"
          style={{ background: 'radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)' }}
        />

        {/* eyebrow */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs font-mono text-primary mb-8 tracking-widest uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Live on Polkadot Hub Testnet
        </div>

        <h1 className="font-black tracking-tight leading-none mb-6" style={{ fontSize: 'clamp(3rem, 10vw, 7rem)' }}>
          Liquidity
          <br />
          <span
            className="relative inline-block"
            style={{
              background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary)/0.5))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            flows.
          </span>
        </h1>

        <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
          The first cross-chain liquidity router on Polkadot Hub.
          Swap on-chain, bridge cross-chain — one interface, native XCM, no wrappers.
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to="/swap"
            className="group relative inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-sm overflow-hidden"
            style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
          >
            <span className="relative z-10">Launch App</span>
            <span className="relative z-10 group-hover:translate-x-1 transition-transform">→</span>
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)/0.8), hsl(var(--primary)))' }}
            />
          </Link>
          <a
            href="https://github.com/your-org/dotflow"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-sm border border-border hover:bg-secondary/60 transition-colors"
          >
            GitHub
          </a>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <section className="border-y border-border/60 py-8 mb-24">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border/60">
          {STATS.map(({ value, label }) => (
            <div key={label} className="text-center px-6 py-2">
              <div className="text-2xl font-black tracking-tight mb-0.5">{value}</div>
              <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="px-4 mb-32 max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-12">
          <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest">How it works</span>
          <div className="flex-1 h-px bg-border/60" />
        </div>

        <div className="grid md:grid-cols-4 gap-0">
          {FLOW_STEPS.map(({ step, label, detail }, i) => (
            <div key={step} className="relative flex flex-col items-center text-center group">
              {/* connector line */}
              {i < FLOW_STEPS.length - 1 && (
                <div className="hidden md:block absolute top-6 left-1/2 w-full h-px bg-border/60 z-0" />
              )}

              <div
                className="relative z-10 w-12 h-12 rounded-full border-2 flex items-center justify-center mb-4 font-mono text-sm font-bold group-hover:border-primary group-hover:text-primary transition-colors"
                style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--background))' }}
              >
                {step}
              </div>
              <div className="font-semibold text-sm mb-1">{label}</div>
              <div className="text-xs text-muted-foreground leading-relaxed px-2">{detail}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Cross-chain callout ───────────────────────────────────────────── */}
      <section className="px-4 mb-32 max-w-4xl mx-auto">
        <div
          className="relative rounded-2xl overflow-hidden p-10 md:p-14"
          style={{ background: 'hsl(var(--primary)/0.06)', border: '1px solid hsl(var(--primary)/0.15)' }}
        >
          {/* corner accent */}
          <div
            className="absolute top-0 right-0 w-64 h-64 rounded-full blur-[80px] opacity-30 pointer-events-none"
            style={{ background: 'hsl(var(--primary))' }}
          />

          <div className="relative grid md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Cross-Chain</div>
              <h2 className="text-3xl font-black tracking-tight mb-4">
                Swap here.<br />Arrive anywhere.
              </h2>
              <p className="text-muted-foreground leading-relaxed text-sm">
                DotFlow swaps your tokens on Polkadot Hub then fires a native XCM message
                to deliver them to any connected parachain. No bridges. No wrapped tokens.
                Just Polkadot doing what it was built for.
              </p>
            </div>

            {/* mini flow diagram */}
            <div className="flex flex-col gap-2 font-mono text-xs">
              {[
                { chain: 'Polkadot Hub',      action: 'USDC → WDOT via Uniswap V2', active: true  },
                { chain: 'XCM Precompile',    action: 'SCALE-encoded message',       active: false },
                { chain: 'Westend Asset Hub', action: 'WDOT received natively',      active: false },
              ].map(({ chain, action, active }) => (
                <div
                  key={chain}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{
                    background: active ? 'hsl(var(--primary)/0.12)' : 'hsl(var(--secondary)/0.5)',
                    borderLeft: active ? '2px solid hsl(var(--primary))' : '2px solid transparent',
                  }}
                >
                  <div>
                    <div className="font-semibold text-foreground">{chain}</div>
                    <div className="text-muted-foreground">{action}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Tech pills ───────────────────────────────────────────────────── */}
      <section className="px-4 mb-32 max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Built with</span>
          <div className="flex-1 h-px bg-border/60" />
        </div>
        <div className="flex flex-wrap gap-2">
          {TECH_PILLS.map(pill => (
            <span
              key={pill}
              className="px-4 py-2 rounded-full text-sm font-mono border border-border/60 hover:border-primary/40 hover:text-primary transition-colors cursor-default"
            >
              {pill}
            </span>
          ))}
        </div>
      </section>

      {/* ── CTA footer ───────────────────────────────────────────────────── */}
      <section className="text-center px-4 py-24 mb-8">
        <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-6">
          Ready to flow?
        </h2>
        <Link
          to="/swap"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity"
          style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
        >
          Start Swapping →
        </Link>
      </section>

    </div>
  )
}