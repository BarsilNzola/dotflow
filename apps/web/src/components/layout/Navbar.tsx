import { Link, useLocation } from 'react-router-dom'
import { ConnectButton } from '../wallet/ConnectButton'
import { NetworkIndicator } from '../wallet/NetworkIndicator'
import { cn } from '../../lib/utils'

const navigation = [
  { name: 'Home',      href: '/' },
  { name: 'Swap',      href: '/swap', badge: 'XCM' },
  { name: 'Dashboard', href: '/dashboard' },
]

export function Navbar() {
  const location = useLocation()

  return (
    <nav className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">

          {/* Logo + nav */}
          <div className="flex items-center gap-8">
            <Link to="/" className="font-black text-xl tracking-tight">
              Dot<span className="text-primary">Flow</span>
            </Link>

            <div className="hidden md:flex items-center gap-1">
              {navigation.map(item => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
                    location.pathname === item.href
                      ? 'text-foreground bg-secondary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                  )}
                >
                  {item.name}
                  {item.badge && (
                    <span className="font-mono text-[9px] font-bold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full tracking-wider">
                      {item.badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <NetworkIndicator />
            <ConnectButton />
          </div>
        </div>
      </div>
    </nav>
  )
}