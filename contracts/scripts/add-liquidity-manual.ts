import { ethers } from "hardhat";

async function main() {
  console.log("\n💧 Adding liquidity manually...\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const USDC_ADDRESS = "0x5a5306B699d21c9d6a16A792b266215d550cc338";
  const WDOT_ADDRESS = "0xE32Abcaa249aB85bC995377E6DDd96f283343B28";
  const ROUTER_ADDRESS = "0x4288D462626ba3e7761A9aF2A7281f1f6F949Afb";
  const FACTORY_ADDRESS = "0xb2CA69fda5644aCd262EA526181C529882121c9d";
  const WPAS_ADDRESS = "0xD30D62367a61636a2D7c2bD759a507974be1B193";

  // ===========================================
  // STEP 1: VERIFY ROUTER CONTRACT
  // ===========================================
  console.log("\n🔍 Verifying router contract...");
  
  const code = await ethers.provider.getCode(ROUTER_ADDRESS);
  console.log(`Router address: ${ROUTER_ADDRESS}`);
  console.log(`Code length: ${code.length}`);
  console.log(`Has code: ${code !== '0x'}`);
  
  if (code === '0x') {
    throw new Error("❌ No contract deployed at router address!");
  }

  const routerAbi = [
    "function factory() external view returns (address)",
    "function WETH() external view returns (address)",
    "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB, uint liquidity)"
  ];
  
  const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, deployer);
  
  // Check factory
  const factory = await router.factory();
  console.log(`\nFactory address: ${factory}`);
  console.log(`Expected factory: ${FACTORY_ADDRESS}`);
  console.log(`Match: ${factory.toLowerCase() === FACTORY_ADDRESS.toLowerCase()}`);

  // Check WETH/WPAS
  const weth = await router.WETH();
  console.log(`\nWETH address: ${weth}`);
  console.log(`Expected WPAS: ${WPAS_ADDRESS}`);
  console.log(`Match: ${weth.toLowerCase() === WPAS_ADDRESS.toLowerCase()}`);

  if (factory.toLowerCase() !== FACTORY_ADDRESS.toLowerCase()) {
    throw new Error("❌ Router has wrong factory address!");
  }

  // ===========================================
  // STEP 2: GET TOKEN CONTRACTS
  // ===========================================
  console.log("\n📄 Getting token contracts...");
  const usdc = await ethers.getContractAt("MockERC20", USDC_ADDRESS);
  const wdot = await ethers.getContractAt("MockERC20", WDOT_ADDRESS);

  // Check token order
  const token0 = USDC_ADDRESS.toLowerCase() < WDOT_ADDRESS.toLowerCase() ? USDC_ADDRESS : WDOT_ADDRESS;
  const token1 = USDC_ADDRESS.toLowerCase() < WDOT_ADDRESS.toLowerCase() ? WDOT_ADDRESS : USDC_ADDRESS;
  
  const amount0 = ethers.parseUnits("5000", 6); // 5000 USDC
  const amount1 = ethers.parseUnits("500", 10); // 500 WDOT

  console.log(`Token0: ${token0} - Amount: ${ethers.formatUnits(amount0, token0 === USDC_ADDRESS ? 6 : 10)}`);
  console.log(`Token1: ${token1} - Amount: ${ethers.formatUnits(amount1, token1 === USDC_ADDRESS ? 6 : 10)}`);

  // ===========================================
  // STEP 3: CHECK PAIR
  // ===========================================
  console.log("\n🔍 Checking pair...");
  const factoryContract = await ethers.getContractAt("IUniswapV2Factory", FACTORY_ADDRESS);
  const pairAddress = await factoryContract.getPair(USDC_ADDRESS, WDOT_ADDRESS);
  console.log(`Pair address: ${pairAddress}`);

  if (pairAddress === "0x0000000000000000000000000000000000000000") {
    console.log("Creating pair...");
    const createTx = await factoryContract.createPair(USDC_ADDRESS, WDOT_ADDRESS);
    await createTx.wait();
    console.log("✅ Pair created!");
  } else {
    console.log("✅ Pair exists");
    
    // Check pair contract
    const pairCode = await ethers.provider.getCode(pairAddress);
    console.log(`Pair code length: ${pairCode.length}`);
    console.log(`Pair has code: ${pairCode !== '0x'}`);
    
    if (pairCode === '0x') {
      throw new Error("❌ Pair address has no code!");
    }
    
    // Check reserves
    const pairAbi = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];
    const pair = new ethers.Contract(pairAddress, pairAbi, ethers.provider);
    const reserves = await pair.getReserves();
    console.log(`Reserves: ${reserves[0]} / ${reserves[1]}`);
  }

  // ===========================================
  // STEP 4: CHECK ALLOWANCES
  // ===========================================
  console.log("\n💰 Checking allowances...");
  const usdcAllowance = await usdc.allowance(deployer.address, ROUTER_ADDRESS);
  const wdotAllowance = await wdot.allowance(deployer.address, ROUTER_ADDRESS);
  
  console.log(`USDC allowance: ${ethers.formatUnits(usdcAllowance, 6)}`);
  console.log(`WDOT allowance: ${ethers.formatUnits(wdotAllowance, 10)}`);

  // ===========================================
    // STEP 5: TRY MINTING DIRECTLY ON THE PAIR
    // ===========================================
    console.log("\n💧 Trying to mint directly on the pair...");

    // Use full pair ABI
    const pairAbi = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function mint(address to) external returns (uint liquidity)",
    "function burn(address to) external returns (uint amount0, uint amount1)",
    "function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external",
    "function skim(address to) external",
    "function sync() external",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function balanceOf(address owner) external view returns (uint)",
    "function totalSupply() external view returns (uint)"
    ];

    const pair = new ethers.Contract(pairAddress, pairAbi, deployer);

    try {
    // Check current pair balances
    const usdcBalance = await usdc.balanceOf(pairAddress);
    const wdotBalance = await wdot.balanceOf(pairAddress);
    console.log(`Current USDC in pair: ${ethers.formatUnits(usdcBalance, 6)}`);
    console.log(`Current WDOT in pair: ${ethers.formatUnits(wdotBalance, 10)}`);

    // Transfer tokens directly to the pair
    console.log("\nTransferring USDC to pair...");
    let tx = await usdc.transfer(pairAddress, amount0);
    await tx.wait();
    
    console.log("Transferring WDOT to pair...");
    tx = await wdot.transfer(pairAddress, amount1);
    await tx.wait();
    
    // Check new pair balances
    const newUsdcBalance = await usdc.balanceOf(pairAddress);
    const newWdotBalance = await wdot.balanceOf(pairAddress);
    console.log(`\nAfter transfer - USDC in pair: ${ethers.formatUnits(newUsdcBalance, 6)}`);
    console.log(`After transfer - WDOT in pair: ${ethers.formatUnits(newWdotBalance, 10)}`);
    
    // Get token order to understand reserves
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    console.log(`\nToken0: ${token0}`);
    console.log(`Token1: ${token1}`);
    
    // Check reserves before mint
    const reservesBefore = await pair.getReserves();
    console.log(`Reserves before mint: ${reservesBefore[0]} / ${reservesBefore[1]}`);
    
    // Mint LP tokens
    console.log("\nMinting LP tokens...");
    const mintTx = await pair.mint(deployer.address);
    await mintTx.wait();
    console.log("✅ LP tokens minted successfully!");
    
    // Check new reserves
    const reservesAfter = await pair.getReserves();
    console.log(`Reserves after mint: ${reservesAfter[0]} / ${reservesAfter[1]}`);
    
    // Check LP tokens received
    const lpBalance = await pair.balanceOf(deployer.address);
    console.log(`LP tokens received: ${ethers.formatEther(lpBalance)}`);
    
    } catch (error: any) {
    console.error("\n❌ Failed to mint:", error.message);
    if (error.data) console.error("Error data:", error.data);
    }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });