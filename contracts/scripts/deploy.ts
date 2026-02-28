import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import * as fs from "fs";
import * as path from "path";

// ===========================================
// INTERFACES
// ===========================================

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
  initialLiquidity: {
    usdc: bigint;
    wdot: bigint;
  };
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
    tokens: {
      usdc: string;
      wdot: string;
    };
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

// ===========================================
// MAIN DEPLOYMENT FUNCTION
// ===========================================

async function main(): Promise<void> {
  console.log("\nStarting DotFlow deployment with MockERC20 tokens...\n");

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
    console.log(`  - Deployer balance: ${ethers.formatEther(balance)} PAS`);
    
    if (balance === 0n) {
      console.error("  - ERROR: Deployer has zero balance - need funds for gas");
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`  - Failed to check balance: ${error.message}`);
    process.exit(1);
  }

  // Load deployed token addresses
  console.log("\n[4] Loading MockERC20 token addresses...");
  let usdcAddress: string;
  let wdotAddress: string;
  
  try {
    const deployedTokens = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../deployed-tokens.json"), "utf-8")
    );
    usdcAddress = deployedTokens.usdc;
    wdotAddress = deployedTokens.wdot;
    console.log(`  - USDC: ${usdcAddress}`);
    console.log(`  - WDOT: ${wdotAddress}`);
  } catch (error: any) {
    console.error(`  - Failed to load token addresses: ${error.message}`);
    console.log("  - Make sure you've run deploy-tokens.ts first");
    process.exit(1);
  }

  // Configuration with actual deployed tokens and Uniswap addresses
  console.log("\n[5] Loading configuration...");
  
  const feeCollectorAddress = deployer.address;
  const liquidityProviderAddress = deployer.address;
  
  const config: DeploymentConfig = {
    protocolFee: 30,
    minSwapAmount: ethers.parseUnits("0.01", 18),
    maxSwapAmount: ethers.parseUnits("10000", 18),
    adapterFee: 25,
    xcmTimeout: 3600,
    minLiquidity: ethers.parseUnits("100", 18),
    maxLiquidity: ethers.parseUnits("1000000", 18),
    reserveFactor: 1000,
    // Real Uniswap V2 addresses deployed on Polkadot Hub
    uniswapRouter: "0x4288D462626ba3e7761A9aF2A7281f1f6F949Afb",
    uniswapFactory: "0xb2CA69fda5644aCd262EA526181C529882121c9d",
    supportedTokens: {
      USDC: usdcAddress,
      WDOT: wdotAddress,
    },
    parachains: [
      {
        id: 420420417,
        name: "Polkadot Hub",
        bridgeFee: 10,
        minTransfer: ethers.parseUnits("1", 6),
        maxTransfer: ethers.parseUnits("10000", 6),
        timeout: 7200,
        gateway: "0x0000000000000000000000000000000000000800"
      },
      {
        id: 420,
        name: "Westend",
        bridgeFee: 5,
        minTransfer: ethers.parseUnits("0.1", 6),
        maxTransfer: ethers.parseUnits("5000", 6),
        timeout: 3600,
        gateway: "0x0000000000000000000000000000000000000801"
      }
    ],
    feeCollector: feeCollectorAddress,
    liquidityProvider: liquidityProviderAddress,
    initialLiquidity: {
      usdc: ethers.parseUnits("5000", 6),
      wdot: ethers.parseUnits("500", 10),
    }
  };
  
  console.log("  - Configuration loaded");
  console.log(`  - Fee Collector: ${config.feeCollector}`);
  console.log(`  - Liquidity Provider: ${config.liquidityProvider}`);
  console.log(`  - Supported tokens: ${Object.keys(config.supportedTokens).join(", ")}`);
  console.log(`  - Uniswap Router: ${config.uniswapRouter}`);
  console.log(`  - Uniswap Factory: ${config.uniswapFactory}`);

  const network = await ethers.provider.getNetwork();
  console.log(`\n[6] Target network: ${network.name} (Chain ID: ${network.chainId})`);

  // Get token contract instances
  console.log("\n[7] Getting token contract instances...");
  const usdcToken = await ethers.getContractAt("MockERC20", usdcAddress);
  const wdotToken = await ethers.getContractAt("MockERC20", wdotAddress);
  console.log("  - Token contracts loaded");

  // Deploy CrossChainExecutor
  console.log("\n[8] Deploying CrossChainExecutor...");
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
  console.log("\n[9] Deploying LiquidityManager...");
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
  console.log("\n[10] Deploying DotFlowRouter...");
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
  console.log("\n[11] Configuring DotFlowRouter...");
  try {
    const tx = await router.connect(deployer).setXCMExecutor(crossChainExecutorAddress);
    await tx.wait();
    console.log("  - XCM Executor set");
  } catch (error: any) {
    console.error(`  - Failed to set XCM Executor: ${error.message}`);
    process.exit(1);
  }

  // Deploy UniswapV2Adapter with explicit factory address
  console.log("\n[12] Deploying UniswapV2Adapter...");
  let uniswapAdapter: any;
  let uniswapAdapterAddress: string | undefined;

  try {
    const factory = await ethers.getContractFactory("UniswapV2Adapter");
    console.log(`  - Using Uniswap Router: ${config.uniswapRouter}`);
    console.log(`  - Using Uniswap Factory: ${config.uniswapFactory}`);
    
    uniswapAdapter = await factory.connect(deployer).deploy(
      "Uniswap V2 Adapter",
      config.uniswapRouter,
      config.uniswapFactory,
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
    
    // Verify factory was set correctly
    const currentFactory = await uniswapAdapter.getFactory();
    console.log(`  - Factory verified: ${currentFactory}`);
    
  } catch (error: any) {
    console.error(`  - UniswapV2Adapter deployment failed: ${error.message}`);
    console.log("  - Continuing without UniswapV2Adapter...");
    uniswapAdapterAddress = undefined;
  }

  // Deploy ParachainAdapter
  console.log("\n[13] Deploying ParachainAdapter...");
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
  console.log("\n[14] Adding adapters to router...");
  
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
  console.log("\n[15] Configuring parachains...");
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
  console.log("\n[16] Mapping tokens to parachains...");
  for (const parachain of config.parachains) {
    for (const [symbol, tokenAddress] of Object.entries(config.supportedTokens)) {
      try {
        console.log(`  - Mapping ${symbol} to ${parachain.name}...`);
        
        const assetId: string = ethers.zeroPadValue(ethers.toBeHex(tokenAddress), 32);
        const decimals = symbol === "USDC" ? 6 : 10;
        const isNative: boolean = false;
        
        const tx = await parachainAdapter.connect(deployer).mapToken(
          tokenAddress,
          parachain.id,
          assetId,
          decimals,
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
    console.log("\n[17] Initializing Uniswap pairs...");
    const tokens: string[] = Object.values(config.supportedTokens);
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        try {
          console.log(`  - Initializing pair: ${tokens[i].slice(0, 6)}... - ${tokens[j].slice(0, 6)}...`);
          const tx = await uniswapAdapter.connect(deployer).initializePair(tokens[i], tokens[j]);
          await tx.wait();
          console.log(`    - Initialized`);
        } catch (error: any) {
          if (error.message.includes("Pair already supported")) {
            console.log(`    - Pair already exists, continuing...`);
          } else {
            console.log(`    - Pair initialization failed: ${error.message}`);
          }
        }
      }
    }
  }

  // Grant roles
  console.log("\n[18] Granting roles...");
  
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
  console.log("\n[19] Creating liquidity pools...");
  for (const [symbol, tokenAddress] of Object.entries(config.supportedTokens)) {
    try {
      console.log(`  - Creating pool for ${symbol}...`);
      const decimals = symbol === "USDC" ? 6 : 10;
      const tx = await liquidityManager.connect(deployer).createPool(
        tokenAddress,
        `${symbol} Liquidity Pool`,
        `lp${symbol}`,
        0,
        config.adapterFee,
        config.reserveFactor,
        ethers.parseUnits("100", decimals),
        ethers.parseUnits("1000000", decimals)
      );
      await tx.wait();
      console.log(`    - Created pool for ${symbol}`);
    } catch (error: any) {
      console.log(`    - Failed to create pool for ${symbol}: ${error.message}`);
    }
  }

  // ===========================================
  // FIXED: Add initial liquidity using direct pair minting
  // ===========================================
  if (uniswapAdapterAddress && uniswapAdapter) {
    console.log("\n[20] Adding initial liquidity to Uniswap...");
    
    try {
      const usdcBalance = await usdcToken.balanceOf(deployer.address);
      const wdotBalance = await wdotToken.balanceOf(deployer.address);
      
      console.log(`  - USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`);
      console.log(`  - WDOT Balance: ${ethers.formatUnits(wdotBalance, 10)} WDOT`);
      
      if (usdcBalance < config.initialLiquidity.usdc) {
        throw new Error(`Insufficient USDC balance. Have: ${ethers.formatUnits(usdcBalance, 6)}, Need: ${ethers.formatUnits(config.initialLiquidity.usdc, 6)}`);
      }
      if (wdotBalance < config.initialLiquidity.wdot) {
        throw new Error(`Insufficient WDOT balance. Have: ${ethers.formatUnits(wdotBalance, 10)}, Need: ${ethers.formatUnits(config.initialLiquidity.wdot, 10)}`);
      }
      
      // Get factory
      console.log("  - Getting factory...");
      const factory = await ethers.getContractAt("IUniswapV2Factory", config.uniswapFactory);
      
      // Check if pair exists
      let pairAddress = await factory.getPair(usdcAddress, wdotAddress);
      console.log(`  - Pair address: ${pairAddress}`);
      
      if (pairAddress === "0x0000000000000000000000000000000000000000") {
        console.log("  - Creating pair...");
        const createTx = await factory.createPair(usdcAddress, wdotAddress);
        await createTx.wait();
        pairAddress = await factory.getPair(usdcAddress, wdotAddress);
        console.log(`    - Pair created at: ${pairAddress}`);
      }
      
      // Get pair contract with full ABI
      const pairAbi = [
        "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
        "function mint(address to) external returns (uint liquidity)",
        "function token0() external view returns (address)",
        "function token1() external view returns (address)",
        "function balanceOf(address owner) external view returns (uint)",
        "function totalSupply() external view returns (uint)"
      ];
      
      const pair = new ethers.Contract(pairAddress, pairAbi, deployer);
      
      // Check current pair balances
      const usdcInPair = await usdcToken.balanceOf(pairAddress);
      const wdotInPair = await wdotToken.balanceOf(pairAddress);
      console.log(`  - Current USDC in pair: ${ethers.formatUnits(usdcInPair, 6)}`);
      console.log(`  - Current WDOT in pair: ${ethers.formatUnits(wdotInPair, 10)}`);

      // Transfer tokens directly to the pair
      console.log("  - Transferring USDC to pair...");
      let tx = await usdcToken.connect(deployer).transfer(pairAddress, config.initialLiquidity.usdc);
      await tx.wait();
      
      console.log("  - Transferring WDOT to pair...");
      tx = await wdotToken.connect(deployer).transfer(pairAddress, config.initialLiquidity.wdot);
      await tx.wait();
      
      // Check new pair balances
      const newUsdcInPair = await usdcToken.balanceOf(pairAddress);
      const newWdotInPair = await wdotToken.balanceOf(pairAddress);
      console.log(`  - After transfer - USDC in pair: ${ethers.formatUnits(newUsdcInPair, 6)}`);
      console.log(`  - After transfer - WDOT in pair: ${ethers.formatUnits(newWdotInPair, 10)}`);
      
      // Get token order
      const token0 = await pair.token0();
      const token1 = await pair.token1();
      console.log(`  - Token0: ${token0}`);
      console.log(`  - Token1: ${token1}`);
      
      // Check reserves before mint
      const reservesBefore = await pair.getReserves();
      console.log(`  - Reserves before mint: ${reservesBefore[0]} / ${reservesBefore[1]}`);
      
      // Mint LP tokens
      console.log("  - Minting LP tokens...");
      const mintTx = await pair.mint(deployer.address);
      await mintTx.wait();
      console.log(`    - ✅ LP tokens minted! (tx: ${mintTx.hash})`);
      
      // Check new reserves
      const reservesAfter = await pair.getReserves();
      console.log(`  - Reserves after mint: ${reservesAfter[0]} / ${reservesAfter[1]}`);
      
      // Check LP tokens received
      const lpBalance = await pair.balanceOf(deployer.address);
      console.log(`  - LP tokens received: ${ethers.formatEther(lpBalance)}`);
      
      // Sync the adapter
      console.log("  - Syncing Uniswap adapter...");
      await uniswapAdapter.syncPair(usdcAddress, wdotAddress);
      
      // Verify the pair in adapter
      const finalPairInfo = await uniswapAdapter.getPairInfo(usdcAddress, wdotAddress);
      console.log(`  - Final adapter pair check:`);
      console.log(`    - Pair address: ${finalPairInfo[0]}`);
      console.log(`    - Reserve0: ${finalPairInfo[1]}`);
      console.log(`    - Reserve1: ${finalPairInfo[2]}`);
      console.log(`    - Liquidity: ${finalPairInfo[4]}`);
      
    } catch (error: any) {
      console.error(`  - ❌ Failed to add initial liquidity: ${error.message}`);
      if (error.data) console.error(`  - Error data: ${error.data}`);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("DEPLOYMENT SUMMARY");
  console.log("=".repeat(50));
  console.log(`Router: ${routerAddress}`);
  console.log(`LiquidityManager: ${liquidityManagerAddress}`);
  console.log(`CrossChainExecutor: ${crossChainExecutorAddress}`);
  console.log(`UniswapAdapter: ${uniswapAdapterAddress || "Not deployed"}`);
  console.log(`ParachainAdapter: ${parachainAdapterAddress}`);
  console.log(`Tokens:`);
  console.log(`  - USDC: ${usdcAddress}`);
  console.log(`  - WDOT: ${wdotAddress}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Fee Collector: ${config.feeCollector}`);
  console.log(`Liquidity Provider: ${config.liquidityProvider}`);
  console.log("=".repeat(50));

  console.log("\n[21] Saving deployment info...");
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
        parachainAdapter: parachainAdapterAddress,
        tokens: {
          usdc: usdcAddress,
          wdot: wdotAddress
        }
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
    
    const frontendConfig = {
      chainId: Number(network.chainId),
      router: routerAddress,
      liquidityManager: liquidityManagerAddress,
      crossChainExecutor: crossChainExecutorAddress,
      uniswapAdapter: uniswapAdapterAddress,
      parachainAdapter: parachainAdapterAddress,
      tokens: {
        USDC: usdcAddress,
        WDOT: wdotAddress
      }
    };
    
    fs.writeFileSync(
      path.join(__dirname, "../../apps/web/src/contracts/deployed-config.json"),
      JSON.stringify(frontendConfig, null, 2)
    );
    console.log("  - Frontend config saved to apps/web/src/contracts/deployed-config.json");
    
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