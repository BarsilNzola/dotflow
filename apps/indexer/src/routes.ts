import express from 'express'
import cors from 'cors'
import { prisma } from './db'
import logger from './logger'

const app = express()
const PORT = process.env.API_PORT || 3001

export function startApiServer() {
  app.use(cors())
  app.use(express.json())

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Get swaps
  app.get('/api/swaps', async (req, res) => {
    try {
      const { user, chainId, limit = 50, offset = 0 } = req.query
      
      const where: any = {}
      if (user) where.userAddress = user
      if (chainId) where.chainId = parseInt(chainId as string)

      const swaps = await prisma.swap.findMany({
        where,
        include: {
          tokenIn: true,
          tokenOut: true,
          xcmMessage: true
        },
        orderBy: { blockTimestamp: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string)
      })

      const total = await prisma.swap.count({ where })

      res.json({
        data: swaps,
        pagination: {
          total,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string)
        }
      })
    } catch (error) {
      logger.error('Error fetching swaps:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Get swap by ID
  app.get('/api/swaps/:swapId', async (req, res) => {
    try {
      const swap = await prisma.swap.findUnique({
        where: { swapId: req.params.swapId },
        include: {
          tokenIn: true,
          tokenOut: true,
          xcmMessage: true
        }
      })

      if (!swap) {
        return res.status(404).json({ error: 'Swap not found' })
      }

      res.json(swap)
    } catch (error) {
      logger.error('Error fetching swap:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Get XCM messages
  app.get('/api/xcm-messages', async (req, res) => {
    try {
      const { sender, recipient, status, limit = 50 } = req.query
      
      const where: any = {}
      if (sender) where.sender = sender
      if (recipient) where.recipient = recipient
      if (status) where.status = status

      const messages = await prisma.xCMMessage.findMany({
        where,
        include: {
          sourceChain: true,
          destinationChain: true,
          swap: true
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string)
      })

      res.json(messages)
    } catch (error) {
      logger.error('Error fetching XCM messages:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Get liquidity pools
  app.get('/api/pools', async (req, res) => {
    try {
      const { chainId, token } = req.query
      
      const where: any = {}
      if (chainId) where.chainId = parseInt(chainId as string)
      if (token) where.tokenAddress = token

      const pools = await prisma.liquidityPool.findMany({
        where,
        include: {
          token: true
        }
      })

      res.json(pools)
    } catch (error) {
      logger.error('Error fetching pools:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Get user positions
  app.get('/api/users/:address/positions', async (req, res) => {
    try {
      const positions = await prisma.liquidityPosition.findMany({
        where: { provider: req.params.address },
        include: {
          pool: {
            include: { token: true }
          }
        }
      })

      res.json(positions)
    } catch (error) {
      logger.error('Error fetching positions:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Get stats
  app.get('/api/stats', async (req, res) => {
    try {
      const [totalSwaps, totalVolume, activePools, totalXCM] = await Promise.all([
        prisma.swap.count(),
        prisma.swap.aggregate({
          _sum: { amountOut: true }
        }),
        prisma.liquidityPool.count({ where: { isActive: true } }),
        prisma.xCMMessage.count()
      ])

      res.json({
        totalSwaps,
        totalVolume: totalVolume._sum.amountOut?.toString() || '0',
        activePools,
        totalXCM
      })
    } catch (error) {
      logger.error('Error fetching stats:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Get tokens
  app.get('/api/tokens', async (req, res) => {
    try {
      const { chainId, search } = req.query
      
      const where: any = {}
      if (chainId) where.chainId = parseInt(chainId as string)
      if (search) {
        where.OR = [
          { symbol: { contains: search as string, mode: 'insensitive' } },
          { name: { contains: search as string, mode: 'insensitive' } },
          { address: { contains: search as string, mode: 'insensitive' } }
        ]
      }

      const tokens = await prisma.token.findMany({
        where,
        take: 100
      })

      res.json(tokens)
    } catch (error) {
      logger.error('Error fetching tokens:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Get adapters
  app.get('/api/adapters', async (req, res) => {
    try {
      const { chainId } = req.query
      
      const where: any = {}
      if (chainId) where.chainId = parseInt(chainId as string)

      const adapters = await prisma.adapter.findMany({
        where,
        include: {
          chain: true
        }
      })

      res.json(adapters)
    } catch (error) {
      logger.error('Error fetching adapters:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.listen(PORT, () => {
    logger.info(`API server running on port ${PORT}`)
  })
}