import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Always use chain time, not wall-clock time, to avoid ExpiredDeadline
async function deadline(offsetSecs = 1800): Promise<bigint> {
  const latest = await ethers.provider.getBlock("latest");
  return BigInt(latest!.timestamp + offsetSecs);
}

const XCM_PRECOMPILE = "0x00000000000000000000000000000000000a0000";

const WESTEND_CHAIN_ID  = 420;
const PROTOCOL_FEE      = 30;
const ADAPTER_FEE       = 25;
const MIN_SWAP          = ethers.parseEther("0.01");
const MAX_SWAP          = ethers.parseEther("1000");
const BASE_FEE          = ethers.parseEther("0.01");
const WEIGHT_FEE        = ethers.parseEther("0.0001");
const MIN_FEE           = ethers.parseEther("0.005");
const XCM_REF_TIME      = 400_000_000n;
const XCM_PROOF_SIZE    = 8_192n;

// ─── Minimal mock factory/pair/router for same-chain swaps ───────────────────

async function deployMockXcm() {
  const factory = await ethers.getContractFactory("MockXcmPrecompile");
  const mock    = await factory.deploy();
  const code    = await ethers.provider.getCode(await mock.getAddress());
  await ethers.provider.send("hardhat_setCode", [XCM_PRECOMPILE, code]);
  return ethers.getContractAt("MockXcmPrecompile", XCM_PRECOMPILE);
}

