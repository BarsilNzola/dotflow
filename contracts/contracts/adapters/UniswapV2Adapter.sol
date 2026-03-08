// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/ILiquidityAdapter.sol";

/**
 * @dev Router-free Uniswap V2 Adapter.
 *
 * The Uniswap V2 router deployed on Polkadot Hub has broken getAmountsOut
 * and addLiquidity functions. This adapter bypasses the router entirely:
 *
 *  - Swaps:     transfer tokenIn to pair → pair.swap()
 *  - Quotes:    pure AMM math using live pair reserves
 *  - Liquidity: transfer tokens to pair → pair.mint() / pair.burn()
 */

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    function mint(address to) external returns (uint256 liquidity);
    function burn(address to) external returns (uint256 amount0, uint256 amount1);
    function balanceOf(address owner) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function skim(address to) external;
    function sync() external;
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

contract UniswapV2Adapter is ILiquidityAdapter, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant ADAPTER_ADMIN     = keccak256("ADAPTER_ADMIN");
    bytes32 public constant LIQUIDITY_PROVIDER = keccak256("LIQUIDITY_PROVIDER");
    bytes32 public constant FEE_MANAGER        = keccak256("FEE_MANAGER");

    struct PairInfo {
        address pair;
        uint112 reserve0;
        uint112 reserve1;
        uint32  lastUpdate;
        uint24  swapFee;
        uint256 liquidity;
    }

    string  private _name;
    address private _factory;
    uint24  private _feePercent;
    uint256 private _minSwapAmount;
    uint256 private _maxSwapAmount;
    bool    private _active;
    address private _feeCollector;

    EnumerableSet.AddressSet private _supportedTokens;
    mapping(address => mapping(address => PairInfo)) private _pairInfo;
    mapping(address => mapping(address => bool))     private _supportedPairs;
    mapping(address => uint256)                      private _tokenBalances;
    mapping(address => uint256)                      private _lastSync;
    mapping(address => mapping(address => uint256))  private _pairLiquidity;

    uint256 private constant FEE_DENOMINATOR = 10000;
    uint24  private constant MAX_FEE_PERCENT = 300;
    uint256 private constant SYNC_INTERVAL   = 1 hours;

    event PairInitialized(address indexed tokenA, address indexed tokenB, address pair);
    event PairSynced(address indexed tokenA, address indexed tokenB, uint112 reserve0, uint112 reserve1);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event LiquidityProvided(address indexed provider, address indexed tokenA, address indexed tokenB, uint amountA, uint amountB, uint liquidity);

    error PairNotInitialized(address tokenA, address tokenB);

    constructor(
        string memory name_,
        address /*router_*/,   // unused — router is broken on this fork
        address factory_,
        uint24  fee_,
        uint256 minSwapAmount_,
        uint256 maxSwapAmount_,
        address feeCollector_
    ) {
        require(factory_      != address(0), "Invalid factory");
        require(feeCollector_ != address(0), "Invalid fee collector");
        require(fee_ <= MAX_FEE_PERCENT, "Fee too high");

        _name          = name_;
        _factory       = factory_;
        _feePercent    = fee_;
        _minSwapAmount = minSwapAmount_;
        _maxSwapAmount = maxSwapAmount_;
        _feeCollector  = feeCollector_;
        _active        = true;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADAPTER_ADMIN,      msg.sender);
        _grantRole(FEE_MANAGER,        msg.sender);
    }

    // ─────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────

    function _getTokenDecimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok, "decimals() failed");
        return abi.decode(data, (uint8));
    }

    function _to18Decimals(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        if (decimals == 18) return amount;
        if (decimals < 18)  return amount * 10 ** (18 - decimals);
        return amount / 10 ** (decimals - 18);
    }

    /// @dev Uniswap V2 AMM formula: amountOut = (amountIn*9975*reserveOut) / (reserveIn*10000 + amountIn*9975)
    function _calcAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        require(amountIn > 0 && reserveIn > 0 && reserveOut > 0, "Invalid reserves");
        // Standard Uniswap V2 formula: 0.3% fee = 997/1000
        // MUST match the pair contract's K invariant check which uses 997.
        // Using 9975/10000 (0.25%) causes K violation: we claim more out than pair allows.
        uint256 amountInFee = amountIn * 997;
        return (amountInFee * reserveOut) / (reserveIn * 1000 + amountInFee);
    }

    /// @dev Return reserves ordered as (reserveIn, reserveOut) for a given tokenIn/tokenOut.
    function _getOrderedReserves(address tokenIn, PairInfo storage info)
        internal view returns (uint256 reserveIn, uint256 reserveOut)
    {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(info.pair).getReserves();
        address token0 = IUniswapV2Pair(info.pair).token0();
        return token0 == tokenIn ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    function _syncPair(address tokenA, address tokenB) private {
        PairInfo storage info = _pairInfo[tokenA][tokenB];
        if (info.pair == address(0)) return;
        try IUniswapV2Pair(info.pair).getReserves() returns (uint112 r0, uint112 r1, uint32 ts) {
            info.reserve0 = r0; info.reserve1 = r1; info.lastUpdate = ts;
            try IUniswapV2Pair(info.pair).totalSupply() returns (uint256 s) { info.liquidity = s; } catch {}
            emit PairSynced(tokenA, tokenB, r0, r1);
        } catch {}
    }

    function _calculateTVL() private view returns (uint256 total) {
        address[] memory tokens = _supportedTokens.values();
        for (uint i = 0; i < tokens.length; i++) total += _tokenBalances[tokens[i]];
    }

    function _getPairCountForToken(address token) private view returns (uint256 count) {
        address[] memory tokens = _supportedTokens.values();
        for (uint i = 0; i < tokens.length; i++)
            if (tokens[i] != token && _supportedPairs[token][tokens[i]]) count++;
    }

    // ─────────────────────────────────────────────
    // ILiquidityAdapter — swap
    // ─────────────────────────────────────────────

    /**
     * @notice Swap tokenIn → tokenOut directly via pair.swap() (no router).
     *
     * Flow:
     *   1. Pull amountIn from router (router set allowance before calling).
     *   2. Transfer amountIn to the pair contract.
     *   3. Compute expected output with AMM math using live reserves.
     *   4. Call pair.swap() — pair sends tokenOut to address(this).
     *   5. Take adapter fee, forward remainder to recipient.
     */
    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bytes calldata /*data*/
    ) external override nonReentrant returns (uint256 amountOut, uint256 feeAmount) {
        if (!_active) revert AdapterInactive();
        if (!_supportedPairs[tokenIn][tokenOut]) revert TokenNotSupported(tokenIn);
        require(recipient != address(0), "Invalid recipient");

        uint8 decimalsIn = _getTokenDecimals(tokenIn);
        uint256 amountIn18 = _to18Decimals(amountIn, decimalsIn);
        if (amountIn18 < _minSwapAmount || amountIn18 > _maxSwapAmount)
            revert InvalidAmount(amountIn18, _minSwapAmount, _maxSwapAmount);

        PairInfo storage info = _pairInfo[tokenIn][tokenOut];
        if (info.pair == address(0)) revert PairNotInitialized(tokenIn, tokenOut);

        // Read reserves BEFORE transferring — correct Uniswap V2 pattern.
        // pair.getReserves() returns stored reserves (pre-transfer).
        // After safeTransferFrom, pair balance > reserve, enabling the swap.
        (uint256 reserveIn, uint256 reserveOut) = _getOrderedReserves(tokenIn, info);
        amountOut = _calcAmountOut(amountIn, reserveIn, reserveOut);

        require(amountOut > 0, "Zero output");
        if (amountOut < amountOutMin) revert SlippageExceeded(amountOutMin, amountOut);

        // Transfer tokenIn to pair AFTER computing output
        IERC20(tokenIn).safeTransferFrom(msg.sender, info.pair, amountIn);

        address token0 = IUniswapV2Pair(info.pair).token0();
        uint256 amount0Out = (token0 == tokenOut) ? amountOut : 0;
        uint256 amount1Out = (token0 == tokenOut) ? 0 : amountOut;

        // Pair sends tokenOut to this adapter so we can deduct fee before forwarding
        IUniswapV2Pair(info.pair).swap(amount0Out, amount1Out, address(this), "");

        feeAmount = (amountOut * _feePercent) / FEE_DENOMINATOR;
        if (feeAmount > 0) IERC20(tokenOut).safeTransfer(_feeCollector, feeAmount);
        IERC20(tokenOut).safeTransfer(recipient, amountOut - feeAmount);

        _tokenBalances[tokenIn]  = IERC20(tokenIn).balanceOf(address(this));
        _tokenBalances[tokenOut] = IERC20(tokenOut).balanceOf(address(this));
        // NOTE: do NOT call _syncPair here — pair.sync() after every swap
        // updates reserves to current balances and breaks the K invariant
        // for subsequent swaps on this non-standard fork.

        emit SwapExecuted(address(this), tokenIn, tokenOut, amountIn, amountOut - feeAmount, feeAmount, recipient);
        return (amountOut - feeAmount, feeAmount);
    }

    // ─────────────────────────────────────────────
    // ILiquidityAdapter — quote
    // ─────────────────────────────────────────────

    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn)
        external view override
        returns (uint256 amountOut, uint24 feePercent, uint256 priceImpact)
    {
        if (!_supportedPairs[tokenIn][tokenOut]) revert TokenNotSupported(tokenIn);

        uint8 decimalsIn = _getTokenDecimals(tokenIn);
        uint256 amountIn18 = _to18Decimals(amountIn, decimalsIn);
        if (amountIn18 < _minSwapAmount || amountIn18 > _maxSwapAmount)
            revert InvalidAmount(amountIn18, _minSwapAmount, _maxSwapAmount);

        PairInfo storage info = _pairInfo[tokenIn][tokenOut];
        if (info.pair == address(0)) revert PairNotInitialized(tokenIn, tokenOut);

        (uint256 reserveIn, uint256 reserveOut) = _getOrderedReserves(tokenIn, info);
        amountOut = _calcAmountOut(amountIn, reserveIn, reserveOut);

        feePercent = _feePercent;

        uint256 idealOut = (reserveOut * amountIn) / (reserveIn + amountIn);
        priceImpact = (idealOut > amountOut && idealOut > 0)
            ? ((idealOut - amountOut) * FEE_DENOMINATOR) / idealOut
            : 0;
    }

    // ─────────────────────────────────────────────
    // Liquidity — direct pair.mint() / pair.burn()
    // ─────────────────────────────────────────────

    function addLiquidity(
        address tokenA, address tokenB,
        uint256 amountADesired, uint256 amountBDesired,
        uint256 amountAMin, uint256 amountBMin,
        address to
    ) external onlyRole(LIQUIDITY_PROVIDER) nonReentrant
      returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        if (!_supportedPairs[tokenA][tokenB]) revert PairNotInitialized(tokenA, tokenB);
        require(to != address(0), "Invalid to");

        PairInfo storage info = _pairInfo[tokenA][tokenB];
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountBDesired);

        (uint112 r0, uint112 r1,) = IUniswapV2Pair(info.pair).getReserves();
        address token0 = IUniswapV2Pair(info.pair).token0();
        uint256 rA = token0 == tokenA ? uint256(r0) : uint256(r1);
        uint256 rB = token0 == tokenA ? uint256(r1) : uint256(r0);

        if (rA == 0 && rB == 0) {
            amountA = amountADesired;
            amountB = amountBDesired;
        } else {
            uint256 optB = (amountADesired * rB) / rA;
            if (optB <= amountBDesired) {
                require(optB >= amountBMin, "Insufficient B");
                amountA = amountADesired; amountB = optB;
            } else {
                uint256 optA = (amountBDesired * rA) / rB;
                require(optA >= amountAMin, "Insufficient A");
                amountA = optA; amountB = amountBDesired;
            }
        }

        if (amountADesired > amountA) IERC20(tokenA).safeTransfer(msg.sender, amountADesired - amountA);
        if (amountBDesired > amountB) IERC20(tokenB).safeTransfer(msg.sender, amountBDesired - amountB);

        IERC20(tokenA).safeTransfer(info.pair, amountA);
        IERC20(tokenB).safeTransfer(info.pair, amountB);
        liquidity = IUniswapV2Pair(info.pair).mint(to);

        _pairLiquidity[tokenA][tokenB] += liquidity;
        _pairLiquidity[tokenB][tokenA] += liquidity;
        _tokenBalances[tokenA] = IERC20(tokenA).balanceOf(address(this));
        _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
        _syncPair(tokenA, tokenB);

        emit LiquidityProvided(msg.sender, tokenA, tokenB, amountA, amountB, liquidity);
    }

    function removeLiquidity(
        address tokenA, address tokenB,
        uint256 liquidity,
        uint256 amountAMin, uint256 amountBMin,
        address to
    ) external onlyRole(LIQUIDITY_PROVIDER) nonReentrant
      returns (uint256 amountA, uint256 amountB)
    {
        if (!_supportedPairs[tokenA][tokenB]) revert PairNotInitialized(tokenA, tokenB);
        require(to != address(0), "Invalid to");

        address pairAddr = _pairInfo[tokenA][tokenB].pair;
        IERC20(pairAddr).safeTransferFrom(msg.sender, pairAddr, liquidity);
        (uint256 out0, uint256 out1) = IUniswapV2Pair(pairAddr).burn(to);

        address token0 = IUniswapV2Pair(pairAddr).token0();
        (amountA, amountB) = token0 == tokenA ? (out0, out1) : (out1, out0);
        require(amountA >= amountAMin, "Insufficient A");
        require(amountB >= amountBMin, "Insufficient B");

        _pairLiquidity[tokenA][tokenB] -= liquidity;
        _pairLiquidity[tokenB][tokenA] -= liquidity;
        _tokenBalances[tokenA] = IERC20(tokenA).balanceOf(address(this));
        _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
        _syncPair(tokenA, tokenB);
    }

    function addLiquidity(address token, uint256 amount, bytes calldata data)
        external onlyRole(LIQUIDITY_PROVIDER)
    {
        (address tokenB, uint256 amountB,) = abi.decode(data, (address, uint256, uint256));
        PairInfo storage info = _pairInfo[token][tokenB];
        IERC20(token).safeTransferFrom(msg.sender, info.pair, amount);
        IERC20(tokenB).safeTransferFrom(msg.sender, info.pair, amountB);
        uint256 liq = IUniswapV2Pair(info.pair).mint(address(this));
        _pairLiquidity[token][tokenB] += liq;
        _pairLiquidity[tokenB][token] += liq;
        _tokenBalances[token]  = IERC20(token).balanceOf(address(this));
        _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
        _syncPair(token, tokenB);
        emit LiquidityAdded(token, amount, _tokenBalances[token]);
    }

    function removeLiquidity(address token, uint256 amount, bytes calldata data)
        external onlyRole(LIQUIDITY_PROVIDER)
    {
        (address tokenB, uint256 amountAMin, uint256 amountBMin) = abi.decode(data, (address, uint256, uint256));
        address pairAddr = _pairInfo[token][tokenB].pair;
        IUniswapV2Pair(pairAddr).transfer(pairAddr, amount);
        (uint256 out0, uint256 out1) = IUniswapV2Pair(pairAddr).burn(msg.sender);
        address token0 = IUniswapV2Pair(pairAddr).token0();
        (uint256 outA, uint256 outB) = token0 == token ? (out0, out1) : (out1, out0);
        require(outA >= amountAMin && outB >= amountBMin, "Slippage");
        _pairLiquidity[token][tokenB] -= amount;
        _pairLiquidity[tokenB][token] -= amount;
        _tokenBalances[token]  = IERC20(token).balanceOf(address(this));
        _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
        _syncPair(token, tokenB);
        emit LiquidityRemoved(token, amount, _tokenBalances[token]);
    }

    // ─────────────────────────────────────────────
    // Pair management
    // ─────────────────────────────────────────────

    function initializePair(address tokenA, address tokenB) external onlyRole(ADAPTER_ADMIN) {
        require(tokenA != tokenB, "Same token");
        require(!_supportedPairs[tokenA][tokenB], "Already supported");

        address pair = IUniswapV2Factory(_factory).getPair(tokenA, tokenB);
        if (pair == address(0)) pair = IUniswapV2Factory(_factory).createPair(tokenA, tokenB);
        require(pair != address(0), "Pair creation failed");

        _supportedPairs[tokenA][tokenB] = true;
        _supportedPairs[tokenB][tokenA] = true;
        _supportedTokens.add(tokenA);
        _supportedTokens.add(tokenB);

        uint112 r0; uint112 r1; uint32 ts; uint256 supply;
        try IUniswapV2Pair(pair).getReserves() returns (uint112 a, uint112 b, uint32 t) { r0=a; r1=b; ts=t; } catch {}
        try IUniswapV2Pair(pair).totalSupply() returns (uint256 s) { supply=s; } catch {}

        PairInfo memory pInfo = PairInfo(pair, r0, r1, ts, 30, supply);
        _pairInfo[tokenA][tokenB] = pInfo;
        _pairInfo[tokenB][tokenA] = pInfo;
        _tokenBalances[tokenA] = IERC20(tokenA).balanceOf(address(this));
        _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
        _lastSync[tokenA] = block.timestamp;
        _lastSync[tokenB] = block.timestamp;

        emit PairInitialized(tokenA, tokenB, pair);
    }

    function removePair(address tokenA, address tokenB) external onlyRole(ADAPTER_ADMIN) {
        require(_supportedPairs[tokenA][tokenB], "Not supported");
        _supportedPairs[tokenA][tokenB] = false;
        _supportedPairs[tokenB][tokenA] = false;
        delete _pairInfo[tokenA][tokenB];
        delete _pairInfo[tokenB][tokenA];
        delete _pairLiquidity[tokenA][tokenB];
        delete _pairLiquidity[tokenB][tokenA];
        if (_getPairCountForToken(tokenA) == 0) _supportedTokens.remove(tokenA);
        if (_getPairCountForToken(tokenB) == 0) _supportedTokens.remove(tokenB);
    }

    // ─────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────

    function setFactory(address f) external onlyRole(ADAPTER_ADMIN) { require(f != address(0)); _factory = f; }
    function getFactory() external view returns (address) { return _factory; }

    function syncAllPairs() external onlyRole(ADAPTER_ADMIN) {
        address[] memory tokens = _supportedTokens.values();
        for (uint i = 0; i < tokens.length; i++)
            for (uint j = i+1; j < tokens.length; j++)
                if (_supportedPairs[tokens[i]][tokens[j]]) _syncPair(tokens[i], tokens[j]);
    }

    function syncPair(address a, address b) external onlyRole(ADAPTER_ADMIN) { _syncPair(a, b); }

    function skimPair(address a, address b, address to) external onlyRole(ADAPTER_ADMIN) {
        address p = _pairInfo[a][b].pair;
        if (p == address(0)) revert PairNotInitialized(a, b);
        try IUniswapV2Pair(p).skim(to) { _syncPair(a, b); } catch {}
    }

    function setFee(uint24 f) external onlyRole(FEE_MANAGER) { require(f <= MAX_FEE_PERCENT); _feePercent = f; }
    function setFeeCollector(address c) external onlyRole(FEE_MANAGER) {
        require(c != address(0)); address old = _feeCollector; _feeCollector = c;
        emit FeeCollectorUpdated(old, c);
    }
    function setSwapLimits(uint256 mn, uint256 mx) external onlyRole(ADAPTER_ADMIN) {
        require(mn < mx); _minSwapAmount = mn; _maxSwapAmount = mx;
    }
    function setActive(bool a) external onlyRole(ADAPTER_ADMIN) {
        _active = a;
        if (a) emit AdapterActivated(address(this)); else emit AdapterDeactivated(address(this));
    }
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0)); IERC20(token).safeTransfer(to, amount);
        _tokenBalances[token] = IERC20(token).balanceOf(address(this));
    }

    // ─────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────

    function getAdapterInfo() external view override returns (AdapterInfo memory) {
        return AdapterInfo(_name, address(this), _active, _calculateTVL(), _feePercent, _minSwapAmount, _maxSwapAmount, _supportedTokens.values());
    }
    function isTokenSupported(address token) external view override returns (bool) { return _supportedTokens.contains(token); }
    function getReserves(address token) external view override returns (uint256, uint256) { return (_tokenBalances[token], _lastSync[token]); }
    function getPairInfo(address a, address b) external view returns (address, uint112, uint112, uint24, uint256) {
        PairInfo storage i = _pairInfo[a][b]; return (i.pair, i.reserve0, i.reserve1, i.swapFee, i.liquidity);
    }

    function name()          external view returns (string memory) { return _name; }
    function getFee()        external view returns (uint24)  { return _feePercent; }
    function fee()           external view returns (uint24)  { return _feePercent; }
    function minSwapAmount() external view returns (uint256) { return _minSwapAmount; }
    function maxSwapAmount() external view returns (uint256) { return _maxSwapAmount; }
    function feeCollector()  external view returns (address) { return _feeCollector; }
    function isActive()      external view returns (bool)    { return _active; }
    function MAX_FEE()       external pure returns (uint24)  { return MAX_FEE_PERCENT; }
}
