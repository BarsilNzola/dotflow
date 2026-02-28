import { ethers } from "hardhat";

async function main() {
  console.log("\n💰 Minting more USDC tokens...\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const USDC_ADDRESS = "0x5a5306B699d21c9d6a16A792b266215d550cc338";
  
  const usdc = await ethers.getContractAt("MockERC20", USDC_ADDRESS);
  
  // Check current balance
  const balance = await usdc.balanceOf(deployer.address);
  console.log(`Current USDC balance: ${ethers.formatUnits(balance, 6)}`);

  // Mint 10,000 more USDC
  const mintAmount = ethers.parseUnits("10000", 6);
  const tx = await usdc.mint(deployer.address, mintAmount);
  await tx.wait();
  
  const newBalance = await usdc.balanceOf(deployer.address);
  console.log(`New USDC balance: ${ethers.formatUnits(newBalance, 6)}`);
  console.log(`✅ Minted ${ethers.formatUnits(mintAmount, 6)} USDC`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });