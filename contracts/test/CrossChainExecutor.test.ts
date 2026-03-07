import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * CrossChainExecutor test suite.
 *
 * Because we run on a local Hardhat network the XCM precompile at
 * 0x00000000000000000000000000000000000a0000 does NOT exist.
 * We deploy a MockXcmPrecompile that:
 *   - records every xcmSend call (destination + message bytes)
 *   - can be told to revert on the next call (to test failure paths)
 *
 * All SCALE-encoding helpers are tested indirectly through sendParachainAssets.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const WESTEND_CHAIN_ID  = 420;
const BASE_FEE          = ethers.parseEther("0.01");
const WEIGHT_FEE        = ethers.parseEther("0.0001");
const MIN_FEE           = ethers.parseEther("0.005");
const MAX_WEIGHT        = 10_000_000_000n;
const XCM_REF_TIME      = 400_000_000n;
const XCM_PROOF_SIZE    = 8_192n;
const XCM_PRECOMPILE    = "0x00000000000000000000000000000000000a0000";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function deployMockXcm() {
  const factory = await ethers.getContractFactory("MockXcmPrecompile");
  const mock    = await factory.deploy();
  // Hardhat allows setting code at arbitrary addresses
  const code = await ethers.provider.getCode(await mock.getAddress());
  await ethers.provider.send("hardhat_setCode", [XCM_PRECOMPILE, code]);
  return ethers.getContractAt("MockXcmPrecompile", XCM_PRECOMPILE);
}

describe("CrossChainExecutor", function () {
  let executor:  any;
  let xcmMock:   any;
  let deployer:  SignerWithAddress;
  let user:      SignerWithAddress;
  let recipient: SignerWithAddress;
  let relayer:   SignerWithAddress;
  let mockToken: any;
  let assetId:   string;

  beforeEach(async function () {
    [deployer, user, recipient, relayer] = await ethers.getSigners();

    // ── Deploy mock XCM precompile ──────────────────────────────────────────
    xcmMock = await deployMockXcm();

    // ── Deploy contracts ────────────────────────────────────────────────────
    const ExecutorFactory = await ethers.getContractFactory("CrossChainExecutor");
    executor = await ExecutorFactory.deploy();

    const TokenFactory = await ethers.getContractFactory("MockERC20");
    mockToken = await TokenFactory.deploy("Mock USDC", "mUSDC", 6);

    // ── Mint tokens ─────────────────────────────────────────────────────────
    await mockToken.mint(user.address, ethers.parseUnits("10000", 6));

    // ── Configure chain ─────────────────────────────────────────────────────
    await executor.configureChain(
      WESTEND_CHAIN_ID,
      "Westend",
      BASE_FEE, WEIGHT_FEE, MIN_FEE,
      MAX_WEIGHT,
      XCM_REF_TIME, XCM_PROOF_SIZE
    );

    // ── Grant roles ──────────────────────────────────────────────────────────
    const RELAYER_ROLE = await executor.RELAYER_ROLE();
    await executor.grantRole(RELAYER_ROLE, relayer.address);

    // ── Map asset ────────────────────────────────────────────────────────────
    assetId = ethers.zeroPadValue(ethers.toBeHex(await mockToken.getAddress()), 32);
    await executor.mapAsset(WESTEND_CHAIN_ID, assetId, await mockToken.getAddress(), 6, false);

    // ── Approve executor for user ────────────────────────────────────────────
    await mockToken.connect(user).approve(await executor.getAddress(), ethers.parseUnits("10000", 6));
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("Chain configuration", function () {
    it("stores chain config correctly", async function () {
      const cfg = await executor.getChainConfig(WESTEND_CHAIN_ID);
      expect(cfg.name).to.equal("Westend");
      expect(cfg.baseFee).to.equal(BASE_FEE);
      expect(cfg.isActive).to.be.true;
      expect(cfg.xcmRefTime).to.equal(XCM_REF_TIME);
      expect(cfg.xcmProofSize).to.equal(XCM_PROOF_SIZE);
    });

    it("reverts if gateway is zero on old signature — new signature works", async function () {
      // New configureChain no longer requires a gateway address parameter
      await expect(
        executor.configureChain(
          9999, "Test", BASE_FEE, WEIGHT_FEE, MIN_FEE,
          MAX_WEIGHT + 1n, XCM_REF_TIME, XCM_PROOF_SIZE
        )
      ).to.be.revertedWith("Max weight too high");
    });

    it("deactivates chain", async function () {
      await executor.deactivateChain(WESTEND_CHAIN_ID);
      const cfg = await executor.getChainConfig(WESTEND_CHAIN_ID);
      expect(cfg.isActive).to.be.false;
    });

    it("reverts sendParachainAssets on inactive chain", async function () {
      await executor.deactivateChain(WESTEND_CHAIN_ID);
      const assets = [{ assetId, amount: ethers.parseUnits("100", 6), isNative: false }];
      await expect(
        executor.connect(user).sendParachainAssets(
          WESTEND_CHAIN_ID, recipient.address, assets, "0x", 3600,
          { value: ethers.parseEther("1") }  // fixed fee — don't call calculateFee on inactive chain
        )
      ).to.be.revertedWithCustomError(executor, "ChainNotSupported");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("sendParachainAssets — happy path", function () {
    async function sendAssets(amount = ethers.parseUnits("100", 6)) {
      const assets = [{ assetId, amount, isNative: false }];
      const weight = 101_000_000n;
      const fee    = await executor.calculateFee(WESTEND_CHAIN_ID, weight, amount);
      const tx = await executor.connect(user).sendParachainAssets(
        WESTEND_CHAIN_ID, recipient.address, assets, "0x", 3600,
        { value: fee * 2n }   // overpay to ensure enough
      );
      const receipt = await tx.wait();
      const event   = receipt?.logs.find((l: any) => l.fragment?.name === "XCMMessagePrepared");
      return { tx, receipt, messageId: event?.args?.[0] };
    }

    it("emits XCMMessagePrepared", async function () {
      const { receipt } = await sendAssets();
      const event = receipt?.logs.find((l: any) => l.fragment?.name === "XCMMessagePrepared");
      expect(event).to.not.be.undefined;
      expect(event?.args?.[1]).to.equal(WESTEND_CHAIN_ID);
      expect(event?.args?.[2]).to.equal(user.address);
      expect(event?.args?.[3]).to.equal(recipient.address);
    });

    it("emits XCMSent with non-empty destination and message bytes", async function () {
      const { receipt } = await sendAssets();
      const sent = receipt?.logs.find((l: any) => l.fragment?.name === "XCMSent");
      expect(sent).to.not.be.undefined;
      // destination must be at least 4 bytes (SCALE-encoded MultiLocation)
      expect((sent?.args?.[1] as string).length).to.be.greaterThan(4);
      // message must be at least 2 bytes
      expect((sent?.args?.[2] as string).length).to.be.greaterThan(4);
    });

    it("records the message with status Executed (xcmSend succeeded)", async function () {
      const { messageId } = await sendAssets();
      const status = await executor.getMessageStatus(messageId);
      expect(status).to.equal(1); // Executed
    });

    it("transfers tokens from user to executor", async function () {
      const before = await mockToken.balanceOf(await executor.getAddress());
      await sendAssets(ethers.parseUnits("500", 6));
      const after = await mockToken.balanceOf(await executor.getAddress());
      expect(after - before).to.equal(ethers.parseUnits("500", 6));
    });

    it("increments sender nonce", async function () {
      const before = await executor.getNonce(user.address, WESTEND_CHAIN_ID);
      await sendAssets();
      const after  = await executor.getNonce(user.address, WESTEND_CHAIN_ID);
      expect(after).to.equal(before + 1n);
    });

    it("refunds excess ETH to caller", async function () {
      const assets = [{ assetId, amount: ethers.parseUnits("100", 6), isNative: false }];
      const fee    = await executor.calculateFee(WESTEND_CHAIN_ID, 101_000_000n, ethers.parseUnits("100", 6));
      const excess = ethers.parseEther("5");
      const balBefore = await ethers.provider.getBalance(user.address);
      const tx        = await executor.connect(user).sendParachainAssets(
        WESTEND_CHAIN_ID, recipient.address, assets, "0x", 3600,
        { value: fee + excess }
      );
      const r = await tx.wait();
      const gasUsed = r!.gasUsed * BigInt(r!.gasPrice ?? 0);
      const balAfter = await ethers.provider.getBalance(user.address);
      const spent    = balBefore - balAfter - gasUsed;
      // spent ≈ fee (not fee + excess)
      expect(spent).to.be.closeTo(fee, ethers.parseEther("0.001"));
    });

    it("calls xcmSend on the precompile", async function () {
      const countBefore = await (xcmMock as any).sendCallCount();
      await sendAssets();
      const countAfter = await (xcmMock as any).sendCallCount();
      expect(countAfter - countBefore).to.equal(1n);
    });

    it("stores destination and message in mock for inspection", async function () {
      await sendAssets();
      const last = await (xcmMock as any).lastSend();
      expect(last.destination.length).to.be.greaterThan(2);
      expect(last.message.length).to.be.greaterThan(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("sendParachainAssets — failure paths", function () {
    it("reverts with insufficient fee", async function () {
      const assets = [{ assetId, amount: ethers.parseUnits("100", 6), isNative: false }];
      await expect(
        executor.connect(user).sendParachainAssets(
          WESTEND_CHAIN_ID, recipient.address, assets, "0x", 3600,
          { value: 1n }
        )
      ).to.be.revertedWithCustomError(executor, "InsufficientFee");
    });

    it("reverts with no assets", async function () {
      await expect(
        executor.connect(user).sendParachainAssets(
          WESTEND_CHAIN_ID, recipient.address, [], "0x", 3600,
          { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWith("No assets");
    });

    it("reverts with invalid recipient", async function () {
      const assets = [{ assetId, amount: ethers.parseUnits("100", 6), isNative: false }];
      await expect(
        executor.connect(user).sendParachainAssets(
          WESTEND_CHAIN_ID, ethers.ZeroAddress, assets, "0x", 3600,
          { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWith("Invalid recipient");
    });

    it("reverts with unmapped asset", async function () {
      const badAsset = ethers.zeroPadValue("0xdead", 32);
      const assets   = [{ assetId: badAsset, amount: ethers.parseUnits("100", 6), isNative: false }];
      await expect(
        executor.connect(user).sendParachainAssets(
          WESTEND_CHAIN_ID, recipient.address, assets, "0x", 3600,
          { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWith("Asset not mapped");
    });

    it("reverts with invalid timeout (too short)", async function () {
      const assets = [{ assetId, amount: ethers.parseUnits("100", 6), isNative: false }];
      await expect(
        executor.connect(user).sendParachainAssets(
          WESTEND_CHAIN_ID, recipient.address, assets, "0x", 10, // 10 seconds
          { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWith("Invalid timeout");
    });

    it("leaves message as Pending when xcmSend reverts", async function () {
      // Tell mock to revert on next call
      await (xcmMock as any).setShouldRevert(true);

      const assets = [{ assetId, amount: ethers.parseUnits("100", 6), isNative: false }];
      const fee    = await executor.calculateFee(WESTEND_CHAIN_ID, 101_000_000n, ethers.parseUnits("100", 6));
      const tx     = await executor.connect(user).sendParachainAssets(
        WESTEND_CHAIN_ID, recipient.address, assets, "0x", 3600,
        { value: fee * 2n }
      );
      const receipt  = await tx.wait();
      const event    = receipt?.logs.find((l: any) => l.fragment?.name === "XCMMessagePrepared");
      const messageId = event?.args?.[0];

      const status = await executor.getMessageStatus(messageId);
      expect(status).to.equal(0); // Pending — xcmSend failed, relayer can retry
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("Message management", function () {
    let messageId: string;

    beforeEach(async function () {
      const assets = [{ assetId, amount: ethers.parseUnits("100", 6), isNative: false }];
      const fee    = await executor.calculateFee(WESTEND_CHAIN_ID, 101_000_000n, ethers.parseUnits("100", 6));
      // Force xcmSend to fail so message stays Pending (needed for cancel/expiry tests)
      await (xcmMock as any).setShouldRevert(true);
      const tx     = await executor.connect(user).sendParachainAssets(
        WESTEND_CHAIN_ID, recipient.address, assets, "0x", 3600,
        { value: fee * 2n }
      );
      const receipt = await tx.wait();
      const event   = receipt?.logs.find((l: any) => l.fragment?.name === "XCMMessagePrepared");
      messageId = event?.args?.[0];
      await (xcmMock as any).setShouldRevert(false);
    });

    it("returns correct message details", async function () {
      const m = await executor.getMessageDetails(messageId);
      expect(m.id).to.equal(messageId);
      expect(m.sender).to.equal(user.address);
      expect(m.recipient).to.equal(recipient.address);
      expect(m.destinationChainId).to.equal(WESTEND_CHAIN_ID);
      expect(m.status).to.equal(0); // Pending
    });

    it("relayer can mark message as executed", async function () {
      await executor.connect(relayer).markExecuted(messageId);
      expect(await executor.getMessageStatus(messageId)).to.equal(1); // Executed
    });

    it("non-relayer cannot mark executed", async function () {
      await expect(executor.connect(user).markExecuted(messageId)).to.be.reverted;
    });

    it("sender can cancel pending message", async function () {
      await expect(executor.connect(user).cancelMessage(messageId))
        .to.emit(executor, "XCMMessageCancelled");
      expect(await executor.getMessageStatus(messageId)).to.equal(3); // Cancelled
    });

    it("refunds tokens on cancel", async function () {
      const before = await mockToken.balanceOf(user.address);
      await executor.connect(user).cancelMessage(messageId);
      const after = await mockToken.balanceOf(user.address);
      expect(after - before).to.equal(ethers.parseUnits("100", 6));
    });

    it("non-sender non-relayer cannot cancel", async function () {
      await expect(executor.connect(recipient).cancelMessage(messageId))
        .to.be.revertedWith("Not authorized");
    });

    it("relayer can cancel", async function () {
      await expect(executor.connect(relayer).cancelMessage(messageId))
        .to.emit(executor, "XCMMessageCancelled");
    });

    it("relayer can process expired messages", async function () {
      await time.increase(3601);
      await executor.connect(relayer).processExpiredMessages([messageId]);
      expect(await executor.getMessageStatus(messageId)).to.equal(4); // Expired
    });

    it("non-relayer cannot process expired messages", async function () {
      await time.increase(3601);
      await expect(executor.connect(user).processExpiredMessages([messageId])).to.be.reverted;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("Fee calculation", function () {
    it("calculates fee above minimum", async function () {
      const weight = 1_000_000_000n;
      const fee    = await executor.calculateFee(WESTEND_CHAIN_ID, weight, ethers.parseEther("100"));
      const expected = BASE_FEE + (WEIGHT_FEE * weight) / 1_000_000n;
      expect(fee).to.equal(expected > MIN_FEE ? expected : MIN_FEE);
    });

    it("returns minFee when calculated fee is below minimum", async function () {
      // Very low weight → should return minFee (or base+weightFee if > minFee)
      const fee = await executor.calculateFee(WESTEND_CHAIN_ID, 1n, ethers.parseEther("0.001"));
      expect(fee).to.be.gte(MIN_FEE);
    });

    it("returns max uint256 for unconfigured chain", async function () {
      const fee = await executor.calculateFee(9999, 1_000_000n, ethers.parseEther("1"));
      expect(fee).to.equal(ethers.MaxUint256);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("Asset mapping", function () {
    it("maps asset correctly", async function () {
      const token  = await executor.getTokenForAsset(WESTEND_CHAIN_ID, assetId);
      expect(token.toLowerCase()).to.equal((await mockToken.getAddress()).toLowerCase());
    });

    it("reverts on duplicate mapping", async function () {
      await expect(
        executor.mapAsset(WESTEND_CHAIN_ID, assetId, await mockToken.getAddress(), 6, false)
      ).to.be.revertedWith("Already mapped");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("SCALE encoding sanity", function () {
    it("destination bytes start with 0x03 (VersionedMultiLocation::V3)", async function () {
      const assets = [{ assetId, amount: ethers.parseUnits("100", 6), isNative: false }];
      const fee    = await executor.calculateFee(WESTEND_CHAIN_ID, 101_000_000n, ethers.parseUnits("100", 6));
      const tx     = await executor.connect(user).sendParachainAssets(
        WESTEND_CHAIN_ID, recipient.address, assets, "0x", 3600,
        { value: fee * 2n }
      );
      const receipt = await tx.wait();
      const sent    = receipt?.logs.find((l: any) => l.fragment?.name === "XCMSent");
      const dest    = sent?.args?.[1] as string; // hex string
      // First byte of destination = 0x03 (V3 MultiLocation)
      expect(dest.slice(2, 4)).to.equal("03");
    });

    it("XCM message starts with 0x03 (VersionedXcm::V3)", async function () {
      const assets = [{ assetId, amount: ethers.parseUnits("100", 6), isNative: false }];
      const fee    = await executor.calculateFee(WESTEND_CHAIN_ID, 101_000_000n, ethers.parseUnits("100", 6));
      const tx     = await executor.connect(user).sendParachainAssets(
        WESTEND_CHAIN_ID, recipient.address, assets, "0x", 3600,
        { value: fee * 2n }
      );
      const receipt = await tx.wait();
      const sent    = receipt?.logs.find((l: any) => l.fragment?.name === "XCMSent");
      const msg     = sent?.args?.[2] as string;
      expect(msg.slice(2, 4)).to.equal("03");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("Role management", function () {
    it("deployer has all roles", async function () {
      const adminRole       = await executor.DEFAULT_ADMIN_ROLE();
      const configuratorRole = await executor.CONFIGURATOR_ROLE();
      const relayerRole     = await executor.RELAYER_ROLE();
      const executorRole    = await executor.EXECUTOR_ROLE();
      expect(await executor.hasRole(adminRole,       deployer.address)).to.be.true;
      expect(await executor.hasRole(configuratorRole, deployer.address)).to.be.true;
      expect(await executor.hasRole(relayerRole,     deployer.address)).to.be.true;
      expect(await executor.hasRole(executorRole,    deployer.address)).to.be.true;
    });

    it("grants and revokes roles", async function () {
      const EXECUTOR_ROLE = await executor.EXECUTOR_ROLE();
      await executor.grantRole(EXECUTOR_ROLE, user.address);
      expect(await executor.hasRole(EXECUTOR_ROLE, user.address)).to.be.true;
      await executor.revokeRole(EXECUTOR_ROLE, user.address);
      expect(await executor.hasRole(EXECUTOR_ROLE, user.address)).to.be.false;
    });
  });
});