describe("DotFlowRouter", function () {
  let router:            any;
  let executor:          any;
  let uniswapAdapter:    any;
  let parachainAdapter:  any;
  let xcmMock:           any;
  let deployer:          SignerWithAddress;
  let user:              SignerWithAddress;
  let feeCollector:      SignerWithAddress;
  let recipient:         SignerWithAddress;
  let tokenA:            any;   // "USDC"  — 6 decimals
  let tokenB:            any;   // "WDOT"  — 10 decimals
  let mockFactory:       any;
  let mockRouter:        any;
  let mockWETH:          any;
  let assetId:           string;

  beforeEach(async function () {
    [deployer, user, feeCollector, recipient] = await ethers.getSigners();

    // ── XCM precompile mock ──────────────────────────────────────────────────
    xcmMock = await deployMockXcm();

    // ── Tokens ───────────────────────────────────────────────────────────────
    const ERC20 = await ethers.getContractFactory("MockERC20");
    tokenA   = await ERC20.deploy("Mock USDC", "USDC", 6);
    tokenB   = await ERC20.deploy("Mock WDOT", "WDOT", 10);
    mockWETH = await ERC20.deploy("Wrapped ETH", "WETH", 18);

    await tokenA.mint(user.address, ethers.parseUnits("10000", 6));
    await tokenB.mint(user.address, ethers.parseUnits("10000", 10));

    // ── Uniswap V2 mocks ─────────────────────────────────────────────────────
    mockFactory = await (await ethers.getContractFactory("MockUniswapV2Factory")).deploy();
    mockRouter  = await (await ethers.getContractFactory("MockUniswapV2Router")).deploy(
      await mockFactory.getAddress(),
      await mockWETH.getAddress()
    );

    // ── CrossChainExecutor ───────────────────────────────────────────────────
    executor = await (await ethers.getContractFactory("CrossChainExecutor")).deploy();

    // Configure chain in executor
    await executor.configureChain(
      WESTEND_CHAIN_ID, "Westend",
      BASE_FEE, WEIGHT_FEE, MIN_FEE, 10_000_000_000n,
      XCM_REF_TIME, XCM_PROOF_SIZE
    );

    // Map tokenB as the cross-chain asset
    assetId = ethers.zeroPadValue(ethers.toBeHex(await tokenB.getAddress()), 32);
    await executor.mapAsset(WESTEND_CHAIN_ID, assetId, await tokenB.getAddress(), 10, false);

    // ── UniswapV2Adapter ─────────────────────────────────────────────────────
    uniswapAdapter = await (await ethers.getContractFactory("UniswapV2Adapter")).deploy(
      "Test Uniswap Adapter",
      await mockRouter.getAddress(),   // router (unused but required)
      await mockFactory.getAddress(),  // factory ← 3rd arg
      ADAPTER_FEE,
      MIN_SWAP,
      MAX_SWAP,
      feeCollector.address             // feeCollector ← 7th arg
    );
    // Grant roles on uniswapAdapter
    const LIQUIDITY_PROVIDER = await uniswapAdapter.LIQUIDITY_PROVIDER();
    await uniswapAdapter.grantRole(LIQUIDITY_PROVIDER, deployer.address);

    // Pre-create pair, seed initial reserves, then register in adapter
    await mockFactory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
    const pairAddr0 = await mockFactory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    await tokenA.mint(pairAddr0, ethers.parseUnits("1000", 6));
    await tokenB.mint(pairAddr0, ethers.parseUnits("1000", 10));
    await (await ethers.getContractAt("MockUniswapV2Pair", pairAddr0)).sync();
    await uniswapAdapter.initializePair(await tokenA.getAddress(), await tokenB.getAddress());

    // Seed liquidity so swaps actually work
    await tokenA.mint(deployer.address, ethers.parseUnits("10000", 6));
    await tokenB.mint(deployer.address, ethers.parseUnits("10000", 10));
    await tokenA.connect(deployer).approve(await uniswapAdapter.getAddress(), ethers.parseUnits("10000", 6));
    await tokenB.connect(deployer).approve(await uniswapAdapter.getAddress(), ethers.parseUnits("10000", 10));
    await uniswapAdapter.connect(deployer).addLiquidity(
      await tokenA.getAddress(), await tokenB.getAddress(),
      ethers.parseUnits("5000", 6), ethers.parseUnits("5000", 10),
      0n, 0n, deployer.address
    );
    const pairAddr = await mockFactory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    await (await ethers.getContractAt("MockUniswapV2Pair", pairAddr)).sync();

    // ── ParachainAdapter ──────────────────────────────────────────────────────
    parachainAdapter = await (await ethers.getContractFactory("ParachainAdapter")).deploy(
      "Parachain Adapter",
      await executor.getAddress(),
      ADAPTER_FEE,
      1n,          // MIN_SWAP = 1 wei — let any amount through
      ethers.parseEther("100000")  // MAX_SWAP generous
    );

    // Configure parachain and map tokenB so swapExactTokensForTokens succeeds
    await parachainAdapter.configureParachain(
      WESTEND_CHAIN_ID, "Westend",
      0,                               // bridgeFee = 0
      1n,                              // minTransfer = 1
      ethers.parseEther("100000"),     // maxTransfer
      3600n                            // timeout
    );
    const parachainAssetId = ethers.zeroPadValue(ethers.toBeHex(await tokenB.getAddress()), 32);
    await parachainAdapter.mapToken(
      await tokenB.getAddress(),
      WESTEND_CHAIN_ID,
      parachainAssetId,
      10,                              // decimals
      1n,                              // minTransfer
      ethers.parseEther("100000"),     // maxTransfer
      false                            // isNative
    );

    // Grant executor RELAYER role so it can pull tokenB from parachainAdapter
    const RELAYER_ROLE = await executor.RELAYER_ROLE();
    await executor.grantRole(RELAYER_ROLE, deployer.address);

    // ── Router ────────────────────────────────────────────────────────────────
    router = await (await ethers.getContractFactory("DotFlowRouter")).deploy(
      feeCollector.address, PROTOCOL_FEE
    );
    await router.setXCMExecutor(await executor.getAddress());
    await router.addAdapter(await uniswapAdapter.getAddress());
    await router.addAdapter(await parachainAdapter.getAddress());

    // Approvals for user
    await tokenA.connect(user).approve(await router.getAddress(), ethers.parseUnits("10000", 6));
    await tokenB.connect(user).approve(await router.getAddress(), ethers.parseUnits("10000", 10));
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("sets feeCollector and protocolFee", async function () {
      expect(await router.feeCollector()).to.equal(feeCollector.address);
      expect(await router.protocolFee()).to.equal(PROTOCOL_FEE);
    });

    it("registers adapters", async function () {
      const adapters = await router.getActiveAdapters();
      expect(adapters).to.include(await uniswapAdapter.getAddress());
      expect(adapters).to.include(await parachainAdapter.getAddress());
    });

    it("sets XCM executor", async function () {
      // setXCMExecutor emits XCMExecutorUpdated
      const filter = router.filters.XCMExecutorUpdated();
      const events = await router.queryFilter(filter);
      expect(events.length).to.be.gte(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("Same-chain swap", function () {
    function makePath() {
      return {
        adapters: [uniswapAdapter.target],
        path:     [tokenA.target, tokenB.target],
        isCrossChain: false,
        destinationChains: [],
      };
    }

    it("executes swap and emits SwapExecuted", async function () {
      const amountIn = ethers.parseUnits("100", 6);
      const dl = await deadline();

      const tx = await router.connect(user).swap(
        tokenA.target, tokenB.target,
        amountIn, 0n, user.address,
        makePath(), dl
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find((l: any) => l.fragment?.name === "SwapExecuted");
      expect(event).to.not.be.undefined;
    });

    it("transfers tokenB to recipient after swap", async function () {
      const amountIn = ethers.parseUnits("100", 6);
      const dl = await deadline();
      const before   = await tokenB.balanceOf(user.address);

      await router.connect(user).swap(
        tokenA.target, tokenB.target,
        amountIn, 0n, user.address,
        makePath(), dl
      );

      expect(await tokenB.balanceOf(user.address)).to.be.gt(before);
    });

    it("reverts past deadline", async function () {
      const dl = await deadline(-10); // already expired
      await expect(
        router.connect(user).swap(
          tokenA.target, tokenB.target,
          ethers.parseUnits("100", 6), 0n, user.address,
          makePath(), dl
        )
      ).to.be.revertedWithCustomError(router, "ExpiredDeadline");
    });

    it("reverts on insufficient output", async function () {
      const dl = await deadline();
      await expect(
        router.connect(user).swap(
          tokenA.target, tokenB.target,
          ethers.parseUnits("100", 6),
          ethers.parseUnits("999999", 10), // impossibly high min
          user.address, makePath(), dl
        )
      ).to.be.revertedWithCustomError(router, "InsufficientOutput");
    });

    it("reverts with zero amount", async function () {
      const dl = await deadline();
      await expect(
        router.connect(user).swap(
          tokenA.target, tokenB.target,
          0n, 0n, user.address,
          makePath(), dl
        )
      ).to.be.revertedWithCustomError(router, "ZeroAmount");
    });

    it("reverts when isCrossChain=true is passed to swap()", async function () {
      const dl = await deadline();
      await expect(
        router.connect(user).swap(
          tokenA.target, tokenB.target,
          ethers.parseUnits("100", 6), 0n, user.address,
          {
            adapters: [uniswapAdapter.target],
            path: [tokenA.target, tokenB.target],
            isCrossChain: true,
            destinationChains: [WESTEND_CHAIN_ID],
          },
          dl
        )
      ).to.be.reverted; // router rejects isCrossChain=true on swap()
    });

    it("collects protocol fee", async function () {
      const amountIn = ethers.parseUnits("1000", 6);
      const dl = await deadline();
      const before   = await tokenB.balanceOf(feeCollector.address);

      await router.connect(user).swap(
        tokenA.target, tokenB.target,
        amountIn, 0n, user.address,
        makePath(), dl
      );

      expect(await tokenB.balanceOf(feeCollector.address)).to.be.gt(before);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("Cross-chain swap", function () {
    async function doCrossChainSwap(overrides: Partial<{
      amountIn: bigint; amountOutMin: bigint; value: bigint
    }> = {}) {
      const amountIn     = overrides.amountIn     ?? ethers.parseUnits("100", 6);
      const amountOutMin = overrides.amountOutMin ?? 0n;
      const dl     = await deadline();
      // Router uses _calculateWeight = 1_010_000_000 + callData.length * 1_000
      // For "0x" (empty calldata, 0 bytes), weight = 1_010_000_000
      const xcmFee       = await executor.calculateFee(WESTEND_CHAIN_ID, 1_010_000_000n, amountIn);
      const value        = overrides.value ?? xcmFee * 2n;

      return router.connect(user).crossChainSwap(
        tokenA.target, tokenB.target,
        amountIn, amountOutMin,
        recipient.address,
        {
          adapters: [uniswapAdapter.target],   // only local swap adapters
          path:     [tokenA.target, tokenB.target],
          isCrossChain: true,
          destinationChains: [WESTEND_CHAIN_ID],
        },
        WESTEND_CHAIN_ID,
        "0x",
        3600n,
        dl,
        { value }
      );
    }

    it("emits CrossChainSwapInitiated", async function () {
      const tx      = await doCrossChainSwap();
      const receipt = await tx.wait();
      const event   = receipt?.logs.find((l: any) => l.fragment?.name === "CrossChainSwapInitiated");
      expect(event).to.not.be.undefined;
      expect(event?.args?.[2]).to.equal(WESTEND_CHAIN_ID);
    });

    it("returns swapId and xcmMessageId", async function () {
      const tx      = await doCrossChainSwap();
      const receipt = await tx.wait();
      const event   = receipt?.logs.find((l: any) => l.fragment?.name === "CrossChainSwapInitiated");
      const swapId  = event?.args?.[0];
      const xcmId   = event?.args?.[1];
      expect(swapId).to.not.equal(ethers.ZeroHash);
      expect(xcmId).to.not.equal(ethers.ZeroHash);
    });

    it("reverts with insufficient XCM fee", async function () {
      const dl = await deadline();
      await expect(
        router.connect(user).crossChainSwap(
          tokenA.target, tokenB.target,
          ethers.parseUnits("100", 6), 0n,
          recipient.address,
          {
            adapters: [uniswapAdapter.target],
            path:     [tokenA.target, tokenB.target],
            isCrossChain: true,
            destinationChains: [WESTEND_CHAIN_ID],
          },
          WESTEND_CHAIN_ID, "0x", 3600n, dl,
          { value: 1n }
        )
      ).to.be.reverted; // Insufficient XCM fee
    });

    it("reverts when XCM executor not set", async function () {
      const bareRouter = await (await ethers.getContractFactory("DotFlowRouter")).deploy(
        feeCollector.address, PROTOCOL_FEE
      );
      await bareRouter.addAdapter(await uniswapAdapter.getAddress());
      const dl = await deadline();

      await tokenA.connect(user).approve(await bareRouter.getAddress(), ethers.parseUnits("100", 6));
      await expect(
        bareRouter.connect(user).crossChainSwap(
          tokenA.target, tokenB.target,
          ethers.parseUnits("100", 6), 0n,
          recipient.address,
          {
            adapters: [uniswapAdapter.target],
            path:     [tokenA.target, tokenB.target],
            isCrossChain: true,
            destinationChains: [WESTEND_CHAIN_ID],
          },
          WESTEND_CHAIN_ID, "0x", 3600n, dl,
          { value: ethers.parseEther("1") }
        )
      ).to.be.reverted; // XCM executor not set
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("Admin", function () {
    it("updates protocol fee", async function () {
      await router.setProtocolFee(50);
      expect(await router.protocolFee()).to.equal(50);
    });

    it("reverts fee above max", async function () {
      await expect(router.setProtocolFee(9999)).to.be.reverted; // Fee too high
    });

    it("updates fee collector", async function () {
      await router.setFeeCollector(user.address);
      expect(await router.feeCollector()).to.equal(user.address);
    });

    it("removes adapter", async function () {
      await router.removeAdapter(await uniswapAdapter.getAddress());
      const adapters = await router.getActiveAdapters();
      expect(adapters).to.not.include(await uniswapAdapter.getAddress());
    });

    it("emergency withdraw", async function () {
      await tokenA.mint(await router.getAddress(), ethers.parseUnits("100", 6));
      const EMERGENCY_ROLE = await router.EMERGENCY_ROLE();
      await router.grantRole(EMERGENCY_ROLE, deployer.address);

      const before = await tokenA.balanceOf(deployer.address);
      await router.emergencyWithdraw(tokenA.target, deployer.address, ethers.parseUnits("100", 6));
      expect(await tokenA.balanceOf(deployer.address)).to.equal(before + ethers.parseUnits("100", 6));
    });

    it("pause and unpause", async function () {
      const EMERGENCY_ROLE = await router.EMERGENCY_ROLE();
      await router.grantRole(EMERGENCY_ROLE, deployer.address);

      await router.pause();
      const dl = await deadline();
      await expect(
        router.connect(user).swap(
          tokenA.target, tokenB.target,
          ethers.parseUnits("100", 6), 0n, user.address,
          {
            adapters: [uniswapAdapter.target],
            path: [tokenA.target, tokenB.target],
            isCrossChain: false,
            destinationChains: [],
          },
          dl
        )
      ).to.be.reverted; // EnforcedPause

      await router.unpause();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("getAmountOut", function () {
    it("returns non-zero quote", async function () {
      const [amountOut, totalFee, priceImpact] = await router.getAmountOut(
        tokenA.target, tokenB.target,
        ethers.parseUnits("100", 6),
        {
          adapters: [uniswapAdapter.target],
          path: [tokenA.target, tokenB.target],
          isCrossChain: false,
          destinationChains: [],
        }
      );
      expect(amountOut).to.be.gt(0n);
      expect(totalFee).to.be.gte(0n);
      expect(priceImpact).to.be.lte(10000n);
    });
  });
});