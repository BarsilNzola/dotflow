import { ethers } from "hardhat";

async function main() {
  console.log("\n💰 Minting more tokens...\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const USDC_ADDRESS = "0x5a5306B699d21c9d6a16A792b266215d550cc338";
  const WDOT_ADDRESS = "0xE32Abcaa249aB85bC995377E6DDd96f283343B28";
  
  const usdc = await ethers.getContractAt("MockERC20", USDC_ADDRESS);
  const wdot = await ethers.getContractAt("MockERC20", WDOT_ADDRESS);
  
  // Check USDC balance
  const usdcBalance = await usdc.balanceOf(deployer.address);
  console.log(`Current USDC balance: ${ethers.formatUnits(usdcBalance, 6)}`);
  
  // Mint 10,000 USDC if needed
  if (usdcBalance < ethers.parseUnits("5000", 6)) {
    const mintAmount = ethers.parseUnits("10000", 6);
    const tx = await usdc.mint(deployer.address, mintAmount);
    await tx.wait();
    const newBalance = await usdc.balanceOf(deployer.address);
    console.log(`✅ Minted 10,000 USDC - New balance: ${ethers.formatUnits(newBalance, 6)}`);
  } else {
    console.log(`✅ USDC balance sufficient: ${ethers.formatUnits(usdcBalance, 6)}`);
  }

  // Check WDOT balance
  const wdotBalance = await wdot.balanceOf(deployer.address);
  console.log(`\nCurrent WDOT balance: ${ethers.formatUnits(wdotBalance, 10)}`);
  
  // Mint 1,000 WDOT if needed
  if (wdotBalance < ethers.parseUnits("1000", 10)) {
    const mintAmount = ethers.parseUnits("1000", 10);
    const tx = await wdot.mint(deployer.address, mintAmount);
    await tx.wait();
    const newBalance = await wdot.balanceOf(deployer.address);
    console.log(`✅ Minted 1,000 WDOT - New balance: ${ethers.formatUnits(newBalance, 10)}`);
  } else {
    console.log(`✅ WDOT balance sufficient: ${ethers.formatUnits(wdotBalance, 10)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });