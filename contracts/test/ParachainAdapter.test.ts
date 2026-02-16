import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ParachainAdapter", function () {
  let adapter: Contract;
  let crossChainExecutor: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let bridgeOperator: SignerWithAddress;
  let mockToken: Contract;
  let mockToken2: Contract;

  const ADAPTER_FEE: number = 25; // 0.25%
  const MIN_SWAP: bigint = ethers.parseEther("0.01");
  const MAX_SWAP: bigint = ethers.parseEther("1000");
  const PARACHAIN_ID: number = 3000;
  const PARACHAIN_NAME: string = "Polkadot Hub";
  const BRIDGE_FEE: number = 10; // 0.1%
  const MIN_TRANSFER: bigint = ethers.parseEther("1");
  const MAX_TRANSFER: bigint = ethers.parseEther("10000");
  const TIMEOUT: number = 3600;

  beforeEach(async function () {
    [deployer, user, feeCollector, bridgeOperator] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20: ContractFactory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Test Token", "TEST", 18);
    mockToken2 = await MockERC20.deploy("Test Token 2", "TST2", 18);

    // Deploy CrossChainExecutor
    const CrossChainExecutor: ContractFactory = await ethers.getContractFactory("CrossChainExecutor");
    crossChainExecutor = await CrossChainExecutor.deploy();

    // Deploy ParachainAdapter
    const ParachainAdapter: ContractFactory = await ethers.getContractFactory("ParachainAdapter");
    adapter = await ParachainAdapter.deploy(
      "Test Parachain Adapter",
      await crossChainExecutor.getAddress(),
      ADAPTER_FEE,
      MIN_SWAP,
      MAX_SWAP
    );

    // Grant roles
    const ADAPTER_ADMIN: string = await adapter.ADAPTER_ADMIN();
    await adapter.grantRole(ADAPTER_ADMIN, deployer.address);
    
    const BRIDGE_OPERATOR: string = await adapter.BRIDGE_OPERATOR();
    await adapter.grantRole(BRIDGE_OPERATOR, bridgeOperator.address);

    // Configure parachain
    await adapter.configureParachain(
      PARACHAIN_ID,
      PARACHAIN_NAME,
      BRIDGE_FEE,
      MIN_TRANSFER,
      MAX_TRANSFER,
      TIMEOUT
    );

    // Map tokens
    const assetId1: string = ethers.zeroPadBytes(ethers.toBeHex(await mockToken.getAddress()), 32);
    const assetId2: string = ethers.zeroPadBytes(ethers.toBeHex(await mockToken2.getAddress()), 32);

    await adapter.mapToken(
      await mockToken.getAddress(),
      PARACHAIN_ID,
      assetId1,
      18,
      MIN_TRANSFER,
      MAX_TRANSFER,
      false
    );

    await adapter.mapToken(
      await mockToken2.getAddress(),
      PARACHAIN_ID,
      assetId2,
      18,
      MIN_TRANSFER,
      MAX_TRANSFER,
      false
    );

    // Mint tokens for user
    await mockToken.mint(user.address, ethers.parseEther("10000"));
    await mockToken2.mint(user.address, ethers.parseEther("10000"));

    // Configure CrossChainExecutor for the parachain
    await crossChainExecutor.configureChain(
      PARACHAIN_ID,
      PARACHAIN_NAME,
      ethers.parseEther("0.01"), // baseFee
      ethers.parseEther("0.0001"), // weightFee
      ethers.parseEther("0.005"), // minFee
      10000000000, // maxWeight
      "0x0000000000000000000000000000000000000800",
      ethers.hexlify(ethers.randomBytes(32))
    );
  });

  describe("Initialization", function () {
    it("Should set correct parameters", async function () {
      expect(await adapter.name()).to.equal("Test Parachain Adapter");
      expect(await adapter.fee()).to.equal(ADAPTER_FEE);
      expect(await adapter.minSwapAmount()).to.equal(MIN_SWAP);
      expect(await adapter.maxSwapAmount()).to.equal(MAX_SWAP);
      expect(await adapter.isActive()).to.be.true;
    });

    it("Should have correct roles", async function () {
      const DEFAULT_ADMIN_ROLE: string = await adapter.DEFAULT_ADMIN_ROLE();
      expect(await adapter.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
      
      const ADAPTER_ADMIN: string = await adapter.ADAPTER_ADMIN();
      expect(await adapter.hasRole(ADAPTER_ADMIN, deployer.address)).to.be.true;
    });

    it("Should configure parachain correctly", async function () {
      const config: any = await adapter.getParachainConfig(PARACHAIN_ID);
      expect(config.name).to.equal(PARACHAIN_NAME);
      expect(config.bridgeFee).to.equal(BRIDGE_FEE);
      expect(config.minTransfer).to.equal(MIN_TRANSFER);
      expect(config.maxTransfer).to.equal(MAX_TRANSFER);
      expect(config.timeout).to.equal(TIMEOUT);
      expect(config.isActive).to.be.true;
    });

    it("Should map tokens correctly", async function () {
      const mapping: any = await adapter.getTokenMapping(
        await mockToken.getAddress(),
        PARACHAIN_ID
      );
      
      expect(mapping.erc20Address).to.equal(await mockToken.getAddress());
      expect(mapping.isActive).to.be.true;
      expect(mapping.minTransfer).to.equal(MIN_TRANSFER);
      expect(mapping.maxTransfer).to.equal(MAX_TRANSFER);
    });
  });

  describe("Token Swaps", function () {
    beforeEach(async function () {
      await mockToken.connect(user).approve(
        await adapter.getAddress(),
        ethers.parseEther("1000")
      );
    });

    it("Should execute swap successfully", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      const data: string = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint32", "bytes"],
        [PARACHAIN_ID, "0x"]
      );

      const balanceBefore: bigint = await mockToken.balanceOf(user.address);

      const [amountOut, fee] = await adapter.swapExactTokensForTokens(
        await mockToken.getAddress(),
        await mockToken2.getAddress(), // tokenOut (same for test)
        amountIn,
        0n,
        user.address,
        data
      );

      const balanceAfter: bigint = await mockToken.balanceOf(user.address);
      
      // Tokens should be transferred out (minus fees)
      expect(balanceAfter).to.be.lt(balanceBefore);
      expect(amountOut).to.be.gt(0);
      expect(fee).to.equal((amountIn * BigInt(ADAPTER_FEE)) / 10000n);
    });

    it("Should respect min swap amount", async function () {
      const amountIn: bigint = ethers.parseEther("0.001"); // Below min
      const data: string = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint32", "bytes"],
        [PARACHAIN_ID, "0x"]
      );

      await expect(
        adapter.swapExactTokensForTokens(
          await mockToken.getAddress(),
          await mockToken2.getAddress(),
          amountIn,
          0n,
          user.address,
          data
        )
      ).to.be.revertedWithCustomError(adapter, "InvalidAmount");
    });

    it("Should respect max swap amount", async function () {
      const amountIn: bigint = ethers.parseEther("2000"); // Above max
      const data: string = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint32", "bytes"],
        [PARACHAIN_ID, "0x"]
      );

      await expect(
        adapter.swapExactTokensForTokens(
          await mockToken.getAddress(),
          await mockToken2.getAddress(),
          amountIn,
          0n,
          user.address,
          data
        )
      ).to.be.revertedWithCustomError(adapter, "InvalidAmount");
    });

    it("Should revert with unsupported parachain", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      const invalidParachainId: number = 9999;
      const data: string = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint32", "bytes"],
        [invalidParachainId, "0x"]
      );

      await expect(
        adapter.swapExactTokensForTokens(
          await mockToken.getAddress(),
          await mockToken2.getAddress(),
          amountIn,
          0n,
          user.address,
          data
        )
      ).to.be.revertedWithCustomError(adapter, "ParachainNotSupported");
    });

    it("Should revert with unmapped token", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      const unmappedToken: Contract = await (await ethers.getContractFactory("MockERC20")).deploy("Unmapped", "UMP", 18);
      
      const data: string = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint32", "bytes"],
        [PARACHAIN_ID, "0x"]
      );

      await expect(
        adapter.swapExactTokensForTokens(
          await unmappedToken.getAddress(),
          await mockToken2.getAddress(),
          amountIn,
          0n,
          user.address,
          data
        )
      ).to.be.revertedWithCustomError(adapter, "TokenNotMapped");
    });
  });

  describe("Quote Functionality", function () {
    it("Should get accurate quote", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      
      const [amountOut, fee, priceImpact] = await adapter.getAmountOut(
        await mockToken.getAddress(),
        await mockToken2.getAddress(),
        amountIn
      );

      const expectedFee: bigint = (amountIn * BigInt(ADAPTER_FEE)) / 10000n;
      
      expect(amountOut).to.equal(amountIn - expectedFee);
      expect(fee).to.equal(ADAPTER_FEE);
      expect(priceImpact).to.equal(0);
    });

    it("Should respect min swap amount in quote", async function () {
      const amountIn: bigint = ethers.parseEther("0.001"); // Below min
      
      await expect(
        adapter.getAmountOut(
          await mockToken.getAddress(),
          await mockToken2.getAddress(),
          amountIn
        )
      ).to.be.revertedWithCustomError(adapter, "InvalidAmount");
    });
  });

  describe("Parachain Configuration", function () {
    it("Should update parachain config", async function () {
      const newBridgeFee: number = 20; // 0.2%
      const newMinTransfer: bigint = ethers.parseEther("2");
      const newMaxTransfer: bigint = ethers.parseEther("20000");
      const newTimeout: number = 7200;

      await adapter.updateParachainConfig(
        PARACHAIN_ID,
        newBridgeFee,
        newMinTransfer,
        newMaxTransfer,
        newTimeout,
        true
      );

      const config: any = await adapter.getParachainConfig(PARACHAIN_ID);
      expect(config.bridgeFee).to.equal(newBridgeFee);
      expect(config.minTransfer).to.equal(newMinTransfer);
      expect(config.maxTransfer).to.equal(newMaxTransfer);
      expect(config.timeout).to.equal(newTimeout);
    });

    it("Should deactivate parachain", async function () {
      await adapter.updateParachainConfig(
        PARACHAIN_ID,
        0,
        0,
        0,
        0,
        false
      );

      const config: any = await adapter.getParachainConfig(PARACHAIN_ID);
      expect(config.isActive).to.be.false;
    });

    it("Should not allow bridge fee too high", async function () {
      const MAX_FEE: number = await adapter.MAX_FEE();
      
      await expect(
        adapter.configureParachain(
          PARACHAIN_ID + 1,
          "New Parachain",
          MAX_FEE + 1,
          MIN_TRANSFER,
          MAX_TRANSFER,
          TIMEOUT
        )
      ).to.be.revertedWithCustomError(adapter, "BridgeFeeTooHigh");
    });
  });

  describe("Token Mapping", function () {
    it("Should unmap token", async function () {
      await adapter.unmapToken(await mockToken.getAddress(), PARACHAIN_ID);

      const mapping: any = await adapter.getTokenMapping(
        await mockToken.getAddress(),
        PARACHAIN_ID
      );
      
      expect(mapping.isActive).to.be.false;
    });

    it("Should get parachain tokens", async function () {
      const tokens: string[] = await adapter.getParachainTokens(PARACHAIN_ID);
      
      expect(tokens).to.include(await mockToken.getAddress());
      expect(tokens).to.include(await mockToken2.getAddress());
      expect(tokens.length).to.equal(2);
    });

    it("Should get supported parachains", async function () {
      const parachains: number[] = await adapter.getSupportedParachains();
      expect(parachains).to.include(PARACHAIN_ID);
    });

    it("Should get asset ID", async function () {
      const assetId: string = await adapter.getAssetId(
        await mockToken.getAddress(),
        PARACHAIN_ID
      );
      
      expect(assetId).to.not.be.empty;
    });
  });

  describe("Liquidity Management", function () {
    beforeEach(async function () {
      await mockToken.mint(bridgeOperator.address, ethers.parseEther("10000"));
      await mockToken.connect(bridgeOperator).approve(
        await adapter.getAddress(),
        ethers.parseEther("1000")
      );
    });

    it("Should add liquidity", async function () {
      const amount: bigint = ethers.parseEther("500");
      
      await expect(
        adapter.connect(bridgeOperator).addLiquidity(
          await mockToken.getAddress(),
          amount,
          "0x"
        )
      ).to.emit(adapter, "LiquidityAdded");
    });

    it("Should remove liquidity", async function () {
      const amount: bigint = ethers.parseEther("500");
      
      // First add liquidity
      await adapter.connect(bridgeOperator).addLiquidity(
        await mockToken.getAddress(),
        amount,
        "0x"
      );

      await expect(
        adapter.connect(bridgeOperator).removeLiquidity(
          await mockToken.getAddress(),
          amount,
          "0x"
        )
      ).to.emit(adapter, "LiquidityRemoved");
    });

    it("Should not allow non-bridge-operator to add liquidity", async function () {
      const amount: bigint = ethers.parseEther("500");
      
      await expect(
        adapter.connect(user).addLiquidity(
          await mockToken.getAddress(),
          amount,
          "0x"
        )
      ).to.be.reverted;
    });
  });

  describe("Admin Functions", function () {
    it("Should update fee", async function () {
      const newFee: number = 50; // 0.5%
      await adapter.setFee(newFee);
      expect(await adapter.fee()).to.equal(newFee);
    });

    it("Should not exceed max fee", async function () {
      const maxFee: number = await adapter.MAX_FEE();
      await expect(
        adapter.setFee(maxFee + 1)
      ).to.be.revertedWith("Fee too high");
    });

    it("Should update swap limits", async function () {
      const newMin: bigint = ethers.parseEther("0.1");
      const newMax: bigint = ethers.parseEther("500");
      
      await adapter.setSwapLimits(newMin, newMax);
      
      expect(await adapter.minSwapAmount()).to.equal(newMin);
      expect(await adapter.maxSwapAmount()).to.equal(newMax);
    });

    it("Should update XCM executor", async function () {
      const MockXCMExecutor = await (await ethers.getContractFactory("CrossChainExecutor")).deploy();
      const newExecutor: string = await MockXCMExecutor.getAddress();
      
      await adapter.setXCMExecutor(newExecutor);
      // Can't directly check XCM executor as it's private, but function should not revert
    });

    it("Should activate/deactivate", async function () {
      await adapter.setActive(false);
      expect(await adapter.isActive()).to.be.false;

      await adapter.setActive(true);
      expect(await adapter.isActive()).to.be.true;
    });

    it("Should rescue tokens", async function () {
      const amount: bigint = ethers.parseEther("100");
      
      // Transfer tokens to adapter
      await mockToken.transfer(await adapter.getAddress(), amount);
      
      const balanceBefore: bigint = await mockToken.balanceOf(deployer.address);
      
      await adapter.rescueTokens(
        await mockToken.getAddress(),
        deployer.address,
        amount
      );

      const balanceAfter: bigint = await mockToken.balanceOf(deployer.address);
      expect(balanceAfter - balanceBefore).to.equal(amount);
    });
  });

  describe("Adapter Info", function () {
    it("Should return correct adapter info", async function () {
      const info: any = await adapter.getAdapterInfo();
      
      expect(info.name).to.equal("Test Parachain Adapter");
      expect(info.adapterAddress).to.equal(await adapter.getAddress());
      expect(info.isActive).to.be.true;
      expect(info.fee).to.equal(ADAPTER_FEE);
      expect(info.minSwapAmount).to.equal(MIN_SWAP);
      expect(info.maxSwapAmount).to.equal(MAX_SWAP);
    });

    it("Should check token support", async function () {
      expect(await adapter.isTokenSupported(await mockToken.getAddress())).to.be.true;
      expect(await adapter.isTokenSupported(ethers.ZeroAddress)).to.be.false;
    });
  });
});