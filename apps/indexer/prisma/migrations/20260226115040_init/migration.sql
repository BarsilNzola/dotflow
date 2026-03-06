-- CreateTable
CREATE TABLE "Chain" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chainId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "lastBlock" BIGINT NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "logoURI" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Swap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "swapId" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "tokenInAddress" TEXT NOT NULL,
    "tokenOutAddress" TEXT NOT NULL,
    "amountIn" BIGINT NOT NULL,
    "amountOut" BIGINT,
    "amountOutMin" BIGINT NOT NULL,
    "recipient" TEXT NOT NULL,
    "fee" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Swap_tokenInAddress_fkey" FOREIGN KEY ("tokenInAddress") REFERENCES "Token" ("address") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Swap_tokenOutAddress_fkey" FOREIGN KEY ("tokenOutAddress") REFERENCES "Token" ("address") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "XCMMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "swapId" TEXT NOT NULL,
    "destinationChain" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "executedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XCMMessage_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "Swap" ("swapId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Adapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fee" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Parachain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parachainId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastBlock" BIGINT NOT NULL,
    "lastSync" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isSyncing" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "Chain_chainId_key" ON "Chain"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "Token_address_key" ON "Token"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Swap_swapId_key" ON "Swap"("swapId");

-- CreateIndex
CREATE UNIQUE INDEX "Swap_txHash_key" ON "Swap"("txHash");

-- CreateIndex
CREATE INDEX "Swap_userAddress_idx" ON "Swap"("userAddress");

-- CreateIndex
CREATE INDEX "Swap_swapId_idx" ON "Swap"("swapId");

-- CreateIndex
CREATE INDEX "Swap_txHash_idx" ON "Swap"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "XCMMessage_messageId_key" ON "XCMMessage"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "XCMMessage_swapId_key" ON "XCMMessage"("swapId");

-- CreateIndex
CREATE INDEX "XCMMessage_messageId_idx" ON "XCMMessage"("messageId");

-- CreateIndex
CREATE INDEX "XCMMessage_status_idx" ON "XCMMessage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Adapter_address_key" ON "Adapter"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Parachain_parachainId_key" ON "Parachain"("parachainId");
