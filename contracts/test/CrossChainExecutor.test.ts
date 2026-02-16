import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("CrossChainExecutor", function () {
  let executor: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let recipient: SignerWithAddress;
  let relayer: SignerWithAddress;
  let executorRole: SignerWithAddress;
  let mockToken: Contract;
  let mockToken2: Contract;

  const DESTINATION_CHAIN_ID: number = 3000;
  const CHAIN_NAME: string = "Polkadot Hub";
  const BASE_FEE: bigint = ethers.parseEther("0.01");
  const WEIGHT_FEE: bigint = ethers.parseEther("0.0001");
  const MIN_FEE: bigint = ethers.parseEther("0.005");
  const MAX_WEIGHT: number = 10000000000;
  const GATEWAY: string = "0x0000000000000000000000000000000000000800";
  const GENESIS_HASH: string = ethers.hexlify(ethers.randomBytes(32));

  interface XCMInstruction {
    destinationChainId: number;
    sender: string;
    recipient: string;
    asset: string;
    amount: bigint;
    callData: string;
    weight: bigint;
    transactWeight: bigint;
    timeout: number;
  }

  interface ParachainAsset {
    assetId: string;
    amount: bigint;
    isNative: boolean;
  }

  beforeEach(async function () {
    [deployer, user, recipient, relayer, executorRole] = await ethers.getSigners();

    // Deploy executor
    const CrossChainExecutor = await ethers.getContractFactory("CrossChainExecutor");
    executor = await CrossChainExecutor.deploy();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Test Token", "TEST", 18);
    mockToken2 = await MockERC20.deploy("Test Token 2", "TST2", 18);

    // Configure chain
    await executor.configureChain(
      DESTINATION_CHAIN_ID,
      CHAIN_NAME,
      BASE_FEE,
      WEIGHT_FEE,
      MIN_FEE,
      MAX_WEIGHT,
      GATEWAY,
      GENESIS_HASH
    );

    // Grant roles
    const RELAYER_ROLE = await executor.RELAYER_ROLE();
    await executor.grantRole(RELAYER_ROLE, relayer.address);
    
    const EXECUTOR_ROLE = await executor.EXECUTOR_ROLE();
    await executor.grantRole(EXECUTOR_ROLE, executorRole.address);

    // Mint tokens
    await mockToken.mint(user.address, ethers.parseEther("10000"));
    await mockToken2.mint(user.address, ethers.parseEther("10000"));
  });

  describe("Chain Configuration", function () {
    it("Should configure chain successfully", async function () {
      const config = await executor.getChainConfig(DESTINATION_CHAIN_ID);
      
      expect(config.name).to.equal(CHAIN_NAME);
      expect(config.baseFee).to.equal(BASE_FEE);
      expect(config.weightFee).to.equal(WEIGHT_FEE);
      expect(config.minFee).to.equal(MIN_FEE);
      expect(config.maxWeight).to.equal(MAX_WEIGHT);
      expect(config.gateway).to.equal(GATEWAY);
      expect(config.genesisHash).to.equal(GENESIS_HASH);
      expect(config.isActive).to.be.true;
    });

    it("Should update existing chain configuration", async function () {
      const newBaseFee: bigint = ethers.parseEther("0.02");
      const newName: string = "Updated Hub";
      
      await executor.configureChain(
        DESTINATION_CHAIN_ID,
        newName,
        newBaseFee,
        WEIGHT_FEE,
        MIN_FEE,
        MAX_WEIGHT,
        GATEWAY,
        GENESIS_HASH
      );

      const config = await executor.getChainConfig(DESTINATION_CHAIN_ID);
      expect(config.name).to.equal(newName);
      expect(config.baseFee).to.equal(newBaseFee);
    });

    it("Should deactivate chain", async function () {
      await executor.deactivateChain(DESTINATION_CHAIN_ID);
      
      const config = await executor.getChainConfig(DESTINATION_CHAIN_ID);
      expect(config.isActive).to.be.false;
    });

    it("Should not allow configuration with invalid gateway", async function () {
      await expect(
        executor.configureChain(
          9999,
          "Invalid",
          BASE_FEE,
          WEIGHT_FEE,
          MIN_FEE,
          MAX_WEIGHT,
          ethers.ZeroAddress,
          GENESIS_HASH
        )
      ).to.be.revertedWith("Invalid gateway");
    });

    it("Should not allow max weight too high", async function () {
      const MAX_WEIGHT_LIMIT = await executor.MAX_WEIGHT();
      
      await expect(
        executor.configureChain(
          9999,
          "Invalid",
          BASE_FEE,
          WEIGHT_FEE,
          MIN_FEE,
          MAX_WEIGHT_LIMIT + 1n,
          GATEWAY,
          GENESIS_HASH
        )
      ).to.be.revertedWith("Max weight too high");
    });
  });

  describe("Sending XCM Messages", function () {
    let instruction: XCMInstruction;

    beforeEach(async function () {
      instruction = {
        destinationChainId: DESTINATION_CHAIN_ID,
        sender: user.address,
        recipient: recipient.address,
        asset: await mockToken.getAddress(),
        amount: ethers.parseEther("100"),
        callData: "0x",
        weight: 1000000000n,
        transactWeight: 2000000000n,
        timeout: 3600
      };

      await mockToken.connect(user).approve(
        await executor.getAddress(),
        ethers.parseEther("1000")
      );
    });

    it("Should send XCM message successfully", async function () {
      const fee: bigint = await executor.calculateFee(
        DESTINATION_CHAIN_ID,
        instruction.weight,
        instruction.amount
      );

      const tx = await executor.connect(user).sendXCM(instruction, { value: fee });
      const receipt = await tx.wait();
      
      const event = receipt?.logs.find(
        (e: any) => e.fragment && e.fragment.name === "XCMMessagePrepared"
      );

      expect(event).to.not.be.undefined;
      const messageId: string = event?.args[0];
      
      const status = await executor.getMessageStatus(messageId);
      expect(status).to.equal(0); // Pending
    });

    it("Should revert with insufficient fee", async function () {
      await expect(
        executor.connect(user).sendXCM(instruction, { value: 1n })
      ).to.be.revertedWithCustomError(executor, "InsufficientFee");
    });

    it("Should revert with unsupported chain", async function () {
      instruction.destinationChainId = 9999;
      
      await expect(
        executor.connect(user).sendXCM(instruction, { value: BASE_FEE })
      ).to.be.revertedWithCustomError(executor, "ChainNotSupported");
    });

    it("Should revert with zero amount", async function () {
      instruction.amount = 0n;
      
      await expect(
        executor.connect(user).sendXCM(instruction, { value: BASE_FEE })
      ).to.be.revertedWith("Zero amount");
    });

    it("Should revert with invalid recipient", async function () {
      instruction.recipient = ethers.ZeroAddress;
      
      await expect(
        executor.connect(user).sendXCM(instruction, { value: BASE_FEE })
      ).to.be.revertedWithCustomError(executor, "InvalidRecipient");
    });

    it("Should revert with invalid timeout", async function () {
      instruction.timeout = 10; // Too short
      
      await expect(
        executor.connect(user).sendXCM(instruction, { value: BASE_FEE })
      ).to.be.revertedWith("Invalid timeout");

      instruction.timeout = 10 * 24 * 3600; // 10 days (too long)
      
      await expect(
        executor.connect(user).sendXCM(instruction, { value: BASE_FEE })
      ).to.be.revertedWith("Invalid timeout");
    });

    it("Should revert with weight too high", async function () {
      instruction.weight = 20000000000n; // Exceeds MAX_WEIGHT
      
      await expect(
        executor.connect(user).sendXCM(instruction, { value: BASE_FEE })
      ).to.be.revertedWith("Weight exceeds max");
    });

    it("Should refund excess fee", async function () {
      const fee: bigint = await executor.calculateFee(
        DESTINATION_CHAIN_ID,
        instruction.weight,
        instruction.amount
      );
      
      const excess: bigint = ethers.parseEther("1");
      const balanceBefore: bigint = await ethers.provider.getBalance(user.address);
      
      await executor.connect(user).sendXCM(instruction, { value: fee + excess });
      
      const balanceAfter: bigint = await ethers.provider.getBalance(user.address);
      
      // Balance should decrease by exactly fee (not fee + excess)
      expect(balanceBefore - balanceAfter).to.be.closeTo(fee, ethers.parseEther("0.001"));
    });
  });

  describe("Sending Parachain Assets", function () {
    let assets: ParachainAsset[];

    beforeEach(async function () {
      assets = [
        {
          assetId: ethers.zeroPadBytes(ethers.toBeHex(await mockToken.getAddress()), 32),
          amount: ethers.parseEther("50"),
          isNative: false
        },
        {
          assetId: ethers.zeroPadBytes(ethers.toBeHex(await mockToken2.getAddress()), 32),
          amount: ethers.parseEther("50"),
          isNative: false
        }
      ];

      await mockToken.connect(user).approve(
        await executor.getAddress(),
        ethers.parseEther("1000")
      );
      
      await mockToken2.connect(user).approve(
        await executor.getAddress(),
        ethers.parseEther("1000")
      );
    });

    it("Should send parachain assets successfully", async function () {
      const callData: string = "0x";
      const timeout: number = 3600;

      const tx = await executor.connect(user).sendParachainAssets(
        DESTINATION_CHAIN_ID,
        recipient.address,
        assets,
        callData,
        timeout,
        { value: BASE_FEE * 2n }
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (e: any) => e.fragment && e.fragment.name === "XCMMessagePrepared"
      );

      expect(event).to.not.be.undefined;
    });

    it("Should revert with no assets", async function () {
      await expect(
        executor.connect(user).sendParachainAssets(
          DESTINATION_CHAIN_ID,
          recipient.address,
          [],
          "0x",
          3600,
          { value: BASE_FEE }
        )
      ).to.be.revertedWith("No assets");
    });

    it("Should revert with invalid recipient", async function () {
      await expect(
        executor.connect(user).sendParachainAssets(
          DESTINATION_CHAIN_ID,
          ethers.ZeroAddress,
          assets,
          "0x",
          3600,
          { value: BASE_FEE }
        )
      ).to.be.revertedWithCustomError(executor, "InvalidRecipient");
    });
  });

  describe("Message Status and Management", function () {
    let messageId: string;
    let instruction: XCMInstruction;

    beforeEach(async function () {
      instruction = {
        destinationChainId: DESTINATION_CHAIN_ID,
        sender: user.address,
        recipient: recipient.address,
        asset: await mockToken.getAddress(),
        amount: ethers.parseEther("100"),
        callData: "0x",
        weight: 1000000000n,
        transactWeight: 2000000000n,
        timeout: 3600
      };

      await mockToken.connect(user).approve(
        await executor.getAddress(),
        ethers.parseEther("1000")
      );

      const fee: bigint = await executor.calculateFee(
        DESTINATION_CHAIN_ID,
        instruction.weight,
        instruction.amount
      );

      const tx = await executor.connect(user).sendXCM(instruction, { value: fee });
      const receipt = await tx.wait();
      
      const event = receipt?.logs.find(
        (e: any) => e.fragment && e.fragment.name === "XCMMessagePrepared"
      );
      messageId = event?.args[0];
    });

    it("Should get message details", async function () {
      const message = await executor.getMessageDetails(messageId);
      
      expect(message.id).to.equal(messageId);
      expect(message.sender).to.equal(user.address);
      expect(message.recipient).to.equal(recipient.address);
      expect(message.asset).to.equal(await mockToken.getAddress());
      expect(message.amount).to.equal(ethers.parseEther("100"));
      expect(message.status).to.equal(0); // Pending
    });

    it("Should get message status", async function () {
      const status = await executor.getMessageStatus(messageId);
      expect(status).to.equal(0); // Pending
    });

    it("Should cancel pending message", async function () {
      await expect(
        executor.connect(user).cancelMessage(messageId)
      ).to.emit(executor, "XCMMessageCancelled");

      const status = await executor.getMessageStatus(messageId);
      expect(status).to.equal(3); // Cancelled
    });

    it("Should not cancel message by non-sender", async function () {
      await expect(
        executor.connect(recipient).cancelMessage(messageId)
      ).to.be.revertedWith("Not authorized");
    });

    it("Should allow relayer to cancel message", async function () {
      await expect(
        executor.connect(relayer).cancelMessage(messageId)
      ).to.emit(executor, "XCMMessageCancelled");
    });
  });

  describe("Message Expiry", function () {
    let messageId: string;

    beforeEach(async function () {
      const instruction: XCMInstruction = {
        destinationChainId: DESTINATION_CHAIN_ID,
        sender: user.address,
        recipient: recipient.address,
        asset: await mockToken.getAddress(),
        amount: ethers.parseEther("100"),
        callData: "0x",
        weight: 1000000000n,
        transactWeight: 2000000000n,
        timeout: 1 // Very short timeout
      };

      await mockToken.connect(user).approve(
        await executor.getAddress(),
        ethers.parseEther("1000")
      );

      const fee: bigint = await executor.calculateFee(
        DESTINATION_CHAIN_ID,
        instruction.weight,
        instruction.amount
      );

      const tx = await executor.connect(user).sendXCM(instruction, { value: fee });
      const receipt = await tx.wait();
      
      const event = receipt?.logs.find(
        (e: any) => e.fragment && e.fragment.name === "XCMMessagePrepared"
      );
      messageId = event?.args[0];
    });

    it("Should process expired messages", async function () {
      // Advance time past timeout
      await helpers.time.increase(3600);

      await executor.connect(relayer).processExpiredMessages([messageId]);

      const status = await executor.getMessageStatus(messageId);
      expect(status).to.equal(4); // Expired
    });

    it("Should emit expiration event", async function () {
      await helpers.time.increase(3600);

      await expect(
        executor.connect(relayer).processExpiredMessages([messageId])
      ).to.emit(executor, "XCMMessageExpired");
    });

    it("Should not allow non-relayer to process expired messages", async function () {
      await helpers.time.increase(3600);

      await expect(
        executor.connect(user).processExpiredMessages([messageId])
      ).to.be.reverted;
    });
  });

  describe("Fee Calculation", function () {
    it("Should calculate fee correctly", async function () {
      const weight: bigint = 1000000000n;
      const amount: bigint = ethers.parseEther("100");
      
      const fee: bigint = await executor.calculateFee(DESTINATION_CHAIN_ID, weight, amount);
      
      const expectedFee: bigint = BASE_FEE + (WEIGHT_FEE * weight) / 1000000n;
      const minFee: bigint = await executor.MIN_FEE();
      
      if (expectedFee > minFee) {
        expect(fee).to.equal(expectedFee);
      } else {
        expect(fee).to.equal(minFee);
      }
    });

    it("Should return min fee when calculation below min", async function () {
      const weight: bigint = 1000n; // Very low weight
      const amount: bigint = ethers.parseEther("1");
      
      const fee: bigint = await executor.calculateFee(DESTINATION_CHAIN_ID, weight, amount);
      
      expect(fee).to.equal(MIN_FEE);
    });

    it("Should return max uint256 for unsupported chain", async function () {
      const weight: bigint = 1000000000n;
      const amount: bigint = ethers.parseEther("100");
      
      const fee: bigint = await executor.calculateFee(9999, weight, amount);
      
      expect(fee).to.equal(ethers.MaxUint256);
    });
  });

  describe("Nonce Management", function () {
    it("Should increment nonce for each message", async function () {
      const instruction: XCMInstruction = {
        destinationChainId: DESTINATION_CHAIN_ID,
        sender: user.address,
        recipient: recipient.address,
        asset: await mockToken.getAddress(),
        amount: ethers.parseEther("100"),
        callData: "0x",
        weight: 1000000000n,
        transactWeight: 2000000000n,
        timeout: 3600
      };

      await mockToken.connect(user).approve(
        await executor.getAddress(),
        ethers.parseEther("1000")
      );

      const fee: bigint = await executor.calculateFee(
        DESTINATION_CHAIN_ID,
        instruction.weight,
        instruction.amount
      );

      const nonceBefore: bigint = await executor.getNonce(user.address, DESTINATION_CHAIN_ID);

      await executor.connect(user).sendXCM(instruction, { value: fee });

      const nonceAfter: bigint = await executor.getNonce(user.address, DESTINATION_CHAIN_ID);
      
      expect(nonceAfter).to.equal(nonceBefore + 1n);
    });
  });

  describe("Role Management", function () {
    it("Should have DEFAULT_ADMIN_ROLE", async function () {
      const DEFAULT_ADMIN_ROLE = await executor.DEFAULT_ADMIN_ROLE();
      expect(await executor.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
    });

    it("Should have CONFIGURATOR_ROLE", async function () {
      const CONFIGURATOR_ROLE = await executor.CONFIGURATOR_ROLE();
      expect(await executor.hasRole(CONFIGURATOR_ROLE, deployer.address)).to.be.true;
    });

    it("Should grant and revoke roles", async function () {
      const EXECUTOR_ROLE = await executor.EXECUTOR_ROLE();
      
      await executor.grantRole(EXECUTOR_ROLE, user.address);
      expect(await executor.hasRole(EXECUTOR_ROLE, user.address)).to.be.true;
      
      await executor.revokeRole(EXECUTOR_ROLE, user.address);
      expect(await executor.hasRole(EXECUTOR_ROLE, user.address)).to.be.false;
    });
  });

  describe("Message Verification", function () {
    it("Should verify message with proof", async function () {
      const instruction: XCMInstruction = {
        destinationChainId: DESTINATION_CHAIN_ID,
        sender: user.address,
        recipient: recipient.address,
        asset: await mockToken.getAddress(),
        amount: ethers.parseEther("100"),
        callData: "0x",
        weight: 1000000000n,
        transactWeight: 2000000000n,
        timeout: 3600
      };

      await mockToken.connect(user).approve(
        await executor.getAddress(),
        ethers.parseEther("1000")
      );

      const fee: bigint = await executor.calculateFee(
        DESTINATION_CHAIN_ID,
        instruction.weight,
        instruction.amount
      );

      const tx = await executor.connect(user).sendXCM(instruction, { value: fee });
      const receipt = await tx.wait();
      
      const event = receipt?.logs.find(
        (e: any) => e.fragment && e.fragment.name === "XCMMessagePrepared"
      );
      const messageId: string = event?.args[0];

      const encodedMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(uint32,address,address,address,uint128,bytes,uint64,uint128,uint64)"],
        [[
          instruction.destinationChainId,
          instruction.sender,
          instruction.recipient,
          instruction.asset,
          instruction.amount,
          instruction.callData,
          instruction.weight,
          instruction.transactWeight,
          instruction.timeout
        ]]
      );

      const [isValid, decodedMessage] = await executor.verifyXCM(messageId, encodedMessage);
      
      expect(isValid).to.be.true;
      expect(decodedMessage).to.not.be.empty;
    });

    it("Should return false for invalid proof", async function () {
      const [isValid, decodedMessage] = await executor.verifyXCM(
        ethers.keccak256(ethers.toUtf8Bytes("invalid")),
        "0x"
      );
      
      expect(isValid).to.be.false;
      expect(decodedMessage).to.equal("0x");
    });
  });
});