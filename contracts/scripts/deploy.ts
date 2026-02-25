import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
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
  feeCollector: string;
  liquidityProvider: string;
}

interface DeploymentInfo {
  network: string;
  chainId: number;
  timestamp: string;
  contracts: {
    router: string;
    liquidityManager: string;
    crossChainExecutor: string;
    uniswapAdapter?: string;
    parachainAdapter: string;
  };
  config: {
    protocolFee: number;
    minSwapAmount: string;
    maxSwapAmount: string;
    supportedTokens: Record<string, string>;
    parachains: {
      id: number;
      name: string;
      bridgeFee: number;
      minTransfer: string;
      maxTransfer: string;
      timeout: number;
      gateway: string;
    }[];
  };
  deployer: string;
  feeCollector: string;
  liquidityProvider: string;
}

async function main(): Promise<void> {
  console.log("\nStarting DotFlow deployment...\n");

  // Step 1: Test network connectivity
  console.log("[1] Testing network connectivity...");
  try {
    const network = await ethers.provider.getNetwork();
    console.log(`  - Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
  } catch (error: any) {
    console.error(`  - Network connection failed: ${error.message}`);
    process.exit(1);
  }

  // Step 2: Get deployer signer
  console.log("\n[2] Getting deployer signer...");
  let deployer: SignerWithAddress;
  
  try {
    const signers = await ethers.getSigners();
    console.log(`  - Retrieved ${signers.length} signers`);
    
    if (signers.length < 1) {
      throw new Error("No signers available");
    }
    
    deployer = signers[0];
    console.log(`  - Deployer: ${deployer.address}`);
  } catch (error: any) {
    console.error(`  - Failed to get signer: ${error.message}`);
    process.exit(1);
  }

  // Step 3: Check deployer balance
  console.log("\n[3] Checking deployer balance...");
  try {
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`  - Deployer balance: ${ethers.formatEther(balance)} ETH`);
    
    if (balance === 0n) {
      console.error("  - ERROR: Deployer has zero balance - need funds for gas");
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`  - Failed to check balance: ${error.message}`);
    process.exit(1);
  }

  // Configuration
  console.log("\n[4] Loading configuration...");
  
  const feeCollectorAddress = deployer.address;
  const liquidityProviderAddress = deployer.address;
  
  const config: DeploymentConfig = {
    protocolFee: 30,
    minSwapAmount: ethers.parseEther("0.01"),
    maxSwapAmount: ethers.parseEther("1000"),
    adapterFee: 25,
    xcmTimeout: 3600,
    minLiquidity: ethers.parseEther("100"),
    maxLiquidity: ethers.parseEther("1000000"),
    reserveFactor: 1000,
    uniswapRouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    uniswapFactory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    supportedTokens: {
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    },
    parachains: [
      {
        id: 420420417,
        name: "Polkadot Hub",
        bridgeFee: 10,
        minTransfer: ethers.parseEther("1"),
        maxTransfer: ethers.parseEther("10000"),
        timeout: 7200,
        gateway: "0x0000000000000000000000000000000000000800"
      },
      {
        id: 420,
        name: "Westend",
        bridgeFee: 5,
        minTransfer: ethers.parseEther("0.1"),
        maxTransfer: ethers.parseEther("5000"),
        timeout: 3600,
        gateway: "0x0000000000000000000000000000000000000801"
      }
    ],
    feeCollector: feeCollectorAddress,
    liquidityProvider: liquidityProviderAddress
  };
  
  console.log("  - Configuration loaded");
  console.log(`  - Fee Collector: ${config.feeCollector}`);
  console.log(`  - Liquidity Provider: ${config.liquidityProvider}`);

  const network = await ethers.provider.getNetwork();
  console.log(`\n[5] Target network: ${network.name} (Chain ID: ${network.chainId})`);

  // Deploy CrossChainExecutor
  console.log("\n[6] Deploying CrossChainExecutor...");
  let crossChainExecutor: any;
  let crossChainExecutorAddress: string;
  
  try {
    const factory = await ethers.getContractFactory("CrossChainExecutor");
    crossChainExecutor = await factory.connect(deployer).deploy();
    await crossChainExecutor.waitForDeployment();
    crossChainExecutorAddress = await crossChainExecutor.getAddress();
    console.log(`  - CrossChainExecutor deployed to: ${crossChainExecutorAddress}`);
  } catch (error: any) {
    console.error(`  - CrossChainExecutor deployment failed: ${error.message}`);
    process.exit(1);
  }

  // Deploy LiquidityManager
  console.log("\n[7] Deploying LiquidityManager...");
  let liquidityManager: any;
  let liquidityManagerAddress: string;
  
  try {
    const factory = await ethers.getContractFactory("LiquidityManager");
    liquidityManager = await factory.connect(deployer).deploy();
    await liquidityManager.waitForDeployment();
    liquidityManagerAddress = await liquidityManager.getAddress();
    console.log(`  - LiquidityManager deployed to: ${liquidityManagerAddress}`);
  } catch (error: any) {
    console.error(`  - LiquidityManager deployment failed: ${error.message}`);
    process.exit(1);
  }

  // Deploy DotFlowRouter
  console.log("\n[8] Deploying DotFlowRouter...");
  let router: any;
  let routerAddress: string;
  
  try {
    const factory = await ethers.getContractFactory("DotFlowRouter");
    router = await factory.connect(deployer).deploy(config.feeCollector, config.protocolFee);
    await router.waitForDeployment();
    routerAddress = await router.getAddress();
    console.log(`  - DotFlowRouter deployed to: ${routerAddress}`);
  } catch (error: any) {
    console.error(`  - DotFlowRouter deployment failed: ${error.message}`);
    process.exit(1);
  }

  // Configure router
  console.log("\n[9] Configuring DotFlowRouter...");
  try {
    const tx = await router.connect(deployer).setXCMExecutor(crossChainExecutorAddress);
    await tx.wait();
    console.log("  - XCM Executor set");
  } catch (error: any) {
    console.error(`  - Failed to set XCM Executor: ${error.message}`);
    process.exit(1);
  }

  // Deploy UniswapV2Adapter
  console.log("\n[10] Deploying UniswapV2Adapter...");
  let uniswapAdapter: any;
  let uniswapAdapterAddress: string | undefined;

  try {
    const factory = await ethers.getContractFactory("UniswapV2Adapter");
    console.log("  - Factory obtained");
    
    uniswapAdapter = await factory.connect(deployer).deploy(
      "Uniswap V2 Adapter",
      config.uniswapRouter,
      config.adapterFee,
      config.minSwapAmount,
      config.maxSwapAmount,
      config.feeCollector
    );
    
    console.log(`  - Transaction hash: ${uniswapAdapter.deploymentTransaction()?.hash}`);
    console.log("  - Waiting for deployment confirmation...");
    
    await uniswapAdapter.waitForDeployment();
    uniswapAdapterAddress = await uniswapAdapter.getAddress();
    console.log(`  - UniswapV2Adapter deployed to: ${uniswapAdapterAddress}`);
  } catch (error: any) {
    console.error(`  - UniswapV2Adapter deployment failed: ${error.message}`);
    console.log("  - Continuing without UniswapV2Adapter...");
    uniswapAdapterAddress = undefined;
  }

  // Deploy ParachainAdapter
  console.log("\n[11] Deploying ParachainAdapter...");
  let parachainAdapter: any;
  let parachainAdapterAddress: string;
  
  try {
    const factory = await ethers.getContractFactory("ParachainAdapter");
    parachainAdapter = await factory.connect(deployer).deploy(
      "Parachain Adapter",
      crossChainExecutorAddress,
      config.adapterFee,
      config.minSwapAmount,
      config.maxSwapAmount
    );
    await parachainAdapter.waitForDeployment();
    parachainAdapterAddress = await parachainAdapter.getAddress();
    console.log(`  - ParachainAdapter deployed to: ${parachainAdapterAddress}`);
  } catch (error: any) {
    console.error(`  - ParachainAdapter deployment failed: ${error.message}`);
    process.exit(1);
  }

  // Add adapters to router
  console.log("\n[12] Adding adapters to router...");
  
  // Add ParachainAdapter
  try {
    const tx = await router.connect(deployer).addAdapter(parachainAdapterAddress);
    await tx.wait();
    console.log("  - ParachainAdapter added to router");
  } catch (error: any) {
    console.error(`  - Failed to add ParachainAdapter: ${error.message}`);
    process.exit(1);
  }
  
  // Add UniswapV2Adapter if deployed
  if (uniswapAdapterAddress) {
    try {
      const tx = await router.connect(deployer).addAdapter(uniswapAdapterAddress);
      await tx.wait();
      console.log("  - UniswapV2Adapter added to router");
    } catch (error: any) {
      console.error(`  - Failed to add UniswapV2Adapter: ${error.message}`);
    }
  }

  // Configure parachains
  console.log("\n[13] Configuring parachains...");
  for (let i = 0; i < config.parachains.length; i++) {
    const parachain = config.parachains[i];
    try {
      console.log(`  - Configuring ${parachain.name} (ID: ${parachain.id})...`);
      const tx = await parachainAdapter.connect(deployer).configureParachain(
        parachain.id,
        parachain.name,
        parachain.bridgeFee,
        parachain.minTransfer,
        parachain.maxTransfer,
        parachain.timeout
      );
      await tx.wait();
      console.log(`    - Configured`);
    } catch (error: any) {
      console.error(`    - Failed: ${error.message}`);
    }
  }

  // Map tokens to parachains
  console.log("\n[14] Mapping tokens to parachains...");
  for (const parachain of config.parachains) {
    for (const [symbol, tokenAddress] of Object.entries(config.supportedTokens)) {
      try {
        console.log(`  - Mapping ${symbol} to ${parachain.name}...`);
        
        const assetId: string = ethers.zeroPadValue(ethers.toBeHex(tokenAddress), 32);
        const isNative: boolean = symbol === "WETH" && parachain.id === 3000;
        
        const tx = await parachainAdapter.connect(deployer).mapToken(
          tokenAddress,
          parachain.id,
          assetId,
          18,
          parachain.minTransfer,
          parachain.maxTransfer,
          isNative
        );
        await tx.wait();
        console.log(`    - Mapped ${symbol} to ${parachain.name}`);
      } catch (error: any) {
        console.log(`    - Failed to map ${symbol}: ${error.message}`);
      }
    }
  }

  // Initialize Uniswap pairs if adapter deployed
  if (uniswapAdapterAddress && uniswapAdapter) {
    console.log("\n[15] Initializing Uniswap pairs...");
    const tokens: string[] = Object.values(config.supportedTokens);
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        try {
          console.log(`  - Initializing pair: ${tokens[i].slice(0, 6)}... - ${tokens[j].slice(0, 6)}...`);
          const tx = await uniswapAdapter.connect(deployer).initializePair(tokens[i], tokens[j]);
          await tx.wait();
          console.log(`    - Initialized`);
        } catch (error: any) {
          console.log(`    - Pair initialization failed: ${error.message}`);
        }
      }
    }
  }

  // Grant roles
  console.log("\n[16] Granting roles...");
  
  try {
    const bridgeOperatorRole: string = await parachainAdapter.BRIDGE_OPERATOR();
    const tx = await parachainAdapter.connect(deployer).grantRole(bridgeOperatorRole, config.liquidityProvider);
    await tx.wait();
    console.log("  - Granted BRIDGE_OPERATOR role");
  } catch (error: any) {
    console.log(`  - BRIDGE_OPERATOR role not granted: ${error.message}`);
  }

  try {
    const executorRole: string = await crossChainExecutor.EXECUTOR_ROLE();
    const tx = await crossChainExecutor.connect(deployer).grantRole(executorRole, routerAddress);
    await tx.wait();
    console.log("  - Granted EXECUTOR_ROLE");
  } catch (error: any) {
    console.error(`  - Failed to grant EXECUTOR_ROLE: ${error.message}`);
  }

  try {
    const relayerRole: string = await crossChainExecutor.RELAYER_ROLE();
    const tx = await crossChainExecutor.connect(deployer).grantRole(relayerRole, deployer.address);
    await tx.wait();
    console.log("  - Granted RELAYER_ROLE");
  } catch (error: any) {
    console.error(`  - Failed to grant RELAYER_ROLE: ${error.message}`);
  }

  // Grant LIQUIDITY_PROVIDER role on UniswapAdapter if deployed
  if (uniswapAdapterAddress && uniswapAdapter) {
    try {
      const liquidityProviderRole: string = await uniswapAdapter.LIQUIDITY_PROVIDER();
      const tx = await uniswapAdapter.connect(deployer).grantRole(liquidityProviderRole, config.liquidityProvider);
      await tx.wait();
      console.log("  - Granted LIQUIDITY_PROVIDER role on UniswapAdapter");
    } catch (error: any) {
      console.log(`  - LIQUIDITY_PROVIDER role not granted: ${error.message}`);
    }
  }

  // Create liquidity pools
  console.log("\n[17] Creating liquidity pools...");
  for (const [symbol, tokenAddress] of Object.entries(config.supportedTokens)) {
    try {
      console.log(`  - Creating pool for ${symbol}...`);
      const tx = await liquidityManager.connect(deployer).createPool(
        tokenAddress,
        `${symbol} Liquidity Pool`,
        `lp${symbol}`,
        0,
        config.adapterFee,
        config.reserveFactor,
        config.minLiquidity,
        config.maxLiquidity
      );
      await tx.wait();
      console.log(`    - Created pool for ${symbol}`);
    } catch (error: any) {
      console.log(`    - Failed to create pool for ${symbol}: ${error.message}`);
    }
  }

  // Deployment Summary
  console.log("\n" + "=".repeat(50));
  console.log("DEPLOYMENT SUMMARY");
  console.log("=".repeat(50));
  console.log(`Router: ${routerAddress}`);
  console.log(`LiquidityManager: ${liquidityManagerAddress}`);
  console.log(`CrossChainExecutor: ${crossChainExecutorAddress}`);
  console.log(`UniswapAdapter: ${uniswapAdapterAddress || "Not deployed"}`);
  console.log(`ParachainAdapter: ${parachainAdapterAddress}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Fee Collector: ${config.feeCollector}`);
  console.log(`Liquidity Provider: ${config.liquidityProvider}`);
  console.log("=".repeat(50));

  // Save deployment info
  console.log("\n[18] Saving deployment info...");
  try {
    const deploymentInfo: DeploymentInfo = {
      network: network.name,
      chainId: Number(network.chainId),
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
        parachains: config.parachains.map(p => ({
          id: p.id,
          name: p.name,
          bridgeFee: p.bridgeFee,
          minTransfer: p.minTransfer.toString(),
          maxTransfer: p.maxTransfer.toString(),
          timeout: p.timeout,
          gateway: p.gateway
        }))
      },
      deployer: deployer.address,
      feeCollector: config.feeCollector,
      liquidityProvider: config.liquidityProvider
    };

    const deploymentPath: string = path.join(__dirname, `../deployments/deployment-${network.name}-${Date.now()}.json`);
    
    const deploymentsDir: string = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    fs.writeFileSync(
      deploymentPath,
      JSON.stringify(deploymentInfo, null, 2)
    );

    console.log(`  - Deployment info saved to: ${deploymentPath}`);
  } catch (error: any) {
    console.error(`  - Failed to save deployment info: ${error.message}`);
  }

  console.log("\nDeployment completed successfully!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("\nDeployment failed:", error);
    process.exit(1);
  });