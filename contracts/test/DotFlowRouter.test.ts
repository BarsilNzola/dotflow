import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Time } from "@nomicfoundation/hardhat-network-helpers";

describe("DotFlowRouter", function () {
  let router: Contract;
  let liquidityManager: Contract;
  let crossChainExecutor: Contract;
  let uniswapAdapter: Contract;
  let parachainAdapter: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let mockToken: Contract;
  let mockWETH: Contract;
  let mockUSDC: Contract;

  const PROTOCOL_FEE: number = 30; // 0.3%
  const MIN_SWAP: bigint = ethers.parseEther("0.01");
  const MAX_SWAP: bigint = ethers.parseEther("1000");
  const ADAPTER_FEE: number = 25; // 0.25%
  const UNISWAP_ROUTER: string = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

  interface SwapPath {
    adapters: string[];
    path: string[];
    isCrossChain: boolean;
    destinationChains: number[];
  }

  beforeEach(async function () {
    [deployer, user, feeCollector, liquidityProvider] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20: ContractFactory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock Token", "MCK", 18);
    mockWETH = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
    mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);

    // Deploy CrossChainExecutor
    const CrossChainExecutor: ContractFactory = await ethers.getContractFactory("CrossChainExecutor");
    crossChainExecutor = await CrossChainExecutor.deploy();

    // Deploy LiquidityManager
    const LiquidityManager: ContractFactory = await ethers.getContractFactory("LiquidityManager");
    liquidityManager = await LiquidityManager.deploy();

    // Deploy Router
    const DotFlowRouter: ContractFactory = await ethers.getContractFactory("DotFlowRouter");
    router = await DotFlowRouter.deploy(feeCollector.address, PROTOCOL_FEE);

    // Deploy adapters
    const UniswapV2Adapter: ContractFactory = await ethers.getContractFactory("UniswapV2Adapter");
    uniswapAdapter = await UniswapV2Adapter.deploy(
      "Uniswap V2 Adapter",
      UNISWAP_ROUTER,
      ADAPTER_FEE,
      MIN_SWAP,
      MAX_SWAP,
      feeCollector.address
    );

    const ParachainAdapter: ContractFactory = await ethers.getContractFactory("ParachainAdapter");
    parachainAdapter = await ParachainAdapter.deploy(
      "Parachain Adapter",
      await crossChainExecutor.getAddress(),
      ADAPTER_FEE,
      MIN_SWAP,
      MAX_SWAP
    );

    // Configure router
    await router.setXCMExecutor(await crossChainExecutor.getAddress());

    // Add adapters to router
    await router.addAdapter(await uniswapAdapter.getAddress(), "Uniswap V2");
    await router.addAdapter(await parachainAdapter.getAddress(), "Parachain");

    // Grant roles
    const executorRole: string = await crossChainExecutor.EXECUTOR_ROLE();
    await crossChainExecutor.grantRole(executorRole, await router.getAddress());

    // Mint tokens for testing
    await mockToken.mint(user.address, ethers.parseEther("10000"));
    await mockWETH.mint(user.address, ethers.parseEther("1000"));
    await mockUSDC.mint(user.address, ethers.parseUnits("1000000", 6));
  });

  describe("Deployment", function () {
    it("Should set the correct fee collector", async function () {
      expect(await router.feeCollector()).to.equal(feeCollector.address);
    });

    it("Should set the correct protocol fee", async function () {
      expect(await router.protocolFee()).to.equal(PROTOCOL_FEE);
    });

    it("Should have DEFAULT_ADMIN_ROLE", async function () {
      const DEFAULT_ADMIN_ROLE: string = await router.DEFAULT_ADMIN_ROLE();
      expect(await router.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
    });

    it("Should have ROUTER_ADMIN role", async function () {
      const ROUTER_ADMIN: string = await router.ROUTER_ADMIN();
      expect(await router.hasRole(ROUTER_ADMIN, deployer.address)).to.be.true;
    });
  });

  describe("Adapter Management", function () {
    it("Should add adapter successfully", async function () {
      const adapterAddress: string = await uniswapAdapter.getAddress();
      const isActive: string[] = await router.getActiveAdapters();
      expect(isActive).to.include(adapterAddress);
    });

    it("Should get adapter info", async function () {
      const adapterAddress: string = await uniswapAdapter.getAddress();
      const info: any = await router.getAdapterInfo(adapterAddress);
      expect(info.name).to.equal("Uniswap V2 Adapter");
      expect(info.isActive).to.be.true;
    });

    it("Should remove adapter", async function () {
      const adapterAddress: string = await uniswapAdapter.getAddress();
      await router.removeAdapter(adapterAddress);
      
      const activeAdapters: string[] = await router.getActiveAdapters();
      expect(activeAdapters).to.not.include(adapterAddress);
    });

    it("Should not allow non-admin to add adapter", async function () {
      const adapterAddress: string = await uniswapAdapter.getAddress();
      await expect(
        router.connect(user).addAdapter(adapterAddress, "Test")
      ).to.be.reverted;
    });
  });

  describe("Swaps", function () {
    let tokenIn: string;
    let tokenOut: string;
    let path: SwapPath;

    beforeEach(async function () {
      tokenIn = await mockToken.getAddress();
      tokenOut = await mockWETH.getAddress();

      // Initialize Uniswap pair
      await uniswapAdapter.initializePair(tokenIn, tokenOut);

      // Approve router to spend tokens
      await mockToken.connect(user).approve(
        await router.getAddress(),
        ethers.parseEther("1000")
      );

      path = {
        adapters: [await uniswapAdapter.getAddress()],
        path: [tokenIn, tokenOut],
        isCrossChain: false,
        destinationChains: []
      };
    });

    it("Should execute swap successfully", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      const amountOutMin: bigint = 0n;
      const deadline: number = Math.floor(Date.now() / 1000) + 3600;

      const userBalanceBefore: bigint = await mockWETH.balanceOf(user.address);

      await router.connect(user).swap(
        tokenIn,
        tokenOut,
        amountIn,
        amountOutMin,
        user.address,
        path,
        deadline
      );

      const userBalanceAfter: bigint = await mockWETH.balanceOf(user.address);
      expect(userBalanceAfter).to.be.gt(userBalanceBefore);
    });

    it("Should revert with expired deadline", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      const deadline: number = Math.floor(Date.now() / 1000) - 3600;

      await expect(
        router.connect(user).swap(
          tokenIn,
          tokenOut,
          amountIn,
          0n,
          user.address,
          path,
          deadline
        )
      ).to.be.revertedWithCustomError(router, "ExpiredDeadline");
    });

    it("Should revert with insufficient output", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      const amountOutMin: bigint = ethers.parseEther("1000"); // Unrealistic
      const deadline: number = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        router.connect(user).swap(
          tokenIn,
          tokenOut,
          amountIn,
          amountOutMin,
          user.address,
          path,
          deadline
        )
      ).to.be.revertedWithCustomError(router, "InsufficientOutput");
    });

    it("Should collect protocol fee", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      const deadline: number = Math.floor(Date.now() / 1000) + 3600;

      const feeCollectorBalanceBefore: bigint = await mockWETH.balanceOf(feeCollector.address);

      await router.connect(user).swap(
        tokenIn,
        tokenOut,
        amountIn,
        0n,
        user.address,
        path,
        deadline
      );

      const feeCollectorBalanceAfter: bigint = await mockWETH.balanceOf(feeCollector.address);
      expect(feeCollectorBalanceAfter).to.be.gt(feeCollectorBalanceBefore);
    });
  });

  describe("Cross-Chain Swaps", function () {
    let tokenIn: string;
    let tokenOut: string;
    let parachainId: number = 3000;

    beforeEach(async function () {
      tokenIn = await mockToken.getAddress();
      tokenOut = await mockToken.getAddress(); // Same token for test
      
      // Configure parachain
      await parachainAdapter.configureParachain(
        parachainId,
        "Polkadot Hub",
        10, // 0.1% bridge fee
        ethers.parseEther("1"),
        ethers.parseEther("10000"),
        3600
      );

      // Map token
      const assetId: string = ethers.zeroPadBytes(tokenIn, 32);
      
      await parachainAdapter.mapToken(
        tokenIn,
        parachainId,
        assetId,
        18,
        ethers.parseEther("0.1"),
        ethers.parseEther("5000"),
        false
      );

      // Approve router
      await mockToken.connect(user).approve(
        await router.getAddress(),
        ethers.parseEther("1000")
      );
    });

    it("Should initiate cross-chain swap", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      const xcmTimeout: number = 3600;
      const xcmCallData: string = "0x";
      const deadline: number = Math.floor(Date.now() / 1000) + 3600;

      const path: SwapPath = {
        adapters: [await parachainAdapter.getAddress()],
        path: [tokenIn, tokenOut],
        isCrossChain: true,
        destinationChains: [parachainId]
      };

      // Calculate XCM fee
      const xcmFee: bigint = await crossChainExecutor.calculateFee(
        parachainId,
        1000000000n, // weight
        amountIn
      );

      const tx = await router.connect(user).crossChainSwap(
        tokenIn,
        tokenOut,
        amountIn,
        0n,
        user.address,
        path,
        parachainId,
        xcmCallData,
        xcmTimeout,
        deadline,
        { value: xcmFee }
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (e: any) => e.fragment && e.fragment.name === "CrossChainSwapInitiated"
      );

      expect(event).to.not.be.undefined;
    });

    it("Should revert with insufficient XCM fee", async function () {
      const amountIn: bigint = ethers.parseEther("100");
      const deadline: number = Math.floor(Date.now() / 1000) + 3600;

      const path: SwapPath = {
        adapters: [await parachainAdapter.getAddress()],
        path: [tokenIn, tokenOut],
        isCrossChain: true,
        destinationChains: [parachainId]
      };

      await expect(
        router.connect(user).crossChainSwap(
          tokenIn,
          tokenOut,
          amountIn,
          0n,
          user.address,
          path,
          parachainId,
          "0x",
          3600,
          deadline,
          { value: 1n } // Insufficient fee
        )
      ).to.be.revertedWith("Insufficient XCM fee");
    });
  });

  describe("Quote Functionality", function () {
    let tokenIn: string;
    let tokenOut: string;
    let path: SwapPath;

    beforeEach(async function () {
      tokenIn = await mockToken.getAddress();
      tokenOut = await mockWETH.getAddress();

      await uniswapAdapter.initializePair(tokenIn, tokenOut);

      path = {
        adapters: [await uniswapAdapter.getAddress()],
        path: [tokenIn, tokenOut],
        isCrossChain: false,
        destinationChains: []
      };
    });

    it("Should get accurate quote", async function () {
      const amountIn: bigint = ethers.parseEther("100");

      const [amountOut, totalFee, priceImpact]: [bigint, bigint, number] = await router.getAmountOut(
        tokenIn,
        tokenOut,
        amountIn,
        path
      );

      expect(amountOut).to.be.gt(0);
      expect(totalFee).to.be.gt(0);
      expect(priceImpact).to.be.lte(10000); // Max 100%
    });

    it("Should revert with unsupported pair", async function () {
      const tokenIn: string = await mockToken.getAddress();
      const tokenOut: string = await mockUSDC.getAddress();
      const amountIn: bigint = ethers.parseEther("100");

      const path: SwapPath = {
        adapters: [await uniswapAdapter.getAddress()],
        path: [tokenIn, tokenOut],
        isCrossChain: false,
        destinationChains: []
      };

      await expect(
        router.getAmountOut(tokenIn, tokenOut, amountIn, path)
      ).to.be.revertedWithCustomError(router, "AdapterNotApproved");
    });
  });

  describe("Admin Functions", function () {
    it("Should update protocol fee", async function () {
      const newFee: number = 50; // 0.5%
      await router.setProtocolFee(newFee);
      expect(await router.protocolFee()).to.equal(newFee);
    });

    it("Should not exceed max protocol fee", async function () {
      const maxFee: number = await router.MAX_PROTOCOL_FEE();
      await expect(
        router.setProtocolFee(maxFee + 1)
      ).to.be.revertedWith("Fee too high");
    });

    it("Should update fee collector", async function () {
      const newCollector: string = user.address;
      await router.setFeeCollector(newCollector);
      expect(await router.feeCollector()).to.equal(newCollector);
    });

    it("Should pause and unpause", async function () {
      await router.pause();
      expect(await router.paused()).to.be.true;

      await router.unpause();
      expect(await router.paused()).to.be.false;
    });

    it("Should not allow swaps when paused", async function () {
      await router.pause();

      const tokenIn: string = await mockToken.getAddress();
      const tokenOut: string = await mockWETH.getAddress();
      
      const path: SwapPath = {
        adapters: [await uniswapAdapter.getAddress()],
        path: [tokenIn, tokenOut],
        isCrossChain: false,
        destinationChains: []
      };

      await expect(
        router.connect(user).swap(
          tokenIn,
          tokenOut,
          ethers.parseEther("100"),
          0n,
          user.address,
          path,
          Math.floor(Date.now() / 1000) + 3600
        )
      ).to.be.revertedWith("Pausable: paused");
    });
  });
});