import 'dotenv/config'
import { startListener } from './listener'
import { startApiServer } from './routes'
import { prisma } from './db'
import logger from './logger'

async function main() {
  logger.info('Starting DotFlow Indexer...')

  // Start blockchain listeners
  await startListener()

  // Start API server
  startApiServer()

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down...')
    await prisma.$disconnect()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down...')
    await prisma.$disconnect()
    process.exit(0)
  })
}

main().catch((error) => {
  logger.error('Fatal error:', error)
  process.exit(1)
})