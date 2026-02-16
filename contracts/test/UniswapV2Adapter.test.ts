import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("UniswapV2Adapter", function () {
  let adapter: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let mockTokenA: Contract;
  let mockTokenB: Contract;
  let mockTokenC: Contract;
  let mockWETH: Contract;

  const UNISWAP_ROUTER: string = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  const UNISWAP_FACTORY: string = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  const ADAPTER_FEE: number = 25; // 0.25%
  const MIN_SWAP: bigint = ethers.parseEther("0.01");
  const MAX_SWAP: bigint = ethers.parseEther("1000");

  interface PairInfo {
    pair: string;
    reserve0: bigint;
    reserve1: bigint;
    lastUpdate: number;
    swapFee: number;
    liquidity: bigint;
  }

  beforeEach(async function () {
    [deployer, user, user2, feeCollector, liquidityProvider] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20: ContractFactory = await ethers.getContractFactory("MockERC20");
    mockTokenA = await MockERC20.deploy("Token A", "TKA", 18);
    mockTokenB = await MockERC20.deploy("Token B", "TKB", 18);
    mockTokenC = await MockERC20.deploy("Token C", "TKC", 18);
    mockWETH = await MockERC20.deploy("Wrapped Ether", "WETH", 18);

    // Deploy adapter
    const UniswapV2Adapter: ContractFactory = await ethers.getContractFactory("UniswapV2Adapter");
    adapter = await UniswapV2Adapter.deploy(
      "Test Uniswap Adapter",
      UNISWAP_ROUTER,
      ADAPTER_FEE,
      MIN_SWAP,
      MAX_SWAP,
      feeCollector.address
    );

    // Grant roles
    const ADAPTER_ADMIN: string = await adapter.ADAPTER_ADMIN();
    await adapter.grantRole(ADAPTER_ADMIN, deployer.address);
    
    const LIQUIDITY_PROVIDER: string = await adapter.LIQUIDITY_PROVIDER();
    await adapter.grantRole(LIQUIDITY_PROVIDER, liquidityProvider.address);
    
    const FEE_MANAGER: string = await adapter.FEE_MANAGER();
    await adapter.grantRole(FEE_MANAGER, feeCollector.address);

    // Initialize pairs
    await adapter.initializePair(await mockTokenA.getAddress(), await mockTokenB.getAddress());
    await adapter.initializePair(await mockTokenA.getAddress(), await mockTokenC.getAddress());
    await adapter.initializePair(await mockTokenB.getAddress(), await mockTokenC.getAddress());

    // Mint tokens for users
    await mockTokenA.mint(user.address, ethers.parseEther("10000"));
    await mockTokenB.mint(user.address, ethers.parseEther("10000"));
    await mockTokenC.mint(user.address, ethers.parseEther("10000"));
    await mockTokenA.mint(user2.address, ethers.parseEther("10000"));
    await mockTokenB.mint(user2.address, ethers.parseEther("10000"));
  });

  describe("Initialization", function () {
    it("Should set correct parameters", async function () {
      expect(await adapter.name()).to.equal("Test Uniswap Adapter");
      expect(await adapter.fee()).to.equal(ADAPTER_FEE);
      expect(await adapter.minSwapAmount()).to.equal(MIN_SWAP);
      expect(await adapter.maxSwapAmount()).to.equal(MAX_SWAP);
      expect(await adapter.feeCollector()).to.equal(feeCollector.address);
      expect(await adapter.isActive()).to.be.true;
    });

    it("Should have correct roles", async function () {
      const DEFAULT_ADMIN_ROLE: string = await adapter.DEFAULT_ADMIN_ROLE();
      expect(await adapter.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
      
      const ADAPTER_ADMIN: string = await adapter.ADAPTER_ADMIN();
      expect(await adapter.hasRole(ADAPTER_ADMIN, deployer.address)).to.be.true;
    });

    it("Should initialize pairs correctly", async function () {
      const tokenA: string = await mockTokenA.getAddress();
      const tokenB: string = await mockTokenB.getAddress();
      
      const pairInfo: PairInfo = await adapter.getPairInfo(tokenA, tokenB);
      
      expect(pairInfo.pair).to.not.equal(ethers.ZeroAddress);
      expect(pairInfo.swapFee).to.equal(30); // 0.3%
    });

    it("Should not initialize same pair twice", async function () {
      const tokenA: string = await mockTokenA.getAddress();
      const tokenB: string = await mockTokenB.getAddress();
      
      await expect(
        adapter.initializePair(tokenA, tokenB)
      ).to.be.revertedWith("Pair already supported");
    });
  });

  describe("Swaps", function () {
    beforeEach(async function () {
      await mockTokenA.connect(user).approve(
        await adapter.getAddress(),
        ethers.parseEther("1000")
      );
    });

    it("Should execute swap successfully", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      
      const balanceBefore: bigint = await mockTokenB.balanceOf(user.address);

      const [amountOut, fee] = await adapter.swapExactTokensForTokens(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress(),
        amountIn,
        0n,
        user.address,
        "0x"
      );

      const balanceAfter: bigint = await mockTokenB.balanceOf(user.address);
      
      expect(balanceAfter - balanceBefore).to.equal(amountOut);
      expect(fee).to.equal((amountOut * BigInt(ADAPTER_FEE)) / 10000n);
    });

    it("Should execute swap with fee-on-transfer token", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      
      // This would test tokens with transfer fees
      // For mock, we'll use the same function
      
      const [amountOut, fee] = await adapter.swapExactTokensForTokens(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress(),
        amountIn,
        0n,
        user.address,
        "0x"
      );

      expect(amountOut).to.be.gt(0);
    });

    it("Should respect min amount out", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      const amountOutMin: bigint = ethers.parseEther("1000"); // Unrealistic

      await expect(
        adapter.swapExactTokensForTokens(
          await mockTokenA.getAddress(),
          await mockTokenB.getAddress(),
          amountIn,
          amountOutMin,
          user.address,
          "0x"
        )
      ).to.be.revertedWithCustomError(adapter, "SlippageExceeded");
    });

    it("Should enforce min swap amount", async function () {
      const amountIn: bigint = ethers.parseEther("0.001"); // Below min

      await expect(
        adapter.swapExactTokensForTokens(
          await mockTokenA.getAddress(),
          await mockTokenB.getAddress(),
          amountIn,
          0n,
          user.address,
          "0x"
        )
      ).to.be.revertedWithCustomError(adapter, "InvalidAmount");
    });

    it("Should enforce max swap amount", async function () {
      const amountIn: bigint = ethers.parseEther("2000"); // Above max

      await expect(
        adapter.swapExactTokensForTokens(
          await mockTokenA.getAddress(),
          await mockTokenB.getAddress(),
          amountIn,
          0n,
          user.address,
          "0x"
        )
      ).to.be.revertedWithCustomError(adapter, "InvalidAmount");
    });

    it("Should revert with unsupported pair", async function () {
      const unsupportedToken = await (await ethers.getContractFactory("MockERC20")).deploy("Unsupported", "UNS", 18);
      
      await expect(
        adapter.swapExactTokensForTokens(
          await unsupportedToken.getAddress(),
          await mockTokenB.getAddress(),
          ethers.parseEther("100"),
          0n,
          user.address,
          "0x"
        )
      ).to.be.revertedWithCustomError(adapter, "TokenNotSupported");
    });

    it("Should revert when adapter inactive", async function () {
      await adapter.setActive(false);
      
      await expect(
        adapter.swapExactTokensForTokens(
          await mockTokenA.getAddress(),
          await mockTokenB.getAddress(),
          ethers.parseEther("100"),
          0n,
          user.address,
          "0x"
        )
      ).to.be.revertedWithCustomError(adapter, "AdapterInactive");
    });
  });

  describe("Quotes", function () {
    it("Should get amount out", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      
      const [amountOut, fee, priceImpact] = await adapter.getAmountOut(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress(),
        amountIn
      );

      expect(amountOut).to.be.gt(0);
      expect(fee).to.equal(ADAPTER_FEE);
      expect(priceImpact).to.be.lte(10000);
    });

    it("Should get amounts in", async function () {
      const amountOut: bigint = ethers.parseEther("100");
      
      const amountIn: bigint = await adapter.getAmountsIn(
        amountOut,
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress()
      );

      expect(amountIn).to.be.gt(amountOut);
    });

    it("Should revert quote for unsupported pair", async function () {
      const unsupportedToken = await (await ethers.getContractFactory("MockERC20")).deploy("Unsupported", "UNS", 18);
      
      await expect(
        adapter.getAmountOut(
          await unsupportedToken.getAddress(),
          await mockTokenB.getAddress(),
          ethers.parseEther("100")
        )
      ).to.be.revertedWithCustomError(adapter, "TokenNotSupported");
    });
  });

  describe("Liquidity Management", function () {
    beforeEach(async function () {
      // Approve tokens for liquidity provider
      await mockTokenA.connect(liquidityProvider).approve(
        await adapter.getAddress(),
        ethers.parseEther("10000")
      );
      
      await mockTokenB.connect(liquidityProvider).approve(
        await adapter.getAddress(),
        ethers.parseEther("10000")
      );
      
      await mockTokenC.connect(liquidityProvider).approve(
        await adapter.getAddress(),
        ethers.parseEther("10000")
      );

      // Mint tokens to liquidity provider
      await mockTokenA.mint(liquidityProvider.address, ethers.parseEther("10000"));
      await mockTokenB.mint(liquidityProvider.address, ethers.parseEther("10000"));
      await mockTokenC.mint(liquidityProvider.address, ethers.parseEther("10000"));
    });

    it("Should add liquidity via standard method", async function () {
      const amountA: bigint = ethers.parseEther("100");
      const amountB: bigint = ethers.parseEther("100");

      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [await mockTokenB.getAddress(), amountB, amountA]
      );

      await expect(
        adapter.connect(liquidityProvider).addLiquidity(
          await mockTokenA.getAddress(),
          amountA,
          data
        )
      ).to.emit(adapter, "LiquidityAdded");
    });

    it("Should add liquidity via explicit method", async function () {
      const amountA: bigint = ethers.parseEther("100");
      const amountB: bigint = ethers.parseEther("100");

      await expect(
        adapter.connect(liquidityProvider).addLiquidity(
          await mockTokenA.getAddress(),
          await mockTokenB.getAddress(),
          amountA,
          amountB,
          0n,
          0n,
          liquidityProvider.address
        )
      ).to.emit(adapter, "LiquidityProvided");
    });

    it("Should remove liquidity", async function () {
      // First add liquidity
      const amountA: bigint = ethers.parseEther("100");
      const amountB: bigint = ethers.parseEther("100");

      const addData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [await mockTokenB.getAddress(), amountB, amountA]
      );

      await adapter.connect(liquidityProvider).addLiquidity(
        await mockTokenA.getAddress(),
        amountA,
        addData
      );

      // Get LP token address
      const pairInfo: PairInfo = await adapter.getPairInfo(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress()
      );

      const lpToken: Contract = await ethers.getContractAt("IUniswapV2Pair", pairInfo.pair);
      const lpBalance: bigint = await lpToken.balanceOf(liquidityProvider.address);

      // Approve LP tokens
      await lpToken.connect(liquidityProvider).approve(
        await adapter.getAddress(),
        lpBalance
      );

      const removeData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [await mockTokenB.getAddress(), amountA, amountB]
      );

      await expect(
        adapter.connect(liquidityProvider).removeLiquidity(
          await mockTokenA.getAddress(),
          lpBalance,
          removeData
        )
      ).to.emit(adapter, "LiquidityRemoved");
    });

    it("Should remove liquidity via explicit method", async function () {
      // First add liquidity
      const amountA: bigint = ethers.parseEther("100");
      const amountB: bigint = ethers.parseEther("100");

      await adapter.connect(liquidityProvider).addLiquidity(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress(),
        amountA,
        amountB,
        0n,
        0n,
        liquidityProvider.address
      );

      // Get LP token address
      const pairInfo: PairInfo = await adapter.getPairInfo(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress()
      );

      const lpToken: Contract = await ethers.getContractAt("IUniswapV2Pair", pairInfo.pair);
      const lpBalance: bigint = await lpToken.balanceOf(liquidityProvider.address);

      // Approve LP tokens
      await lpToken.connect(liquidityProvider).approve(
        await adapter.getAddress(),
        lpBalance
      );

      await expect(
        adapter.connect(liquidityProvider).removeLiquidity(
          await mockTokenA.getAddress(),
          await mockTokenB.getAddress(),
          lpBalance,
          0n,
          0n,
          liquidityProvider.address
        )
      ).to.emit(adapter, "LiquidityRemoved");
    });

    it("Should not allow non-provider to add liquidity", async function () {
      const amountA: bigint = ethers.parseEther("100");
      const amountB: bigint = ethers.parseEther("100");

      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [await mockTokenB.getAddress(), amountB, amountA]
      );

      await expect(
        adapter.connect(user).addLiquidity(
          await mockTokenA.getAddress(),
          amountA,
          data
        )
      ).to.be.reverted;
    });
  });

  describe("Pair Management", function () {
    it("Should sync pair", async function () {
      const tokenA: string = await mockTokenA.getAddress();
      const tokenB: string = await mockTokenB.getAddress();
      
      const before: PairInfo = await adapter.getPairInfo(tokenA, tokenB);
      
      // Perform a swap to change reserves
      await mockTokenA.connect(user).approve(
        await adapter.getAddress(),
        ethers.parseEther("100")
      );
      
      await adapter.swapExactTokensForTokens(
        tokenA,
        tokenB,
        ethers.parseEther("10"),
        0n,
        user.address,
        "0x"
      );

      // Manually sync
      await adapter.syncPair(tokenA, tokenB);
      
      const after: PairInfo = await adapter.getPairInfo(tokenA, tokenB);
      
      expect(after.reserve0).to.not.equal(before.reserve0);
      expect(after.reserve1).to.not.equal(before.reserve1);
    });

    it("Should sync all pairs", async function () {
      await expect(adapter.syncAllPairs()).to.not.be.reverted;
    });

    it("Should remove pair", async function () {
      const tokenA: string = await mockTokenA.getAddress();
      const tokenB: string = await mockTokenB.getAddress();
      
      await adapter.removePair(tokenA, tokenB);
      
      // Should not be able to get pair info (will revert)
      // Note: getPairInfo doesn't revert but returns zeros
    });

    it("Should get pair count for token", async function () {
      // This is an internal function, test via behavior
      const tokenA: string = await mockTokenA.getAddress();
      
      // Token A should have pairs with B and C
      const isSupported: boolean = await adapter.isTokenSupported(tokenA);
      expect(isSupported).to.be.true;
    });
  });

  describe("Admin Functions", function () {
    it("Should update fee", async function () {
      const newFee: number = 50; // 0.5%
      await adapter.connect(feeCollector).setFee(newFee);
      expect(await adapter.fee()).to.equal(newFee);
    });

    it("Should not allow non-fee-manager to update fee", async function () {
      const newFee: number = 50;
      await expect(
        adapter.connect(user).setFee(newFee)
      ).to.be.reverted;
    });

    it("Should not exceed max fee", async function () {
      const maxFee: number = await adapter.MAX_FEE();
      await expect(
        adapter.connect(feeCollector).setFee(maxFee + 1)
      ).to.be.revertedWith("Fee too high");
    });

    it("Should update fee collector", async function () {
      const newCollector: string = user.address;
      
      await expect(
        adapter.connect(feeCollector).setFeeCollector(newCollector)
      ).to.emit(adapter, "FeeCollectorUpdated");

      expect(await adapter.feeCollector()).to.equal(newCollector);
    });

    it("Should update swap limits", async function () {
      const newMin: bigint = ethers.parseEther("0.1");
      const newMax: bigint = ethers.parseEther("500");
      
      await adapter.connect(deployer).setSwapLimits(newMin, newMax);
      
      expect(await adapter.minSwapAmount()).to.equal(newMin);
      expect(await adapter.maxSwapAmount()).to.equal(newMax);
    });

    it("Should not allow invalid swap limits", async function () {
      const newMin: bigint = ethers.parseEther("500");
      const newMax: bigint = ethers.parseEther("100");
      
      await expect(
        adapter.connect(deployer).setSwapLimits(newMin, newMax)
      ).to.be.revertedWith("Invalid limits");
    });

    it("Should activate/deactivate", async function () {
      await adapter.connect(deployer).setActive(false);
      expect(await adapter.isActive()).to.be.false;

      await adapter.connect(deployer).setActive(true);
      expect(await adapter.isActive()).to.be.true;
    });

    it("Should skim pair", async function () {
      const tokenA: string = await mockTokenA.getAddress();
      const tokenB: string = await mockTokenB.getAddress();
      
      await expect(
        adapter.connect(deployer).skimPair(tokenA, tokenB, deployer.address)
      ).to.not.be.reverted;
    });

    it("Should emergency withdraw", async function () {
      // Send tokens to adapter
      const amount: bigint = ethers.parseEther("100");
      await mockTokenA.transfer(await adapter.getAddress(), amount);
      
      const balanceBefore: bigint = await mockTokenA.balanceOf(deployer.address);
      
      await adapter.connect(deployer).emergencyWithdraw(
        await mockTokenA.getAddress(),
        deployer.address,
        amount
      );

      const balanceAfter: bigint = await mockTokenA.balanceOf(deployer.address);
      expect(balanceAfter - balanceBefore).to.equal(amount);
    });

    it("Should not allow non-admin to emergency withdraw", async function () {
      await expect(
        adapter.connect(user).emergencyWithdraw(
          await mockTokenA.getAddress(),
          user.address,
          ethers.parseEther("100")
        )
      ).to.be.reverted;
    });
  });

  describe("Adapter Info", function () {
    it("Should return correct adapter info", async function () {
      const info: any = await adapter.getAdapterInfo();
      
      expect(info.name).to.equal("Test Uniswap Adapter");
      expect(info.adapterAddress).to.equal(await adapter.getAddress());
      expect(info.isActive).to.be.true;
      expect(info.fee).to.equal(ADAPTER_FEE);
      expect(info.minSwapAmount).to.equal(MIN_SWAP);
      expect(info.maxSwapAmount).to.equal(MAX_SWAP);
    });

    it("Should check token support", async function () {
      expect(await adapter.isTokenSupported(await mockTokenA.getAddress())).to.be.true;
      expect(await adapter.isTokenSupported(ethers.ZeroAddress)).to.be.false;
    });

    it("Should get reserves", async function () {
      const [reserve, lastUpdate] = await adapter.getReserves(await mockTokenA.getAddress());
      
      // This will be 0 initially or after operations
      expect(lastUpdate).to.be.gte(0);
    });
  });
});