import { useAccount, useDisconnect, useEnsName } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useWalletStore } from '../store/useWalletStore'
import { useEffect } from 'react'
import { formatAddress } from '../lib/utils'

export function useWallet() {
  const { address, isConnected, chainId, connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  const { data: ensName } = useEnsName({ address })
  
  const { 
    setAddress, 
    setChainId, 
    setIsConnected,
    address: storedAddress
  } = useWalletStore()

  useEffect(() => {
    if (address && isConnected) {
      setAddress(address)
      setChainId(chainId || null)
      setIsConnected(true)
    } else {
      setAddress(null)
      setChainId(null)
      setIsConnected(false)
    }
  }, [address, isConnected, chainId, setAddress, setChainId, setIsConnected])

  const handleConnect = () => {
    if (openConnectModal) {
      openConnectModal()
    }
  }

  const handleDisconnect = () => {
    disconnect()
  }

  const displayName = ensName || (storedAddress ? formatAddress(storedAddress) : '')

  return {
    address: storedAddress,
    chainId,
    isConnected,
    displayName,
    connector,
    connect: handleConnect,
    disconnect: handleDisconnect
  }
}