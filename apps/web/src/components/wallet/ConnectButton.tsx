import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useWallet } from '../../hooks/useWallet'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import { Menu, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { cn } from '../../lib/utils'

export function ConnectButton() {
  const { isConnected, displayName, disconnect } = useWallet()
  const { openConnectModal } = useConnectModal()

  if (!isConnected) {
    return (
      <button
        onClick={openConnectModal}
        className="bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        Connect Wallet
      </button>
    )
  }

  return (
    <Menu as="div" className="relative">
      <Menu.Button className="flex items-center gap-2 bg-secondary px-4 py-2 rounded-xl text-sm font-medium hover:bg-secondary/80 transition-colors">
        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
        <span className="font-mono text-xs">{displayName}</span>
        <ChevronDownIcon className="w-3.5 h-3.5 text-muted-foreground" />
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 mt-2 w-44 swap-card shadow-xl overflow-hidden z-50 focus:outline-none">
          {[
            { label: 'Profile',      action: () => console.log('Navigate to profile') },
            { label: 'Transactions', action: () => console.log('Navigate to transactions') },
          ].map(({ label, action }) => (
            <Menu.Item key={label}>
              {({ active }) => (
                <button
                  onClick={action}
                  className={cn('w-full px-4 py-3 text-left text-sm transition-colors', active && 'bg-secondary')}
                >
                  {label}
                </button>
              )}
            </Menu.Item>
          ))}
          <div className="border-t border-border" />
          <Menu.Item>
            {({ active }) => (
              <button
                onClick={disconnect}
                className={cn('w-full px-4 py-3 text-left text-sm text-red-500 transition-colors', active && 'bg-secondary')}
              >
                Disconnect
              </button>
            )}
          </Menu.Item>
        </Menu.Items>
      </Transition>
    </Menu>
  )
}