declare module "*.json" {
    const value: any;
    export default value;
  }
  
  declare module "./abi/deployed-tokens.json" {
    const value: {
      usdc: string;
      wdot: string;
      chainId: string;
    };
    export default value;
  }