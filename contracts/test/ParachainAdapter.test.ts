import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ParachainAdapter", function () {
  let adapter: any;
  let crossChainExecutor: any;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let mockToken: any;

  const ADAPTER_FEE = 25;
  const MIN_SWAP = ethers.parseEther("0.01");
  const MAX_SWAP = ethers.parseEther("1000");

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20Factory.deploy("Test Token", "TEST", 18);

    const CrossChainExecutorFactory = await ethers.getContractFactory("CrossChainExecutor");
    crossChainExecutor = await CrossChainExecutorFactory.deploy();

    const ParachainAdapterFactory = await ethers.getContractFactory("ParachainAdapter");
    adapter = await ParachainAdapterFactory.deploy(
      "Test Parachain Adapter",
      await crossChainExecutor.getAddress(),
      ADAPTER_FEE,
      MIN_SWAP,
      MAX_SWAP
    );

    await mockToken.mint(user.address, ethers.parseEther("10000"));
  });

  describe("Basic functionality", function () {
    it("Should have correct name", async function () {
      const info = await adapter.getAdapterInfo();
      expect(info.name).to.equal("Test Parachain Adapter");
    });
  });
});