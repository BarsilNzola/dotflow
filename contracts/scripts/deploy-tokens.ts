import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  console.log("Deploying MockERC20 tokens to Polkadot Hub...");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Deploy Token A (USDC-like - 6 decimals)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const tokenA = await MockERC20.deploy("USD Coin", "USDC", 6);
  await tokenA.waitForDeployment();
  const tokenAAddress = await tokenA.getAddress();
  console.log("USDC deployed to:", tokenAAddress);

  // Deploy Token B (WDOT-like - 10 decimals)
  const tokenB = await MockERC20.deploy("Wrapped DOT", "WDOT", 10);
  await tokenB.waitForDeployment();
  const tokenBAddress = await tokenB.getAddress();
  console.log("WDOT deployed to:", tokenBAddress);

  // Mint some tokens to deployer for testing
  const mintAmountA = ethers.parseUnits("10000", 6); // 10,000 USDC
  const mintAmountB = ethers.parseUnits("1000", 10); // 1,000 WDOT

  await tokenA.mint(deployer.address, mintAmountA);
  await tokenB.mint(deployer.address, mintAmountB);

  console.log("Minted 10,000 USDC and 1,000 WDOT to deployer");

  // Save addresses to a file for frontend
  const addresses = {
    usdc: tokenAAddress,
    wdot: tokenBAddress,
    chainId: (await deployer.provider?.getNetwork())?.chainId.toString() || "unknown"
  };
  
  fs.writeFileSync(
    "deployed-tokens.json",
    JSON.stringify(addresses, null, 2)
  );
  console.log("Addresses saved to deployed-tokens.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });