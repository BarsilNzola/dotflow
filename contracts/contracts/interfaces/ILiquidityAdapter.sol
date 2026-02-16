// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface ILiquidityAdapter {
    struct AdapterInfo {
        string name;
        address adapterAddress;
        bool isActive;
        uint256 tvl;
        uint24 fee;
        uint256 minSwapAmount;
        uint256 maxSwapAmount;
        address[] supportedTokens;
    }
    
    error AdapterInactive();
    error InsufficientLiquidity(uint256 available, uint256 required);
    error SlippageExceeded(uint256 expected, uint256 actual);
    error TokenNotSupported(address token);
    error InvalidAmount(uint256 amount, uint256 min, uint256 max);
    error SwapFailed();
    
    event SwapExecuted(
        address indexed adapter,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee,
        address recipient
    );
    
    event LiquidityAdded(address indexed token, uint256 amount, uint256 newReserve);
    event LiquidityRemoved(address indexed token, uint256 amount, uint256 newReserve);
    event AdapterActivated(address indexed adapter);
    event AdapterDeactivated(address indexed adapter);
    
    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bytes calldata data
    ) external returns (uint256 amountOut, uint256 fee);
    
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut, uint24 fee, uint256 priceImpact);
    
    function getAdapterInfo() external view returns (AdapterInfo memory);
    
    function isTokenSupported(address token) external view returns (bool);
    
    function getReserves(address token) external view returns (uint256 reserve, uint256 lastUpdate);
}