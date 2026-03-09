export function Footer() {
  return (
    <footer className="border-t border-border mt-auto">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-black text-sm">Dot<span className="text-primary">Flow</span></span>
            <span className="text-border">·</span>
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
              Built on Polkadot Hub
            </span>
          </div>
          <div className="flex items-center gap-6">
            {[
              { label: 'GitHub', href: 'https://github.com/BarsilNzola/dotflow' },
              { label: 'Docs',   href: '#' },
              { label: 'Terms',  href: '#' },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target={href.startsWith('http') ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
              >
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
