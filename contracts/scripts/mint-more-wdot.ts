import { ethers } from "hardhat";

async function main() {
  console.log("\n💰 Minting more WDOT tokens...\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const WDOT_ADDRESS = "0xE32Abcaa249aB85bC995377E6DDd96f283343B28";
  
  const wdot = await ethers.getContractAt("MockERC20", WDOT_ADDRESS);
  
  // Check current balance
  const balance = await wdot.balanceOf(deployer.address);
  console.log(`Current WDOT balance: ${ethers.formatUnits(balance, 10)}`);

  // Mint 1,000 more WDOT (since you had 500 left)
  const mintAmount = ethers.parseUnits("1000", 10);
  const tx = await wdot.mint(deployer.address, mintAmount);
  await tx.wait();
  
  const newBalance = await wdot.balanceOf(deployer.address);
  console.log(`New WDOT balance: ${ethers.formatUnits(newBalance, 10)}`);
  console.log(`✅ Minted ${ethers.formatUnits(mintAmount, 10)} WDOT`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });