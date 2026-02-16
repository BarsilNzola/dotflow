import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("LiquidityManager", function () {
  let liquidityManager: Contract;
  let deployer: SignerWithAddress;
  let provider1: SignerWithAddress;
  let provider2: SignerWithAddress;
  let borrower: SignerWithAddress;
  let mockToken: Contract;

  const FEE_RATE: number = 100; // 1%
  const MIN_LIQUIDITY: bigint = ethers.parseEther("100");
  const MAX_LIQUIDITY: bigint = ethers.parseEther("1000000");
  const RESERVE_FACTOR: number = 1000; // 10%

  beforeEach(async function () {
    [deployer, provider1, provider2, borrower] = await ethers.getSigners();

    // Deploy mock token
    const MockERC20: ContractFactory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Test Token", "TEST", 18);

    // Deploy LiquidityManager
    const LiquidityManager: ContractFactory = await ethers.getContractFactory("LiquidityManager");
    liquidityManager = await LiquidityManager.deploy();

    // Mint tokens
    await mockToken.mint(provider1.address, ethers.parseEther("10000"));
    await mockToken.mint(provider2.address, ethers.parseEther("5000"));
    await mockToken.mint(borrower.address, ethers.parseEther("20000"));

    // Create pool
    await liquidityManager.createPool(
      await mockToken.getAddress(),
      "Test Pool",
      "tPOOL",
      0n,
      FEE_RATE,
      RESERVE_FACTOR,
      MIN_LIQUIDITY,
      MAX_LIQUIDITY
    );

    // Grant LIQUIDITY_PROVIDER role
    const liquidityProviderRole: string = await liquidityManager.LIQUIDITY_PROVIDER();
    await liquidityManager.grantRole(liquidityProviderRole, deployer.address);
  });

  describe("Pool Creation", function () {
    it("Should create pool successfully", async function () {
      const tokenAddress: string = await mockToken.getAddress();
      const pool: any = await liquidityManager.getPoolInfo(tokenAddress);
      
      expect(pool.totalLiquidity).to.equal(0n);
      expect(pool.feeRate).to.equal(FEE_RATE);
      expect(pool.isActive).to.be.true;
    });

    it("Should not create duplicate pool", async function () {
      const tokenAddress: string = await mockToken.getAddress();
      await expect(
        liquidityManager.createPool(
          tokenAddress,
          "Test Pool",
          "tPOOL",
          0n,
          FEE_RATE,
          RESERVE_FACTOR,
          MIN_LIQUIDITY,
          MAX_LIQUIDITY
        )
      ).to.be.revertedWithCustomError(liquidityManager, "PoolAlreadyExists");
    });

    it("Should not allow fee rate too high", async function () {
      const tokenAddress: string = await mockToken.getAddress();
      const MockERC20: ContractFactory = await ethers.getContractFactory("MockERC20");
      const newToken: Contract = await MockERC20.deploy("New", "NEW", 18);
      
      await expect(
        liquidityManager.createPool(
          await newToken.getAddress(),
          "New Pool",
          "nPOOL",
          0n,
          2000, // 20% (max is 10%)
          RESERVE_FACTOR,
          MIN_LIQUIDITY,
          MAX_LIQUIDITY
        )
      ).to.be.revertedWithCustomError(liquidityManager, "FeeRateTooHigh");
    });
  });

  describe("Adding Liquidity", function () {
    beforeEach(async function () {
      await mockToken.connect(provider1).approve(
        await liquidityManager.getAddress(),
        ethers.parseEther("1000")
      );
    });

    it("Should add liquidity successfully", async function () {
      const amount: bigint = ethers.parseEther("500");
      
      await expect(
        liquidityManager.connect(provider1).addLiquidity(
          await mockToken.getAddress(),
          amount
        )
      ).to.emit(liquidityManager, "LiquidityAdded");

      const position: any = await liquidityManager.getProviderPosition(
        provider1.address,
        await mockToken.getAddress()
      );

      expect(position.shares).to.be.gt(0);
    });

    it("Should update pool total liquidity", async function () {
      const amount: bigint = ethers.parseEther("500");
      
      await liquidityManager.connect(provider1).addLiquidity(
        await mockToken.getAddress(),
        amount
      );

      const pool: any = await liquidityManager.getPoolInfo(await mockToken.getAddress());
      expect(pool.totalLiquidity).to.equal(amount);
    });

    it("Should not exceed max liquidity", async function () {
      const amount: bigint = ethers.parseEther("2000000"); // Exceeds MAX_LIQUIDITY
      
      await expect(
        liquidityManager.connect(provider1).addLiquidity(
          await mockToken.getAddress(),
          amount
        )
      ).to.be.revertedWith("Max liquidity exceeded");
    });

    it("Should track multiple providers", async function () {
      await mockToken.connect(provider1).approve(
        await liquidityManager.getAddress(),
        ethers.parseEther("500")
      );
      
      await mockToken.connect(provider2).approve(
        await liquidityManager.getAddress(),
        ethers.parseEther("300")
      );

      await liquidityManager.connect(provider1).addLiquidity(
        await mockToken.getAddress(),
        ethers.parseEther("500")
      );

      await liquidityManager.connect(provider2).addLiquidity(
        await mockToken.getAddress(),
        ethers.parseEther("300")
      );

      const providers: string[] = await liquidityManager.getPoolProviders(
        await mockToken.getAddress()
      );

      expect(providers).to.include(provider1.address);
      expect(providers).to.include(provider2.address);
      expect(providers.length).to.equal(2);
    });
  });

  describe("Removing Liquidity", function () {
    beforeEach(async function () {
      await mockToken.connect(provider1).approve(
        await liquidityManager.getAddress(),
        ethers.parseEther("1000")
      );

      await liquidityManager.connect(provider1).addLiquidity(
        await mockToken.getAddress(),
        ethers.parseEther("500")
      );
    });

    it("Should remove liquidity successfully", async function () {
      const shares: bigint = ethers.parseEther("500");
      
      // Advance time past lock period
      await time.increase(24 * 3600 + 1); // 1 day + 1 second
      
      await expect(
        liquidityManager.connect(provider1).removeLiquidity(
          await mockToken.getAddress(),
          shares
        )
      ).to.emit(liquidityManager, "LiquidityRemoved");

      const position: any = await liquidityManager.getProviderPosition(
        provider1.address,
        await mockToken.getAddress()
      );

      expect(position.shares).to.equal(0);
    });

    it("Should enforce lock time", async function () {
      const shares: bigint = ethers.parseEther("500");
      
      await expect(
        liquidityManager.connect(provider1).removeLiquidity(
          await mockToken.getAddress(),
          shares
        )
      ).to.be.revertedWithCustomError(liquidityManager, "LockTimeNotMet");
    });

    it("Should calculate fees correctly", async function () {
      // Wait for lock period
      await time.increase(24 * 3600 + 1); // 1 day + 1 second

      const shares: bigint = ethers.parseEther("500");
      
      const balanceBefore: bigint = await mockToken.balanceOf(provider1.address);
      
      await liquidityManager.connect(provider1).removeLiquidity(
        await mockToken.getAddress(),
        shares
      );

      const balanceAfter: bigint = await mockToken.balanceOf(provider1.address);
      const received: bigint = balanceAfter - balanceBefore;

      // Should receive less due to fees
      expect(received).to.be.lt(ethers.parseEther("500"));
    });
  });

  describe("Borrowing and Repaying", function () {
    beforeEach(async function () {
      // Add liquidity first
      await mockToken.connect(provider1).approve(
        await liquidityManager.getAddress(),
        ethers.parseEther("1000")
      );

      await liquidityManager.connect(provider1).addLiquidity(
        await mockToken.getAddress(),
        ethers.parseEther("1000")
      );

      // Grant LIQUIDITY_PROVIDER role to deployer for borrowing
      const liquidityProviderRole: string = await liquidityManager.LIQUIDITY_PROVIDER();
      await liquidityManager.grantRole(liquidityProviderRole, deployer.address);
    });

    it("Should borrow liquidity", async function () {
      const amount: bigint = ethers.parseEther("500");
      
      await expect(
        liquidityManager.connect(deployer).borrowLiquidity(
          await mockToken.getAddress(),
          amount,
          borrower.address
        )
      ).to.emit(liquidityManager, "LiquidityBorrowed");

      const pool: any = await liquidityManager.getPoolInfo(await mockToken.getAddress());
      expect(pool.borrowedLiquidity).to.equal(amount);
    });

    it("Should not borrow more than available", async function () {
      const amount: bigint = ethers.parseEther("2000"); // More than available
      
      await expect(
        liquidityManager.connect(deployer).borrowLiquidity(
          await mockToken.getAddress(),
          amount,
          borrower.address
        )
      ).to.be.revertedWithCustomError(liquidityManager, "InsufficientLiquidity");
    });

    it("Should repay liquidity", async function () {
      const amount: bigint = ethers.parseEther("500");
      
      await liquidityManager.connect(deployer).borrowLiquidity(
        await mockToken.getAddress(),
        amount,
        borrower.address
      );

      // Borrower repays
      await mockToken.connect(borrower).approve(
        await liquidityManager.getAddress(),
        amount
      );

      await expect(
        liquidityManager.connect(borrower).repayLiquidity(
          await mockToken.getAddress(),
          amount
        )
      ).to.emit(liquidityManager, "LiquidityRepaid");

      const pool: any = await liquidityManager.getPoolInfo(await mockToken.getAddress());
      expect(pool.borrowedLiquidity).to.equal(0);
    });
  });

  describe("Fee Collection", function () {
    beforeEach(async function () {
      await mockToken.connect(provider1).approve(
        await liquidityManager.getAddress(),
        ethers.parseEther("1000")
      );

      await liquidityManager.connect(provider1).addLiquidity(
        await mockToken.getAddress(),
        ethers.parseEther("1000")
      );

      // Advance time to accrue fees
      await time.increase(7 * 24 * 3600); // 1 week
    });

    it("Should claim fees", async function () {
      await expect(
        liquidityManager.connect(provider1).claimFees(
          await mockToken.getAddress()
        )
      ).to.emit(liquidityManager, "FeesClaimed");
    });

    it("Should track pending fees", async function () {
      const position: any = await liquidityManager.getProviderPosition(
        provider1.address,
        await mockToken.getAddress()
      );

      expect(position.pendingFees).to.be.gt(0);
    });
  });

  describe("Admin Functions", function () {
    it("Should update pool config", async function () {
      const newFeeRate: number = 200; // 2%
      
      await liquidityManager.updatePoolConfig(
        await mockToken.getAddress(),
        newFeeRate,
        RESERVE_FACTOR,
        MAX_LIQUIDITY
      );

      const pool: any = await liquidityManager.getPoolInfo(await mockToken.getAddress());
      expect(pool.feeRate).to.equal(newFeeRate);
    });

    it("Should deactivate pool", async function () {
      await liquidityManager.deactivatePool(await mockToken.getAddress());
      
      const pool: any = await liquidityManager.getPoolInfo(await mockToken.getAddress());
      expect(pool.isActive).to.be.false;
    });

    it("Should not deactivate pool with liquidity", async function () {
      // Add liquidity
      await mockToken.connect(provider1).approve(
        await liquidityManager.getAddress(),
        ethers.parseEther("500")
      );

      await liquidityManager.connect(provider1).addLiquidity(
        await mockToken.getAddress(),
        ethers.parseEther("500")
      );

      await expect(
        liquidityManager.deactivatePool(await mockToken.getAddress())
      ).to.be.revertedWith("Cannot deactivate pool with liquidity");
    });
  });
});