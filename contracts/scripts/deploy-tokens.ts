import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  console.log("Deploying fresh MockERC20 tokens to Polkadot Hub...");
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("USDC deployed to:", usdcAddress);

  const wdot = await MockERC20.deploy("Wrapped DOT", "WDOT", 10);
  await wdot.waitForDeployment();
  const wdotAddress = await wdot.getAddress();
  console.log("WDOT deployed to:", wdotAddress);

  // Mint enough for liquidity pool + lots of user testing
  await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6));  // 1M USDC
  await wdot.mint(deployer.address, ethers.parseUnits("100000",  10)); // 100k WDOT
  console.log("Minted 1,000,000 USDC and 100,000 WDOT to deployer");

  const addresses = {
    usdc: usdcAddress,
    wdot: wdotAddress,
    chainId: (await deployer.provider?.getNetwork())?.chainId.toString() || "unknown"
  };

  fs.writeFileSync("deployed-tokens.json", JSON.stringify(addresses, null, 2));
  console.log("\nAddresses saved to deployed-tokens.json");
  console.log("USDC:", usdcAddress);
  console.log("WDOT:", wdotAddress);
  console.log("\nNext: run deploy.ts to redeploy all contracts with new token addresses");
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });