import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load ABIs from web app contracts directory
const CONTRACTS_PATH = join(__dirname, '../../../../web/src/contracts/abi')

export const loadABI = (name: string) => {
  try {
    const content = readFileSync(join(CONTRACTS_PATH, `${name}.json`), 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error(`Failed to load ABI ${name}:`, error)
    return null
  }
}

export const DotFlowRouterABI = loadABI('DotFlowRouter')
export const LiquidityManagerABI = loadABI('LiquidityManager')
export const CrossChainExecutorABI = loadABI('CrossChainExecutor')
export const UniswapV2AdapterABI = loadABI('UniswapV2Adapter')
export const ParachainAdapterABI = loadABI('ParachainAdapter')

// Extract event signatures from ABIs
export const getEventSignatures = (abi: any[]) => {
  const events = abi.filter(item => item.type === 'event')
  return events.map(event => {
    const inputs = event.inputs.map((input: any) => `${input.type} ${input.name}`).join(',')
    const signature = `${event.name}(${inputs})`
    return {
      name: event.name,
      signature,
      topic: `0x${Buffer.from(signature).toString('hex').slice(0, 64)}`
    }
  })
}

export const DOTFLOW_ROUTER_EVENTS = DotFlowRouterABI ? getEventSignatures(DotFlowRouterABI) : []
export const LIQUIDITY_MANAGER_EVENTS = LiquidityManagerABI ? getEventSignatures(LiquidityManagerABI) : []
export const CROSS_CHAIN_EXECUTOR_EVENTS = CrossChainExecutorABI ? getEventSignatures(CrossChainExecutorABI) : []