import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("UniswapV2Adapter", function () {
  let adapter: any;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let mockTokenA: any;
  let mockTokenB: any;
  let mockWETH: any;
  let mockRouter: any;
  let mockFactory: any;

  const ADAPTER_FEE = 25;
  const MIN_SWAP = ethers.parseEther("0.01");
  const MAX_SWAP = ethers.parseEther("1000");

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
    feeCollector = signers[2];

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockTokenA = await MockERC20Factory.deploy("Token A", "TKA", 18);
    mockTokenB = await MockERC20Factory.deploy("Token B", "TKB", 18);
    mockWETH = await MockERC20Factory.deploy("Wrapped Ether", "WETH", 18);

    const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    mockFactory = await MockUniswapV2Factory.deploy();

    const MockUniswapV2Router = await ethers.getContractFactory("MockUniswapV2Router");
    mockRouter = await MockUniswapV2Router.deploy(
      await mockFactory.getAddress(),
      await mockWETH.getAddress()
    );

    const UniswapV2AdapterFactory = await ethers.getContractFactory("UniswapV2Adapter");
    adapter = await UniswapV2AdapterFactory.deploy(
      "Test Uniswap Adapter",
      await mockRouter.getAddress(),
      ADAPTER_FEE,
      MIN_SWAP,
      MAX_SWAP,
      feeCollector.address
    );

    const ADAPTER_ADMIN = await adapter.ADAPTER_ADMIN();
    await adapter.grantRole(ADAPTER_ADMIN, deployer.address);
    
    const LIQUIDITY_PROVIDER = await adapter.LIQUIDITY_PROVIDER();
    await adapter.grantRole(LIQUIDITY_PROVIDER, deployer.address);
    await adapter.grantRole(LIQUIDITY_PROVIDER, user.address);
    
    const FEE_MANAGER = await adapter.FEE_MANAGER();
    await adapter.grantRole(FEE_MANAGER, feeCollector.address);

    await adapter.initializePair(await mockTokenA.getAddress(), await mockTokenB.getAddress());

    await mockTokenA.mint(deployer.address, ethers.parseEther("10000"));
    await mockTokenB.mint(deployer.address, ethers.parseEther("10000"));
    await mockTokenA.mint(user.address, ethers.parseEther("10000"));
    await mockTokenB.mint(user.address, ethers.parseEther("10000"));
  });

  describe("Swaps", function () {
    beforeEach(async function () {
      await mockTokenA.connect(deployer).approve(await adapter.getAddress(), ethers.parseEther("10000"));
      await mockTokenB.connect(deployer).approve(await adapter.getAddress(), ethers.parseEther("10000"));
      await mockTokenA.connect(deployer).approve(await mockRouter.getAddress(), ethers.parseEther("10000"));
      await mockTokenB.connect(deployer).approve(await mockRouter.getAddress(), ethers.parseEther("10000"));
      
      await adapter.connect(deployer).addLiquidity(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress(),
        ethers.parseEther("5000"),
        ethers.parseEther("5000"),
        0n,
        0n,
        deployer.address
      );

      const pairAddress = await mockFactory.getPair(await mockTokenA.getAddress(), await mockTokenB.getAddress());
      const pair = await ethers.getContractAt("MockUniswapV2Pair", pairAddress);
      await pair.sync();

      await mockTokenA.connect(user).approve(await adapter.getAddress(), ethers.parseEther("1000"));
      await mockTokenB.connect(user).approve(await adapter.getAddress(), ethers.parseEther("1000"));
      await mockTokenA.connect(user).approve(await mockRouter.getAddress(), ethers.parseEther("1000"));
      await mockTokenB.connect(user).approve(await mockRouter.getAddress(), ethers.parseEther("1000"));
    });

    it("Should execute swap successfully", async function () {
      const amountIn = ethers.parseEther("100");
      
      const tx = await adapter.connect(user).swapExactTokensForTokens(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress(),
        amountIn,
        0n,
        user.address,
        "0x"
      );
      
      const receipt = await tx.wait();
      
      const event = receipt?.logs.find((log: any) => log.fragment?.name === "SwapExecuted");
      expect(event).to.not.be.undefined;
      
      const balanceAfter = await mockTokenB.balanceOf(user.address);
      expect(balanceAfter).to.be.gt(0);
    });

    it("Should respect min amount out", async function () {
      const amountIn = ethers.parseEther("100");
      const amountOutMin = ethers.parseEther("1000000");

      await expect(
        adapter.connect(user).swapExactTokensForTokens(
          await mockTokenA.getAddress(),
          await mockTokenB.getAddress(),
          amountIn,
          amountOutMin,
          user.address,
          "0x"
        )
      ).to.be.reverted;
    });
  });

  describe("Quotes", function () {
    beforeEach(async function () {
      await mockTokenA.connect(deployer).approve(await adapter.getAddress(), ethers.parseEther("10000"));
      await mockTokenB.connect(deployer).approve(await adapter.getAddress(), ethers.parseEther("10000"));
      await mockTokenA.connect(deployer).approve(await mockRouter.getAddress(), ethers.parseEther("10000"));
      await mockTokenB.connect(deployer).approve(await mockRouter.getAddress(), ethers.parseEther("10000"));
      
      await adapter.connect(deployer).addLiquidity(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress(),
        ethers.parseEther("5000"),
        ethers.parseEther("5000"),
        0n,
        0n,
        deployer.address
      );

      const pairAddress = await mockFactory.getPair(await mockTokenA.getAddress(), await mockTokenB.getAddress());
      const pair = await ethers.getContractAt("MockUniswapV2Pair", pairAddress);
      await pair.sync();
    });

    it("Should get amount out", async function () {
      const amountIn = ethers.parseEther("100");
      
      const [amountOut, fee, priceImpact] = await adapter.getAmountOut(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress(),
        amountIn
      );

      expect(amountOut).to.be.gt(0);
      expect(fee).to.equal(ADAPTER_FEE);
      expect(priceImpact).to.be.lte(10000);
    });
  });

  describe("Admin Functions", function () {
    it("Should update fee", async function () {
      const newFee = 50;
      await adapter.connect(feeCollector).setFee(newFee);
      expect(await adapter.fee()).to.equal(newFee);
    });

    it("Should emergency withdraw", async function () {
      const amount = ethers.parseEther("100");
      
      await mockTokenA.transfer(await adapter.getAddress(), amount);
      
      const balanceBefore = await mockTokenA.balanceOf(deployer.address);
      
      await adapter.connect(deployer).emergencyWithdraw(
        await mockTokenA.getAddress(),
        deployer.address,
        amount
      );

      const balanceAfter = await mockTokenA.balanceOf(deployer.address);
      expect(balanceAfter - balanceBefore).to.equal(amount);
    });
  });
});