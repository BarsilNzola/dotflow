import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import * as fs from "fs";
import * as path from "path";

interface ParachainConfig {
  id: number;
  name: string;
  bridgeFee: number;
  minTransfer: bigint;
  maxTransfer: bigint;
  timeout: number;
  gateway: string;
}

interface DeploymentConfig {
  protocolFee: number;
  minSwapAmount: bigint;
  maxSwapAmount: bigint;
  adapterFee: number;
  xcmTimeout: number;
  minLiquidity: bigint;
  maxLiquidity: bigint;
  reserveFactor: number;
  uniswapRouter: string;
  uniswapFactory: string;
  supportedTokens: Record<string, string>;
  parachains: ParachainConfig[];
}

interface DeploymentInfo {
  network: string;
  chainId: number | undefined;
  timestamp: string;
  contracts: {
    router: string;
    liquidityManager: string;
    crossChainExecutor: string;
    uniswapAdapter: string;
    parachainAdapter: string;
  };
  config: {
    protocolFee: number;
    minSwapAmount: string;
    maxSwapAmount: string;
    supportedTokens: Record<string, string>;
    parachains: ParachainConfig[];
  };
  deployer: string;
  feeCollector: string;
  liquidityProvider: string;
}

async function main(): Promise<void> {
  console.log("\n Starting DotFlow deployment...\n");

  const [deployer, feeCollector, liquidityProvider]: SignerWithAddress[] = await ethers.getSigners();
  
  console.log(` Deployer address: ${deployer.address}`);
  console.log(` Fee collector address: ${feeCollector.address}`);
  console.log(` Liquidity provider address: ${liquidityProvider.address}\n`);

  // Configuration
  const config: DeploymentConfig = {
    protocolFee: 30, // 0.3% (30 basis points)
    minSwapAmount: ethers.parseEther("0.01"),
    maxSwapAmount: ethers.parseEther("1000"),
    adapterFee: 25, // 0.25%
    xcmTimeout: 3600, // 1 hour
    minLiquidity: ethers.parseEther("100"),
    maxLiquidity: ethers.parseEther("1000000"),
    reserveFactor: 1000, // 10%
    uniswapRouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Ethereum mainnet Uniswap V2
    uniswapFactory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Ethereum mainnet Uniswap V2
    supportedTokens: {
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    },
    parachains: [
      {
        id: 3000,
        name: "Polkadot Hub",
        bridgeFee: 10, // 0.1%
        minTransfer: ethers.parseEther("1"),
        maxTransfer: ethers.parseEther("10000"),
        timeout: 7200, // 2 hours
        gateway: "0x0000000000000000000000000000000000000800"
      },
      {
        id: 420,
        name: "Westend",
        bridgeFee: 5, // 0.05%
        minTransfer: ethers.parseEther("0.1"),
        maxTransfer: ethers.parseEther("5000"),
        timeout: 3600, // 1 hour
        gateway: "0x0000000000000000000000000000000000000801"
      }
    ]
  };

  // Deploy CrossChainExecutor
  console.log(" Deploying CrossChainExecutor...");
  const CrossChainExecutor: ContractFactory = await ethers.getContractFactory("CrossChainExecutor");
  const crossChainExecutor: Contract = await CrossChainExecutor.deploy();
  await crossChainExecutor.waitForDeployment();
  const crossChainExecutorAddress: string = await crossChainExecutor.getAddress();
  console.log(` CrossChainExecutor deployed to: ${crossChainExecutorAddress}`);

  // Deploy LiquidityManager
  console.log("\n Deploying LiquidityManager...");
  const LiquidityManager: ContractFactory = await ethers.getContractFactory("LiquidityManager");
  const liquidityManager: Contract = await LiquidityManager.deploy();
  await liquidityManager.waitForDeployment();
  const liquidityManagerAddress: string = await liquidityManager.getAddress();
  console.log(` LiquidityManager deployed to: ${liquidityManagerAddress}`);

  // Deploy DotFlowRouter
  console.log("\n Deploying DotFlowRouter...");
  const DotFlowRouter: ContractFactory = await ethers.getContractFactory("DotFlowRouter");
  const router: Contract = await DotFlowRouter.deploy(feeCollector.address, config.protocolFee);
  await router.waitForDeployment();
  const routerAddress: string = await router.getAddress();
  console.log(` DotFlowRouter deployed to: ${routerAddress}`);

  // Configure router
  console.log("\n Configuring DotFlowRouter...");
  await router.setXCMExecutor(crossChainExecutorAddress);
  console.log(" XCM Executor set");

  // Deploy UniswapV2Adapter
  console.log("\n Deploying UniswapV2Adapter...");
  const UniswapV2Adapter: ContractFactory = await ethers.getContractFactory("UniswapV2Adapter");
  const uniswapAdapter: Contract = await UniswapV2Adapter.deploy(
    "Uniswap V2 Adapter",
    config.uniswapRouter,
    config.adapterFee,
    config.minSwapAmount,
    config.maxSwapAmount,
    feeCollector.address
  );
  await uniswapAdapter.waitForDeployment();
  const uniswapAdapterAddress: string = await uniswapAdapter.getAddress();
  console.log(` UniswapV2Adapter deployed to: ${uniswapAdapterAddress}`);

  // Deploy ParachainAdapter
  console.log("\n Deploying ParachainAdapter...");
  const ParachainAdapter: ContractFactory = await ethers.getContractFactory("ParachainAdapter");
  const parachainAdapter: Contract = await ParachainAdapter.deploy(
    "Parachain Adapter",
    crossChainExecutorAddress,
    config.adapterFee,
    config.minSwapAmount,
    config.maxSwapAmount
  );
  await parachainAdapter.waitForDeployment();
  const parachainAdapterAddress: string = await parachainAdapter.getAddress();
  console.log(` ParachainAdapter deployed to: ${parachainAdapterAddress}`);

  // Configure parachains
  console.log("\n Configuring Parachains...");
  for (const parachain of config.parachains) {
    await parachainAdapter.configureParachain(
      parachain.id,
      parachain.name,
      parachain.bridgeFee,
      parachain.minTransfer,
      parachain.maxTransfer,
      parachain.timeout
    );
    console.log(` Configured parachain: ${parachain.name} (ID: ${parachain.id})`);
  }

  // Initialize Uniswap pairs
  console.log("\n Initializing Uniswap pairs...");
  const tokens: string[] = Object.values(config.supportedTokens);
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      try {
        await uniswapAdapter.initializePair(tokens[i], tokens[j]);
        console.log(` Initialized pair: ${tokens[i].slice(0, 6)}... - ${tokens[j].slice(0, 6)}...`);
      } catch (error) {
        console.log(`  Pair already exists or failed: ${tokens[i].slice(0, 6)}... - ${tokens[j].slice(0, 6)}...`);
      }
    }
  }

  // Map tokens to parachains
  console.log("\n Mapping tokens to parachains...");
  for (const parachain of config.parachains) {
    for (const [symbol, tokenAddress] of Object.entries(config.supportedTokens)) {
      const assetId: string = ethers.zeroPadBytes(ethers.toBeHex(tokenAddress), 32);
      const isNative: boolean = symbol === "WETH" && parachain.id === 3000; // Example logic
      
      await parachainAdapter.mapToken(
        tokenAddress,
        parachain.id,
        assetId,
        18, // decimals
        config.minSwapAmount,
        config.maxSwapAmount,
        isNative
      );
      console.log(` Mapped ${symbol} to ${parachain.name}`);
    }
  }

  // Add adapters to router
  console.log("\n Adding adapters to router...");
  await router.addAdapter(uniswapAdapterAddress, "Uniswap V2");
  console.log(" Added UniswapV2Adapter");
  
  await router.addAdapter(parachainAdapterAddress, "Parachain");
  console.log(" Added ParachainAdapter");

  // Grant roles
  console.log("\n Granting roles...");
  
  // Grant LIQUIDITY_PROVIDER role
  const uniswapLiquidityProviderRole: string = await uniswapAdapter.LIQUIDITY_PROVIDER();
  await uniswapAdapter.grantRole(uniswapLiquidityProviderRole, liquidityProvider.address);
  
  const parachainLiquidityProviderRole: string = await parachainAdapter.LIQUIDITY_PROVIDER();
  await parachainAdapter.grantRole(parachainLiquidityProviderRole, liquidityProvider.address);
  console.log(" Granted LIQUIDITY_PROVIDER role");

  // Grant EXECUTOR_ROLE to router in CrossChainExecutor
  const executorRole: string = await crossChainExecutor.EXECUTOR_ROLE();
  await crossChainExecutor.grantRole(executorRole, routerAddress);
  console.log(" Granted EXECUTOR_ROLE to router");

  // Grant RELAYER_ROLE to deployer
  const relayerRole: string = await crossChainExecutor.RELAYER_ROLE();
  await crossChainExecutor.grantRole(relayerRole, deployer.address);
  console.log(" Granted RELAYER_ROLE to deployer");

  // Grant FEE_MANAGER role
  const feeManagerRole: string = await uniswapAdapter.FEE_MANAGER();
  await uniswapAdapter.grantRole(feeManagerRole, feeCollector.address);
  console.log(" Granted FEE_MANAGER role");

  // Create liquidity pools in LiquidityManager
  console.log("\n🔧 Creating liquidity pools...");
  for (const [symbol, tokenAddress] of Object.entries(config.supportedTokens)) {
    await liquidityManager.createPool(
      tokenAddress,
      `${symbol} Liquidity Pool`,
      `lp${symbol}`,
      0, // initial liquidity
      config.adapterFee,
      config.reserveFactor,
      config.minLiquidity,
      config.maxLiquidity
    );
    console.log(` Created liquidity pool for ${symbol}`);
  }

  console.log("\n Deployment Summary:");
  console.log("=====================");
  console.log(`Router: ${routerAddress}`);
  console.log(`LiquidityManager: ${liquidityManagerAddress}`);
  console.log(`CrossChainExecutor: ${crossChainExecutorAddress}`);
  console.log(`UniswapAdapter: ${uniswapAdapterAddress}`);
  console.log(`ParachainAdapter: ${parachainAdapterAddress}`);
  console.log(`Fee Collector: ${feeCollector.address}`);
  console.log(`Protocol Fee: ${config.protocolFee} basis points`);
  console.log(`Min Swap: ${ethers.formatEther(config.minSwapAmount)}`);
  console.log(`Max Swap: ${ethers.formatEther(config.maxSwapAmount)}`);

  // Write deployment info to file
  const deploymentInfo: DeploymentInfo = {
    network: ethers.provider.network.name,
    chainId: ethers.provider.network?.chainId,
    timestamp: new Date().toISOString(),
    contracts: {
      router: routerAddress,
      liquidityManager: liquidityManagerAddress,
      crossChainExecutor: crossChainExecutorAddress,
      uniswapAdapter: uniswapAdapterAddress,
      parachainAdapter: parachainAdapterAddress
    },
    config: {
      protocolFee: config.protocolFee,
      minSwapAmount: config.minSwapAmount.toString(),
      maxSwapAmount: config.maxSwapAmount.toString(),
      supportedTokens: config.supportedTokens,
      parachains: config.parachains
    },
    deployer: deployer.address,
    feeCollector: feeCollector.address,
    liquidityProvider: liquidityProvider.address
  };

  const deploymentPath: string = path.join(__dirname, `../deployments/deployment-${ethers.provider.network.name}-${Date.now()}.json`);
  
  // Ensure deployments directory exists
  const deploymentsDir: string = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  fs.writeFileSync(
    deploymentPath,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n Deployment completed successfully!");
  console.log(` Deployment info saved to: ${deploymentPath}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("\n Deployment failed:", error);
    process.exit(1);
  });