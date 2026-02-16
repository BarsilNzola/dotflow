// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/ILiquidityAdapter.sol";

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
    
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
    
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
    
    function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts);
    
    function factory() external pure returns (address);
    
    function WETH() external pure returns (address);
    
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);
    
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB);
}

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function balanceOf(address owner) external view returns (uint);
    function totalSupply() external view returns (uint);
    function skim(address to) external;
    function sync() external;
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function allPairs(uint) external view returns (address pair);
    function allPairsLength() external view returns (uint);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

contract UniswapV2Adapter is ILiquidityAdapter, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant ADAPTER_ADMIN = keccak256("ADAPTER_ADMIN");
    bytes32 public constant LIQUIDITY_PROVIDER = keccak256("LIQUIDITY_PROVIDER");
    bytes32 public constant FEE_MANAGER = keccak256("FEE_MANAGER");

    struct PairInfo {
        address pair;
        uint112 reserve0;
        uint112 reserve1;
        uint32 lastUpdate;
        uint24 swapFee;
        uint256 liquidity;
    }

    string private _name;
    address private immutable _router;
    address private immutable _factory;
    address private immutable _weth;
    uint24 private _fee;
    uint256 private _minSwapAmount;
    uint256 private _maxSwapAmount;
    bool private _active;
    address private _feeCollector;

    EnumerableSet.AddressSet private _supportedTokens;
    mapping(address => mapping(address => PairInfo)) private _pairInfo;
    mapping(address => mapping(address => bool)) private _supportedPairs;
    mapping(address => uint256) private _tokenBalances;
    mapping(address => uint256) private _lastSync;
    mapping(address => mapping(address => uint256)) private _pairLiquidity;

    uint256 private constant FEE_DENOMINATOR = 10000;
    uint24 private constant MAX_FEE = 300; // 3%
    uint256 private constant MINIMUM_LIQUIDITY = 1000;
    uint256 private constant SYNC_INTERVAL = 1 hours;

    event PairInitialized(address indexed tokenA, address indexed tokenB, address pair);
    event PairSynced(address indexed tokenA, address indexed tokenB, uint112 reserve0, uint112 reserve1);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event LiquidityProvided(address indexed provider, address indexed tokenA, address indexed tokenB, uint amountA, uint amountB, uint liquidity);

    error PairNotInitialized(address tokenA, address tokenB);
    error InsufficientLiquidity(uint256 available, uint256 required);
    error SlippageExceeded(uint256 expected, uint256 actual);
    error InvalidPathLength(uint256 length);
    error DeadlineExpired(uint256 deadline, uint256 current);

    constructor(
        string memory name_,
        address router_,
        uint24 fee_,
        uint256 minSwapAmount_,
        uint256 maxSwapAmount_,
        address feeCollector_
    ) {
        _name = name_;
        _router = router_;
        _factory = IUniswapV2Router(router_).factory();
        _weth = IUniswapV2Router(router_).WETH();
        _fee = fee_;
        _minSwapAmount = minSwapAmount_;
        _maxSwapAmount = maxSwapAmount_;
        _feeCollector = feeCollector_;
        _active = true;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADAPTER_ADMIN, msg.sender);
        _grantRole(FEE_MANAGER, msg.sender);
    }

    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bytes calldata data
    ) external override nonReentrant returns (uint256 amountOut, uint256 fee) {
        if (!_active) revert AdapterInactive();
        if (!_supportedPairs[tokenIn][tokenOut]) revert TokenNotSupported(tokenIn);
        if (amountIn < _minSwapAmount || amountIn > _maxSwapAmount) 
            revert InvalidAmount(amountIn, _minSwapAmount, _maxSwapAmount);
        if (recipient == address(0)) revert("Invalid recipient");

        PairInfo storage pair = _pairInfo[tokenIn][tokenOut];
        if (pair.pair == address(0)) revert PairNotInitialized(tokenIn, tokenOut);

        _syncPairIfNeeded(tokenIn, tokenOut);

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).safeIncreaseAllowance(_router, amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint256 deadline = block.timestamp + 30 minutes;

        try IUniswapV2Router(_router).swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            recipient,
            deadline
        ) returns (uint[] memory amounts) {
            amountOut = amounts[1];
        } catch {
            IUniswapV2Router(_router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amountIn,
                amountOutMin,
                path,
                recipient,
                deadline
            );
            
            uint256 balanceAfter = IERC20(tokenOut).balanceOf(recipient);
            amountOut = balanceAfter - balanceBefore;
        }

        if (amountOut < amountOutMin) revert SlippageExceeded(amountOutMin, amountOut);

        fee = (amountOut * _fee) / FEE_DENOMINATOR;
        
        if (fee > 0) {
            IERC20(tokenOut).safeTransferFrom(recipient, _feeCollector, fee);
        }

        _tokenBalances[tokenIn] = IERC20(tokenIn).balanceOf(address(this));
        _tokenBalances[tokenOut] = IERC20(tokenOut).balanceOf(address(this));
        
        _syncPair(tokenIn, tokenOut);

        emit SwapExecuted(address(this), tokenIn, tokenOut, amountIn, amountOut, fee, recipient);

        return (amountOut, fee);
    }

    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view override returns (uint256 amountOut, uint24 fee, uint256 priceImpact) {
        if (!_supportedPairs[tokenIn][tokenOut]) revert TokenNotSupported(tokenIn);
        if (amountIn < _minSwapAmount || amountIn > _maxSwapAmount) 
            revert InvalidAmount(amountIn, _minSwapAmount, _maxSwapAmount);

        PairInfo storage pair = _pairInfo[tokenIn][tokenOut];
        if (pair.pair == address(0)) revert PairNotInitialized(tokenIn, tokenOut);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint[] memory amounts = IUniswapV2Router(_router).getAmountsOut(amountIn, path);
        amountOut = amounts[1];
        fee = _fee;

        (uint112 reserveIn, uint112 reserveOut) = _getReserves(tokenIn, tokenOut, pair);
        
        uint256 amountInWithFee = amountIn * 9975;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
        uint256 expectedOut = numerator / denominator;
        
        if (expectedOut > amountOut) {
            priceImpact = ((expectedOut - amountOut) * FEE_DENOMINATOR) / expectedOut;
        } else {
            priceImpact = 0;
        }

        return (amountOut, fee, priceImpact);
    }

    function getAdapterInfo() external view override returns (AdapterInfo memory) {
        address[] memory tokens = _supportedTokens.values();
        uint256 tvl = _calculateTVL();
        
        return AdapterInfo({
            name: _name,
            adapterAddress: address(this),
            isActive: _active,
            tvl: tvl,
            fee: _fee,
            minSwapAmount: _minSwapAmount,
            maxSwapAmount: _maxSwapAmount,
            supportedTokens: tokens
        });
    }

    function isTokenSupported(address token) external view override returns (bool) {
        return _supportedTokens.contains(token);
    }

    function getReserves(address token) external view override returns (uint256 reserve, uint256 lastUpdate) {
        return (_tokenBalances[token], _lastSync[token]);
    }

    function getPairInfo(address tokenA, address tokenB) external view returns (
        address pair,
        uint112 reserve0,
        uint112 reserve1,
        uint24 swapFee,
        uint256 liquidity
    ) {
        PairInfo storage info = _pairInfo[tokenA][tokenB];
        return (info.pair, info.reserve0, info.reserve1, info.swapFee, info.liquidity);
    }

    function getAmountsIn(
        uint256 amountOut,
        address tokenIn,
        address tokenOut
    ) external view returns (uint256 amountIn) {
        if (!_supportedPairs[tokenIn][tokenOut]) revert TokenNotSupported(tokenIn);
        
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint[] memory amounts = IUniswapV2Router(_router).getAmountsIn(amountOut, path);
        return amounts[0];
    }

    function _getReserves(
        address tokenA, 
        address tokenB, 
        PairInfo storage pair
    ) private view returns (uint112 reserveIn, uint112 reserveOut) {
        if (IUniswapV2Pair(pair.pair).token0() == tokenA) {
            return (pair.reserve0, pair.reserve1);
        } else {
            return (pair.reserve1, pair.reserve0);
        }
    }

    function _syncPairIfNeeded(address tokenA, address tokenB) private {
        PairInfo storage pair = _pairInfo[tokenA][tokenB];
        if (block.timestamp >= pair.lastUpdate + SYNC_INTERVAL) {
            _syncPair(tokenA, tokenB);
        }
    }

    function _syncPair(address tokenA, address tokenB) private {
        PairInfo storage pair = _pairInfo[tokenA][tokenB];
        
        try IUniswapV2Pair(pair.pair).getReserves() returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
            pair.reserve0 = reserve0;
            pair.reserve1 = reserve1;
            pair.lastUpdate = blockTimestampLast;
            
            pair.liquidity = IUniswapV2Pair(pair.pair).totalSupply();
            
            emit PairSynced(tokenA, tokenB, reserve0, reserve1);
        } catch {
            revert("Failed to sync pair");
        }
    }

    function _calculateTVL() private view returns (uint256) {
        uint256 totalValue = 0;
        address[] memory tokens = _supportedTokens.values();

        for (uint i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 balance = _tokenBalances[token];
            
            if (balance > 0) {
                totalValue += balance;
            }
        }

        return totalValue;
    }

    function initializePair(address tokenA, address tokenB) external onlyRole(ADAPTER_ADMIN) {
        if (tokenA == tokenB) revert("Same token");
        if (_supportedPairs[tokenA][tokenB]) revert("Pair already supported");

        address pair = IUniswapV2Factory(_factory).getPair(tokenA, tokenB);
        
        if (pair == address(0)) {
            pair = IUniswapV2Factory(_factory).createPair(tokenA, tokenB);
        }

        _supportedPairs[tokenA][tokenB] = true;
        _supportedPairs[tokenB][tokenA] = true;
        
        _supportedTokens.add(tokenA);
        _supportedTokens.add(tokenB);

        (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) = IUniswapV2Pair(pair).getReserves();
        
        _pairInfo[tokenA][tokenB] = PairInfo({
            pair: pair,
            reserve0: reserve0,
            reserve1: reserve1,
            lastUpdate: blockTimestampLast,
            swapFee: 30, // 0.3% for Uniswap V2
            liquidity: IUniswapV2Pair(pair).totalSupply()
        });

        _pairInfo[tokenB][tokenA] = _pairInfo[tokenA][tokenB];

        _tokenBalances[tokenA] = IERC20(tokenA).balanceOf(address(this));
        _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
        _lastSync[tokenA] = block.timestamp;
        _lastSync[tokenB] = block.timestamp;

        emit PairInitialized(tokenA, tokenB, pair);
    }

    function removePair(address tokenA, address tokenB) external onlyRole(ADAPTER_ADMIN) {
        if (!_supportedPairs[tokenA][tokenB]) revert("Pair not supported");

        _supportedPairs[tokenA][tokenB] = false;
        _supportedPairs[tokenB][tokenA] = false;
        
        delete _pairInfo[tokenA][tokenB];
        delete _pairInfo[tokenB][tokenA];
        delete _pairLiquidity[tokenA][tokenB];
        delete _pairLiquidity[tokenB][tokenA];

        if (_getPairCountForToken(tokenA) == 0) {
            _supportedTokens.remove(tokenA);
        }
        
        if (_getPairCountForToken(tokenB) == 0) {
            _supportedTokens.remove(tokenB);
        }
    }

    function _getPairCountForToken(address token) private view returns (uint256 count) {
        address[] memory tokens = _supportedTokens.values();
        
        for (uint i = 0; i < tokens.length; i++) {
            if (tokens[i] != token && _supportedPairs[token][tokens[i]]) {
                count++;
            }
        }
        
        return count;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to
    ) external onlyRole(LIQUIDITY_PROVIDER) nonReentrant returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (!_supportedPairs[tokenA][tokenB]) revert PairNotInitialized(tokenA, tokenB);
        if (to == address(0)) revert("Invalid recipient");

        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountBDesired);

        IERC20(tokenA).safeIncreaseAllowance(_router, amountADesired);
        IERC20(tokenB).safeIncreaseAllowance(_router, amountBDesired);

        (amountA, amountB, liquidity) = IUniswapV2Router(_router).addLiquidity(
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            to,
            block.timestamp + 30 minutes
        );

        _pairLiquidity[tokenA][tokenB] += liquidity;
        _pairLiquidity[tokenB][tokenA] += liquidity;
        
        _tokenBalances[tokenA] = IERC20(tokenA).balanceOf(address(this));
        _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
        
        _syncPair(tokenA, tokenB);

        emit LiquidityProvided(msg.sender, tokenA, tokenB, amountA, amountB, liquidity);

        return (amountA, amountB, liquidity);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to
    ) external onlyRole(LIQUIDITY_PROVIDER) nonReentrant returns (uint256 amountA, uint256 amountB) {
        if (!_supportedPairs[tokenA][tokenB]) revert PairNotInitialized(tokenA, tokenB);
        if (to == address(0)) revert("Invalid recipient");
        if (_pairLiquidity[tokenA][tokenB] < liquidity) revert InsufficientLiquidity(_pairLiquidity[tokenA][tokenB], liquidity);

        address pair = _pairInfo[tokenA][tokenB].pair;
        
        IERC20(pair).safeTransferFrom(msg.sender, address(this), liquidity);
        IERC20(pair).safeIncreaseAllowance(_router, liquidity);

        (amountA, amountB) = IUniswapV2Router(_router).removeLiquidity(
            tokenA,
            tokenB,
            liquidity,
            amountAMin,
            amountBMin,
            to,
            block.timestamp + 30 minutes
        );

        _pairLiquidity[tokenA][tokenB] -= liquidity;
        _pairLiquidity[tokenB][tokenA] -= liquidity;
        
        _tokenBalances[tokenA] = IERC20(tokenA).balanceOf(address(this));
        _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
        
        _syncPair(tokenA, tokenB);

        return (amountA, amountB);
    }

    function addLiquidity(
        address token,
        uint256 amount,
        bytes calldata data
    ) external override onlyRole(LIQUIDITY_PROVIDER) {
        (address tokenB, uint256 amountBMin, uint256 amountAMin) = abi.decode(data, (address, uint256, uint256));
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        IERC20(token).safeIncreaseAllowance(_router, amount);
        IERC20(tokenB).safeIncreaseAllowance(_router, amountBMin);

        (uint256 amountA, uint256 amountB, uint256 liquidity) = IUniswapV2Router(_router).addLiquidity(
            token,
            tokenB,
            amount,
            amountBMin,
            amountAMin,
            amountBMin,
            address(this),
            block.timestamp + 30 minutes
        );

        _pairLiquidity[token][tokenB] += liquidity;
        _pairLiquidity[tokenB][token] += liquidity;
        
        _tokenBalances[token] = IERC20(token).balanceOf(address(this));
        _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
        
        _syncPair(token, tokenB);

        emit LiquidityAdded(token, amount, _tokenBalances[token]);
        emit LiquidityProvided(msg.sender, token, tokenB, amountA, amountB, liquidity);
    }

    function removeLiquidity(
        address token,
        uint256 amount,
        bytes calldata data
    ) external override onlyRole(LIQUIDITY_PROVIDER) {
        (address tokenB, uint256 amountAMin, uint256 amountBMin) = abi.decode(data, (address, uint256, uint256));
        
        address pair = _pairInfo[token][tokenB].pair;
        uint256 pairBalance = IERC20(pair).balanceOf(address(this));
        
        if (pairBalance < amount) revert InsufficientLiquidity(pairBalance, amount);

        IERC20(pair).safeIncreaseAllowance(_router, amount);

        (uint256 amountA, uint256 amountB) = IUniswapV2Router(_router).removeLiquidity(
            token,
            tokenB,
            amount,
            amountAMin,
            amountBMin,
            msg.sender,
            block.timestamp + 30 minutes
        );

        _pairLiquidity[token][tokenB] -= amount;
        _pairLiquidity[tokenB][token] -= amount;
        
        _tokenBalances[token] = IERC20(token).balanceOf(address(this));
        _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
        
        _syncPair(token, tokenB);

        emit LiquidityRemoved(token, amount, _tokenBalances[token]);
    }

    function syncAllPairs() external onlyRole(ADAPTER_ADMIN) {
        address[] memory tokens = _supportedTokens.values();
        
        for (uint i = 0; i < tokens.length; i++) {
            for (uint j = i + 1; j < tokens.length; j++) {
                if (_supportedPairs[tokens[i]][tokens[j]]) {
                    _syncPair(tokens[i], tokens[j]);
                }
            }
        }
    }

    function setFee(uint24 newFee) external onlyRole(FEE_MANAGER) {
        if (newFee > MAX_FEE) revert("Fee too high");
        _fee = newFee;
    }

    function setFeeCollector(address newCollector) external onlyRole(FEE_MANAGER) {
        if (newCollector == address(0)) revert("Invalid address");
        address oldCollector = _feeCollector;
        _feeCollector = newCollector;
        emit FeeCollectorUpdated(oldCollector, newCollector);
    }

    function setSwapLimits(uint256 minAmount, uint256 maxAmount) external onlyRole(ADAPTER_ADMIN) {
        if (minAmount >= maxAmount) revert("Invalid limits");
        _minSwapAmount = minAmount;
        _maxSwapAmount = maxAmount;
    }

    function setActive(bool active) external onlyRole(ADAPTER_ADMIN) {
        _active = active;
        if (active) {
            emit AdapterActivated(address(this));
        } else {
            emit AdapterDeactivated(address(this));
        }
    }

    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert("Invalid recipient");
        IERC20(token).safeTransfer(to, amount);
        _tokenBalances[token] = IERC20(token).balanceOf(address(this));
    }

    function skimPair(address tokenA, address tokenB, address to) external onlyRole(ADAPTER_ADMIN) {
        address pair = _pairInfo[tokenA][tokenB].pair;
        if (pair == address(0)) revert PairNotInitialized(tokenA, tokenB);
        
        IUniswapV2Pair(pair).skim(to);
        _syncPair(tokenA, tokenB);
    }

    function syncPair(address tokenA, address tokenB) external onlyRole(ADAPTER_ADMIN) {
        _syncPair(tokenA, tokenB);
    }
}