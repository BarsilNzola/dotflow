import { Link } from 'react-router-dom'
import { ArrowPathIcon, GlobeAltIcon, BanknotesIcon } from '@heroicons/react/24/outline'

const features = [
  {
    name: 'Cross-Chain XCM Swaps',
    description: 'Swap assets across Polkadot parachains using native XCM technology.',
    icon: GlobeAltIcon
  },
  {
    name: 'Optimal Routing',
    description: 'Smart routing across multiple DEXes and liquidity sources on Polkadot Hub.',
    icon: ArrowPathIcon
  },
  {
    name: 'Parachain Liquidity',
    description: 'Access liquidity from Acala, Moonbeam, Astar and more parachains.',
    icon: BanknotesIcon
  }
]

export function Home() {
  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section className="text-center space-y-6 py-16">
        <h1 className="text-5xl font-bold">
          DotFlow: Cross-Chain Liquidity Router
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          The first liquidity router built on Polkadot Hub. Swap assets seamlessly across 
          parachains using native XCM with optimal routing and minimal fees.
        </p>
        <div className="flex justify-center space-x-4">
          <Link
            to="/swap"
            className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-medium hover:bg-primary/90 transition-colors"
          >
            Start Swapping
          </Link>
          <Link
            to="/dashboard"
            className="bg-secondary px-6 py-3 rounded-xl font-medium hover:bg-secondary/80 transition-colors"
          >
            View Dashboard
          </Link>
        </div>
      </section>

      {/* Features Section */}
      <section className="grid md:grid-cols-3 gap-8">
        {features.map((feature) => (
          <div key={feature.name} className="swap-card p-6 text-center">
            <div className="flex justify-center mb-4">
              <feature.icon className="w-12 h-12 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">{feature.name}</h3>
            <p className="text-muted-foreground">{feature.description}</p>
          </div>
        ))}
      </section>

      {/* Stats Section - More realistic for hackathon */}
      <section className="grid md:grid-cols-4 gap-6">
        <div className="swap-card p-6 text-center">
          <div className="text-2xl font-bold">Polkadot Hub</div>
          <div className="text-sm text-muted-foreground">Base Chain</div>
        </div>
        <div className="swap-card p-6 text-center">
          <div className="text-2xl font-bold">5+</div>
          <div className="text-sm text-muted-foreground">Parachains</div>
        </div>
        <div className="swap-card p-6 text-center">
          <div className="text-2xl font-bold">XCM</div>
          <div className="text-sm text-muted-foreground">Native Messaging</div>
        </div>
        <div className="swap-card p-6 text-center">
          <div className="text-2xl font-bold">Shared</div>
          <div className="text-sm text-muted-foreground">Security</div>
        </div>
      </section>

      {/* Polkadot Ecosystem Section */}
      <section className="text-center space-y-4 py-8">
        <h2 className="text-3xl font-bold">Powered by Polkadot</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Leveraging Polkadot Hub's EVM compatibility and XCM for true cross-chain interoperability
        </p>
        <div className="flex justify-center gap-4 pt-4">
          <span className="px-4 py-2 bg-secondary rounded-full text-sm">Polkadot Hub</span>
          <span className="px-4 py-2 bg-secondary rounded-full text-sm">XCM</span>
          <span className="px-4 py-2 bg-secondary rounded-full text-sm">EVM</span>
          <span className="px-4 py-2 bg-secondary rounded-full text-sm">Parachains</span>
        </div>
      </section>
    </div>
  )
}