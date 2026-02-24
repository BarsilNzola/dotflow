import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.23",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000000,
        details: {
          yul: true,
          yulDetails: {
            stackAllocation: true,
            optimizerSteps: "dhfoDgvulfnTUtnIf"
          }
        }
      },
      viaIR: true,
      evmVersion: "paris",
      metadata: {
        bytecodeHash: "ipfs"
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1337,
      gasPrice: "auto",
      blockGasLimit: 30000000
    },
    polkadotHub: {
      url: process.env.RPC_POLKADOT_HUB || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 3000,
      gasPrice: "auto"
    },
    westend: {
      url: process.env.RPC_WESTEND || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 420,
      gasPrice: "auto"
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 40000
  },
};

export default config;