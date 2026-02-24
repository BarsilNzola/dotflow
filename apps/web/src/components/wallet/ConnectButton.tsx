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
        className="bg-primary text-primary-foreground px-4 py-2 rounded-xl font-medium hover:bg-primary/90 transition-colors"
      >
        Connect Wallet
      </button>
    )
  }

  return (
    <Menu as="div" className="relative">
      <Menu.Button className="flex items-center space-x-2 bg-secondary px-4 py-2 rounded-xl hover:bg-secondary/80 transition-colors">
        <span>{displayName}</span>
        <ChevronDownIcon className="w-4 h-4" />
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50">
          <Menu.Item>
            {({ active }) => (
              <button
                onClick={() => {
                  // Navigate to profile - you can add navigation logic here
                  console.log('Navigate to profile')
                }}
                className={cn(
                  'w-full px-4 py-3 text-left text-sm',
                  active && 'bg-secondary'
                )}
              >
                Profile
              </button>
            )}
          </Menu.Item>
          <Menu.Item>
            {({ active }) => (
              <button
                onClick={() => {
                  // Navigate to transactions
                  console.log('Navigate to transactions')
                }}
                className={cn(
                  'w-full px-4 py-3 text-left text-sm',
                  active && 'bg-secondary'
                )}
              >
                Transactions
              </button>
            )}
          </Menu.Item>
          <Menu.Item>
            {({ active }) => (
              <button
                onClick={disconnect}
                className={cn(
                  'w-full px-4 py-3 text-left text-sm text-red-600',
                  active && 'bg-secondary'
                )}
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