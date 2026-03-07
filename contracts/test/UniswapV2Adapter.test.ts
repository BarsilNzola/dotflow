import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("UniswapV2Adapter", function () {
  let adapter:      any;
  let mockFactory:  any;
  let mockRouter:   any;
  let mockWETH:     any;
  let deployer:     SignerWithAddress;
  let user:         SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let tokenA:       any;
  let tokenB:       any;

  const ADAPTER_FEE = 25;
  const MIN_SWAP    = ethers.parseEther("0.01");
  const MAX_SWAP    = ethers.parseEther("1000");

  beforeEach(async function () {
    [deployer, user, feeCollector] = await ethers.getSigners();

    // ── Tokens ────────────────────────────────────────────────────────────────
    const ERC20 = await ethers.getContractFactory("MockERC20");
    tokenA   = await ERC20.deploy("Token A", "TKA", 18);
    tokenB   = await ERC20.deploy("Token B", "TKB", 18);
    mockWETH = await ERC20.deploy("Wrapped Ether", "WETH", 18);

    // ── Uniswap V2 mocks ──────────────────────────────────────────────────────
    mockFactory = await (await ethers.getContractFactory("MockUniswapV2Factory")).deploy();
    mockRouter  = await (await ethers.getContractFactory("MockUniswapV2Router")).deploy(
      await mockFactory.getAddress(),
      await mockWETH.getAddress()
    );

    // ── Adapter ───────────────────────────────────────────────────────────────
    adapter = await (await ethers.getContractFactory("UniswapV2Adapter")).deploy(
      "Test Uniswap Adapter",
      await mockRouter.getAddress(),   // router (unused but required)
      await mockFactory.getAddress(),  // factory ← 3rd arg
      ADAPTER_FEE,
      MIN_SWAP,
      MAX_SWAP,
      feeCollector.address             // feeCollector ← 7th arg
    );

    // ── Roles ─────────────────────────────────────────────────────────────────
    const ADAPTER_ADMIN       = await adapter.ADAPTER_ADMIN();
    const LIQUIDITY_PROVIDER  = await adapter.LIQUIDITY_PROVIDER();
    const FEE_MANAGER         = await adapter.FEE_MANAGER();
    await adapter.grantRole(ADAPTER_ADMIN,      deployer.address);
    await adapter.grantRole(LIQUIDITY_PROVIDER, deployer.address);
    await adapter.grantRole(LIQUIDITY_PROVIDER, user.address);
    await adapter.grantRole(FEE_MANAGER,        feeCollector.address);

    // ── Create pair on factory, seed reserves, then register in adapter ───────
    await mockFactory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
    const pairAddr0 = await mockFactory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    await tokenA.mint(pairAddr0, ethers.parseEther("1000"));
    await tokenB.mint(pairAddr0, ethers.parseEther("1000"));
    await (await ethers.getContractAt("MockUniswapV2Pair", pairAddr0)).sync();
    await adapter.initializePair(await tokenA.getAddress(), await tokenB.getAddress());
    await tokenA.mint(deployer.address, ethers.parseEther("10000"));
    await tokenB.mint(deployer.address, ethers.parseEther("10000"));
    await tokenA.mint(user.address,     ethers.parseEther("10000"));
    await tokenB.mint(user.address,     ethers.parseEther("10000"));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Liquidity
  // ─────────────────────────────────────────────────────────────────────────
  describe("Liquidity", function () {
    beforeEach(async function () {
      await tokenA.connect(deployer).approve(await adapter.getAddress(), ethers.parseEther("10000"));
      await tokenB.connect(deployer).approve(await adapter.getAddress(), ethers.parseEther("10000"));
    });

    it("adds liquidity and creates pair", async function () {
      await adapter.connect(deployer).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("1000"), ethers.parseEther("1000"),
        0n, 0n, deployer.address
      );
      const pairAddr = await mockFactory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(pairAddr).to.not.equal(ethers.ZeroAddress);
    });

    it("emits LiquidityProvided", async function () {
      await expect(
        adapter.connect(deployer).addLiquidity(
          await tokenA.getAddress(), await tokenB.getAddress(),
          ethers.parseEther("1000"), ethers.parseEther("1000"),
          0n, 0n, deployer.address
        )
      ).to.emit(adapter, "LiquidityProvided");
    });

    it("removes liquidity and returns tokens", async function () {
      // First add liquidity
      await adapter.connect(deployer).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("1000"), ethers.parseEther("1000"),
        0n, 0n, deployer.address
      );

      const pairAddr = await mockFactory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      const pairERC20 = await ethers.getContractAt("MockERC20", pairAddr);
      const lpBal    = await pairERC20.balanceOf(deployer.address);
      expect(lpBal).to.be.gt(0n);

      const balABefore = await tokenA.balanceOf(deployer.address);
      await pairERC20.connect(deployer).approve(await adapter.getAddress(), lpBal);
      await adapter.connect(deployer).removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        lpBal, 0n, 0n, deployer.address
      );
      // deployer should get back some tokenA
      expect(await tokenA.balanceOf(deployer.address)).to.be.gt(balABefore);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Swaps
  // ─────────────────────────────────────────────────────────────────────────
  describe("Swaps", function () {
    beforeEach(async function () {
      // Grant LIQUIDITY_PROVIDER to deployer for this describe block
      const LIQUIDITY_PROVIDER = await adapter.LIQUIDITY_PROVIDER();
      await adapter.grantRole(LIQUIDITY_PROVIDER, deployer.address);

      // Seed liquidity via adapter
      await tokenA.connect(deployer).approve(await adapter.getAddress(), ethers.parseEther("10000"));
      await tokenB.connect(deployer).approve(await adapter.getAddress(), ethers.parseEther("10000"));
      await adapter.connect(deployer).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("500"), ethers.parseEther("500"),
        0n, 0n, deployer.address
      );

      // Also mint directly to the pair and sync to guarantee non-zero reserves
      const pairAddr = await mockFactory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      await tokenA.mint(pairAddr, ethers.parseEther("500"));
      await tokenB.mint(pairAddr, ethers.parseEther("500"));
      const pair = await ethers.getContractAt("MockUniswapV2Pair", pairAddr);
      await pair.sync();

      // User approvals — use small amounts that stay within minSwap/maxSwap
      await tokenA.connect(user).approve(await adapter.getAddress(), ethers.parseEther("100"));
      await tokenB.connect(user).approve(await adapter.getAddress(), ethers.parseEther("100"));
    });

    it("executes swap and emits SwapExecuted", async function () {
      const tx      = await adapter.connect(user).swapExactTokensForTokens(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("100"), 0n, user.address, "0x"
      );
      const receipt = await tx.wait();
      const event   = receipt?.logs.find((l: any) => l.fragment?.name === "SwapExecuted");
      expect(event).to.not.be.undefined;
    });

    it("increases tokenB balance of recipient", async function () {
      const before = await tokenB.balanceOf(user.address);
      await adapter.connect(user).swapExactTokensForTokens(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("100"), 0n, user.address, "0x"
      );
      expect(await tokenB.balanceOf(user.address)).to.be.gt(before);
    });

    it("decreases tokenA balance of caller", async function () {
      const before = await tokenA.balanceOf(user.address);
      await adapter.connect(user).swapExactTokensForTokens(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("100"), 0n, user.address, "0x"
      );
      expect(await tokenA.balanceOf(user.address)).to.equal(before - ethers.parseEther("100"));
    });

    it("respects amountOutMin and reverts if not met", async function () {
      await expect(
        adapter.connect(user).swapExactTokensForTokens(
          await tokenA.getAddress(), await tokenB.getAddress(),
          ethers.parseEther("100"),
          ethers.parseEther("1000000"), // impossible min
          user.address, "0x"
        )
      ).to.be.reverted;
    });

    it("returns amountOut > 0 and fee", async function () {
      const [amountOut, fee] = await adapter.connect(user).swapExactTokensForTokens.staticCall(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("100"), 0n, user.address, "0x"
      );
      expect(amountOut).to.be.gt(0n);
      expect(fee).to.be.gte(0n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Quotes
  // ─────────────────────────────────────────────────────────────────────────
  describe("Quotes", function () {
    beforeEach(async function () {
      await tokenA.connect(deployer).approve(await adapter.getAddress(), ethers.parseEther("10000"));
      await tokenB.connect(deployer).approve(await adapter.getAddress(), ethers.parseEther("10000"));
      await adapter.connect(deployer).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("5000"), ethers.parseEther("5000"),
        0n, 0n, deployer.address
      );
      const pairAddr = await mockFactory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      await (await ethers.getContractAt("MockUniswapV2Pair", pairAddr)).sync();
    });

    it("returns positive amountOut", async function () {
      const [amountOut] = await adapter.getAmountOut(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("100")
      );
      expect(amountOut).to.be.gt(0n);
    });

    it("returns correct fee", async function () {
      const [, fee] = await adapter.getAmountOut(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("100")
      );
      expect(fee).to.equal(ADAPTER_FEE);
    });

    it("returns priceImpact <= 10000", async function () {
      const [, , priceImpact] = await adapter.getAmountOut(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("100")
      );
      expect(priceImpact).to.be.lte(10000n);
    });

    it("larger amountIn gives larger amountOut (up to pool depth)", async function () {
      const [out1] = await adapter.getAmountOut(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("10")
      );
      const [out2] = await adapter.getAmountOut(
        await tokenA.getAddress(), await tokenB.getAddress(),
        ethers.parseEther("100")
      );
      expect(out2).to.be.gt(out1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Adapter info
  // ─────────────────────────────────────────────────────────────────────────
  describe("Adapter info", function () {
    it("returns correct adapter info", async function () {
      const info = await adapter.getAdapterInfo();
      expect(info.name).to.equal("Test Uniswap Adapter");
      expect(info.fee).to.equal(ADAPTER_FEE);
      expect(info.isActive).to.be.true;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Admin
  // ─────────────────────────────────────────────────────────────────────────
  describe("Admin", function () {
    it("updates fee", async function () {
      await adapter.connect(feeCollector).setFee(50);
      expect(await adapter.fee()).to.equal(50);
    });

    it("non-FEE_MANAGER cannot update fee", async function () {
      await expect(adapter.connect(user).setFee(50)).to.be.reverted;
    });

    it("emergency withdraw", async function () {
      const amount = ethers.parseEther("100");
      await tokenA.transfer(await adapter.getAddress(), amount);

      const before = await tokenA.balanceOf(deployer.address);
      await adapter.connect(deployer).emergencyWithdraw(
        await tokenA.getAddress(), deployer.address, amount
      );
      expect(await tokenA.balanceOf(deployer.address)).to.equal(before + amount);
    });

    it("non-admin cannot emergency withdraw", async function () {
      await tokenA.transfer(await adapter.getAddress(), ethers.parseEther("100"));
      await expect(
        adapter.connect(user).emergencyWithdraw(
          await tokenA.getAddress(), user.address, ethers.parseEther("100")
        )
      ).to.be.reverted;
    });
  });
});