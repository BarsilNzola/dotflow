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
    if (signers.length < 1) throw new Error("No signers available");
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

  // Step 4: Load deployed token addresses
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

  // Step 5: Load configuration
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
    uniswapRouter:  "0x4288D462626ba3e7761A9aF2A7281f1f6F949Afb",
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
        gateway: "0x0000000000000000000000000000000000000800",
      },
      {
        id: 420420421,
        name: "Westend Asset Hub",
        bridgeFee: 5,
        minTransfer: ethers.parseUnits("0.1", 6),
        maxTransfer: ethers.parseUnits("5000", 6),
        timeout: 3600,
        gateway: "0x0000000000000000000000000000000000000801",
      },
    ],
    feeCollector: feeCollectorAddress,
    liquidityProvider: liquidityProviderAddress,
    initialLiquidity: {
      usdc: ethers.parseUnits("5000", 6),
      wdot: ethers.parseUnits("500", 10),
    },
  };

  console.log(`  - Fee Collector:       ${config.feeCollector}`);
  console.log(`  - Liquidity Provider:  ${config.liquidityProvider}`);
  console.log(`  - Uniswap Router:      ${config.uniswapRouter}`);
  console.log(`  - Uniswap Factory:     ${config.uniswapFactory}`);

  const network = await ethers.provider.getNetwork();
  console.log(`\n[6] Target network: ${network.name} (Chain ID: ${network.chainId})`);

  // Step 7: Get token contract instances
  console.log("\n[7] Getting token contract instances...");
  const usdcToken = await ethers.getContractAt("MockERC20", usdcAddress);
  const wdotToken = await ethers.getContractAt("MockERC20", wdotAddress);
  console.log("  - Token contracts loaded");

  // ─────────────────────────────────────────────────────────────────────────
  // DEPLOY CONTRACTS
  // ─────────────────────────────────────────────────────────────────────────

  // Step 8: Deploy CrossChainExecutor
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

  // Step 9: Configure CrossChainExecutor chains
  // CRITICAL: executor.sendParachainAssets checks cfg.isActive — must call configureChain
  // before any cross-chain swap attempt.
  console.log("\n[9] Configuring CrossChainExecutor chains...");
  for (const parachain of config.parachains) {
    try {
      console.log(`  - Configuring chain ${parachain.name} (ID: ${parachain.id})...`);
      const tx = await crossChainExecutor.connect(deployer).configureChain(
        parachain.id,
        parachain.name,
        // baseFee: 0.1 PAS in wei (18 decimals)
        ethers.parseEther("0.1"),
        // weightFee: fee per unit of weight
        1_000_000n,
        // minFee: 0.01 PAS
        ethers.parseEther("0.01"),
        // maxWeight
        10_000_000_000n,
        // xcmRefTime: ref time for weight
        500_000_000n,
        // xcmProofSize
        65536n
      );
      await tx.wait();
      console.log(`    ✓ Chain configured`);
    } catch (error: any) {
      console.error(`    ✗ Failed to configure chain ${parachain.name}: ${error.message}`);
      process.exit(1);
    }
  }

  // Step 10: Map assets on CrossChainExecutor
  // CRITICAL: executor.sendParachainAssets checks _assetToToken[parachainId][assetId] —
  // must map both tokens on both chains before any swap.
  console.log("\n[10] Mapping assets on CrossChainExecutor...");
  for (const parachain of config.parachains) {
    for (const [symbol, tokenAddress] of Object.entries(config.supportedTokens)) {
      try {
        console.log(`  - Mapping ${symbol} on ${parachain.name}...`);
        // assetId = token address zero-padded to bytes32 (matches router's encoding)
        const assetId = ethers.zeroPadValue(ethers.toBeHex(tokenAddress), 32);
        const decimals = symbol === "USDC" ? 6 : 10;
        const tx = await crossChainExecutor.connect(deployer).mapAsset(
          parachain.id,
          assetId,
          tokenAddress,
          decimals,
          false // isNative
        );
        await tx.wait();
        console.log(`    ✓ Mapped ${symbol} → chain ${parachain.id}`);
      } catch (error: any) {
        // "Already mapped" is fine if re-running
        if (error.message.includes("Already mapped")) {
          console.log(`    - Already mapped, skipping`);
        } else {
          console.error(`    ✗ Failed: ${error.message}`);
          process.exit(1);
        }
      }
    }
  }

  // Step 11: Deploy LiquidityManager
  console.log("\n[11] Deploying LiquidityManager...");
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

  // Step 12: Deploy DotFlowRouter
  console.log("\n[12] Deploying DotFlowRouter...");
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

  // Step 13: Wire router → executor
  console.log("\n[13] Configuring DotFlowRouter...");
  try {
    const tx = await router.connect(deployer).setXCMExecutor(crossChainExecutorAddress);
    await tx.wait();
    console.log("  - XCM Executor set on router");
  } catch (error: any) {
    console.error(`  - Failed to set XCM Executor: ${error.message}`);
    process.exit(1);
  }

  // Step 14: Deploy UniswapV2Adapter
  console.log("\n[14] Deploying UniswapV2Adapter...");
  let uniswapAdapter: any;
  let uniswapAdapterAddress: string | undefined;
  try {
    const factory = await ethers.getContractFactory("UniswapV2Adapter");
    uniswapAdapter = await factory.connect(deployer).deploy(
      "Uniswap V2 Adapter",
      config.uniswapRouter,
      config.uniswapFactory,
      config.adapterFee,
      config.minSwapAmount,
      config.maxSwapAmount,
      config.feeCollector
    );
    await uniswapAdapter.waitForDeployment();
    uniswapAdapterAddress = await uniswapAdapter.getAddress();
    console.log(`  - UniswapV2Adapter deployed to: ${uniswapAdapterAddress}`);
  } catch (error: any) {
    console.error(`  - UniswapV2Adapter deployment failed: ${error.message}`);
    console.log("  - Continuing without UniswapV2Adapter...");
  }

  // Step 15: Deploy ParachainAdapter
  console.log("\n[15] Deploying ParachainAdapter...");
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

  // Step 16: Add adapters to router
  console.log("\n[16] Adding adapters to router...");
  if (uniswapAdapterAddress) {
    try {
      const tx = await router.connect(deployer).addAdapter(uniswapAdapterAddress);
      await tx.wait();
      console.log("  - UniswapV2Adapter added to router");
    } catch (error: any) {
      console.error(`  - Failed to add UniswapV2Adapter: ${error.message}`);
    }
  }
  try {
    const tx = await router.connect(deployer).addAdapter(parachainAdapterAddress);
    await tx.wait();
    console.log("  - ParachainAdapter added to router");
  } catch (error: any) {
    console.error(`  - Failed to add ParachainAdapter: ${error.message}`);
    process.exit(1);
  }

  // Step 17: Configure parachains on ParachainAdapter
  console.log("\n[17] Configuring parachains on ParachainAdapter...");
  for (const parachain of config.parachains) {
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
      console.log(`    ✓ Configured`);
    } catch (error: any) {
      console.error(`    ✗ Failed: ${error.message}`);
    }
  }

  // Step 18: Map tokens on ParachainAdapter
  console.log("\n[18] Mapping tokens on ParachainAdapter...");
  for (const parachain of config.parachains) {
    for (const [symbol, tokenAddress] of Object.entries(config.supportedTokens)) {
      try {
        console.log(`  - Mapping ${symbol} on ${parachain.name}...`);
        const assetId = ethers.zeroPadValue(ethers.toBeHex(tokenAddress), 32);
        const decimals = symbol === "USDC" ? 6 : 10;
        const tx = await parachainAdapter.connect(deployer).mapToken(
          tokenAddress,
          parachain.id,
          assetId,
          decimals,
          parachain.minTransfer,
          parachain.maxTransfer,
          false // isNative
        );
        await tx.wait();
        console.log(`    ✓ Mapped`);
      } catch (error: any) {
        console.log(`    ✗ Failed to map ${symbol}: ${error.message}`);
      }
    }
  }

  // Step 19: Grant roles
  console.log("\n[19] Granting roles...");

  // Router needs EXECUTOR_ROLE on executor so it can call sendParachainAssets
  try {
    const executorRole = await crossChainExecutor.EXECUTOR_ROLE();
    const tx = await crossChainExecutor.connect(deployer).grantRole(executorRole, routerAddress);
    await tx.wait();
    console.log("  ✓ Granted EXECUTOR_ROLE to router on CrossChainExecutor");
  } catch (error: any) {
    console.error(`  ✗ Failed to grant EXECUTOR_ROLE: ${error.message}`);
  }

  // Deployer as relayer (for message management)
  try {
    const relayerRole = await crossChainExecutor.RELAYER_ROLE();
    const tx = await crossChainExecutor.connect(deployer).grantRole(relayerRole, deployer.address);
    await tx.wait();
    console.log("  ✓ Granted RELAYER_ROLE to deployer");
  } catch (error: any) {
    console.error(`  ✗ Failed to grant RELAYER_ROLE: ${error.message}`);
  }

  // BRIDGE_OPERATOR on ParachainAdapter for liquidity management
  try {
    const bridgeOperatorRole = await parachainAdapter.BRIDGE_OPERATOR();
    const tx = await parachainAdapter.connect(deployer).grantRole(bridgeOperatorRole, config.liquidityProvider);
    await tx.wait();
    console.log("  ✓ Granted BRIDGE_OPERATOR role on ParachainAdapter");
  } catch (error: any) {
    console.log(`  ✗ BRIDGE_OPERATOR role not granted: ${error.message}`);
  }

  if (uniswapAdapterAddress && uniswapAdapter) {
    try {
      const liquidityProviderRole = await uniswapAdapter.LIQUIDITY_PROVIDER();
      const tx = await uniswapAdapter.connect(deployer).grantRole(liquidityProviderRole, config.liquidityProvider);
      await tx.wait();
      console.log("  ✓ Granted LIQUIDITY_PROVIDER role on UniswapAdapter");
    } catch (error: any) {
      console.log(`  ✗ LIQUIDITY_PROVIDER role not granted: ${error.message}`);
    }
  }

  // Step 20: Initialize Uniswap pairs
  if (uniswapAdapterAddress && uniswapAdapter) {
    console.log("\n[20] Initializing Uniswap pairs...");
    const tokens = Object.values(config.supportedTokens);
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        try {
          const tx = await uniswapAdapter.connect(deployer).initializePair(tokens[i], tokens[j]);
          await tx.wait();
          console.log(`  ✓ Initialized pair ${tokens[i].slice(0,8)}…/${tokens[j].slice(0,8)}…`);
        } catch (error: any) {
          if (error.message.includes("Pair already supported")) {
            console.log(`  - Pair already exists`);
          } else {
            console.log(`  ✗ Pair initialization failed: ${error.message}`);
          }
        }
      }
    }
  }

  // Step 21: Create liquidity pools on LiquidityManager
  console.log("\n[21] Creating liquidity pools...");
  for (const [symbol, tokenAddress] of Object.entries(config.supportedTokens)) {
    try {
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
      console.log(`  ✓ Created pool for ${symbol}`);
    } catch (error: any) {
      console.log(`  ✗ Failed to create pool for ${symbol}: ${error.message}`);
    }
  }

  // Step 22: Add initial liquidity to Uniswap pair
  if (uniswapAdapterAddress && uniswapAdapter) {
    console.log("\n[22] Adding initial liquidity via direct pair mint...");
    try {
      const usdcBalance = await usdcToken.balanceOf(deployer.address);
      const wdotBalance = await wdotToken.balanceOf(deployer.address);
      console.log(`  - USDC Balance: ${ethers.formatUnits(usdcBalance, 6)}`);
      console.log(`  - WDOT Balance: ${ethers.formatUnits(wdotBalance, 10)}`);

      const factoryContract = await ethers.getContractAt("contracts/adapters/UniswapV2Adapter.sol:IUniswapV2Factory", config.uniswapFactory);
      let pairAddress = await factoryContract.getPair(usdcAddress, wdotAddress);

      if (pairAddress === ethers.ZeroAddress) {
        console.log("  - Creating pair...");
        const tx = await factoryContract.createPair(usdcAddress, wdotAddress);
        await tx.wait();
        pairAddress = await factoryContract.getPair(usdcAddress, wdotAddress);
        console.log(`  ✓ Pair created at: ${pairAddress}`);
      } else {
        console.log(`  - Pair exists: ${pairAddress}`);
      }

      let tx = await usdcToken.connect(deployer).transfer(pairAddress, config.initialLiquidity.usdc);
      await tx.wait();
      tx = await wdotToken.connect(deployer).transfer(pairAddress, config.initialLiquidity.wdot);
      await tx.wait();

      const pairAbi = [
        "function mint(address to) external returns (uint liquidity)",
        "function getReserves() external view returns (uint112,uint112,uint32)",
      ];
      const pair = new ethers.Contract(pairAddress, pairAbi, deployer);
      tx = await pair.mint(deployer.address);
      await tx.wait();
      console.log("  ✓ LP tokens minted");

      const reserves = await pair.getReserves();
      console.log(`  - Reserves: ${reserves[0]} / ${reserves[1]}`);

      console.log("  - Syncing adapter...");
      await uniswapAdapter.connect(deployer).syncPair(usdcAddress, wdotAddress);
      console.log("  ✓ Adapter synced");
    } catch (error: any) {
      console.error(`  ✗ Failed: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(50));
  console.log("DEPLOYMENT SUMMARY");
  console.log("=".repeat(50));
  console.log(`Router:              ${routerAddress}`);
  console.log(`LiquidityManager:    ${liquidityManagerAddress}`);
  console.log(`CrossChainExecutor:  ${crossChainExecutorAddress}`);
  console.log(`UniswapAdapter:      ${uniswapAdapterAddress ?? "Not deployed"}`);
  console.log(`ParachainAdapter:    ${parachainAdapterAddress}`);
  console.log(`USDC:                ${usdcAddress}`);
  console.log(`WDOT:                ${wdotAddress}`);
  console.log(`Deployer:            ${deployer.address}`);
  console.log("=".repeat(50));

  // Step 23: Save deployment info
  console.log("\n[23] Saving deployment info...");
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
        tokens: { usdc: usdcAddress, wdot: wdotAddress },
      },
      config: {
        protocolFee: config.protocolFee,
        minSwapAmount: config.minSwapAmount.toString(),
        maxSwapAmount: config.maxSwapAmount.toString(),
        supportedTokens: config.supportedTokens,
        parachains: config.parachains.map((p) => ({
          id: p.id,
          name: p.name,
          bridgeFee: p.bridgeFee,
          minTransfer: p.minTransfer.toString(),
          maxTransfer: p.maxTransfer.toString(),
          timeout: p.timeout,
          gateway: p.gateway,
        })),
      },
      deployer: deployer.address,
      feeCollector: config.feeCollector,
      liquidityProvider: config.liquidityProvider,
    };

    const deploymentsDir = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

    const deploymentPath = path.join(deploymentsDir, `deployment-${network.name}-${Date.now()}.json`);
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`  ✓ Saved to: ${deploymentPath}`);

    const frontendConfig = {
      chainId: Number(network.chainId),
      router: routerAddress,
      liquidityManager: liquidityManagerAddress,
      crossChainExecutor: crossChainExecutorAddress,
      uniswapAdapter: uniswapAdapterAddress,
      parachainAdapter: parachainAdapterAddress,
      tokens: { USDC: usdcAddress, WDOT: wdotAddress },
    };

    const frontendPath = path.join(__dirname, "../../apps/web/src/contracts/deployed-config.json");
    fs.mkdirSync(path.dirname(frontendPath), { recursive: true });
    fs.writeFileSync(frontendPath, JSON.stringify(frontendConfig, null, 2));
    console.log("  ✓ Frontend config saved");
  } catch (error: any) {
    console.error(`  ✗ Failed to save deployment info: ${error.message}`);
  }

  console.log("\nDeployment completed successfully!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("\nDeployment failed:", error);
    process.exit(1);
  });