// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
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
    
    function factory() external view returns (address);
    
    function WETH() external view returns (address);
    
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
    address private _router;
    address private _factory;
    address private _weth;
    uint24 private _feePercent; // Renamed from _fee to avoid conflict
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
    uint24 private constant MAX_FEE_PERCENT = 300; // Renamed from MAX_FEE (3%)
    uint256 private constant MINIMUM_LIQUIDITY = 1000;
    uint256 private constant SYNC_INTERVAL = 1 hours;

    event PairInitialized(address indexed tokenA, address indexed tokenB, address pair);
    event PairSynced(address indexed tokenA, address indexed tokenB, uint112 reserve0, uint112 reserve1);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event LiquidityProvided(address indexed provider, address indexed tokenA, address indexed tokenB, uint amountA, uint amountB, uint liquidity);

    error PairNotInitialized(address tokenA, address tokenB);
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
        require(router_ != address(0), "Invalid router address");
        require(feeCollector_ != address(0), "Invalid fee collector");
        require(fee_ <= MAX_FEE_PERCENT, "Fee too high");
        
        _name = name_;
        _router = router_;
        
        // Try to get factory and WETH addresses
        (bool successFactory, bytes memory factoryData) = router_.staticcall(
            abi.encodeWithSignature("factory()")
        );
        if (successFactory && factoryData.length >= 32) {
            _factory = abi.decode(factoryData, (address));
        }
        
        (bool successWeth, bytes memory wethData) = router_.staticcall(
            abi.encodeWithSignature("WETH()")
        );
        if (successWeth && wethData.length >= 32) {
            _weth = abi.decode(wethData, (address));
        }
        
        _feePercent = fee_;
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
    ) external override nonReentrant returns (uint256 amountOut, uint256 feeAmount) { // Renamed fee param
        if (!_active) revert AdapterInactive();
        if (!_supportedPairs[tokenIn][tokenOut]) revert TokenNotSupported(tokenIn);
        if (amountIn < _minSwapAmount || amountIn > _maxSwapAmount) 
            revert InvalidAmount(amountIn, _minSwapAmount, _maxSwapAmount);
        if (recipient == address(0)) revert("Invalid recipient");

        PairInfo storage pair = _pairInfo[tokenIn][tokenOut];
        if (pair.pair == address(0)) revert PairNotInitialized(tokenIn, tokenOut);

        _syncPairIfNeeded(tokenIn, tokenOut);

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(recipient);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).safeIncreaseAllowance(_router, amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint256 deadline = block.timestamp + 30 minutes;

        // Try the standard swap first
        try IUniswapV2Router(_router).swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            recipient,
            deadline
        ) returns (uint[] memory amounts) {
            amountOut = amounts[1];
        } catch {
            // Fall back to fee-on-transfer version
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

        feeAmount = (amountOut * _feePercent) / FEE_DENOMINATOR;
        
        if (feeAmount > 0) {
            IERC20(tokenOut).safeTransferFrom(recipient, _feeCollector, feeAmount);
        }

        _tokenBalances[tokenIn] = IERC20(tokenIn).balanceOf(address(this));
        _tokenBalances[tokenOut] = IERC20(tokenOut).balanceOf(address(this));
        
        _syncPair(tokenIn, tokenOut);

        emit SwapExecuted(address(this), tokenIn, tokenOut, amountIn, amountOut, feeAmount, recipient);

        return (amountOut, feeAmount);
    }

    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view override returns (uint256 amountOut, uint24 feePercent, uint256 priceImpact) {
        if (!_supportedPairs[tokenIn][tokenOut]) revert TokenNotSupported(tokenIn);
        if (amountIn < _minSwapAmount || amountIn > _maxSwapAmount) 
            revert InvalidAmount(amountIn, _minSwapAmount, _maxSwapAmount);

        PairInfo storage pair = _pairInfo[tokenIn][tokenOut];
        if (pair.pair == address(0)) revert PairNotInitialized(tokenIn, tokenOut);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        try IUniswapV2Router(_router).getAmountsOut(amountIn, path) returns (uint[] memory amounts) {
            amountOut = amounts[1];
        } catch {
            // If getAmountsOut fails, calculate using reserves
            (uint112 reserveInLocal, uint112 reserveOutLocal) = _getReserves(tokenIn, tokenOut, pair);
            amountOut = _getAmountOut(amountIn, reserveInLocal, reserveOutLocal);
        }
        
        feePercent = _feePercent;

        (uint112 reserveInCalc, uint112 reserveOutCalc) = _getReserves(tokenIn, tokenOut, pair);
        
        uint256 expectedOut = _getAmountOut(amountIn, reserveInCalc, reserveOutCalc);
        
        if (expectedOut > amountOut && expectedOut > 0) {
            priceImpact = ((expectedOut - amountOut) * FEE_DENOMINATOR) / expectedOut;
        } else {
            priceImpact = 0;
        }

        return (amountOut, feePercent, priceImpact);
    }

    function _getAmountOut(
        uint256 amountIn,
        uint112 reserveIn,
        uint112 reserveOut
    ) private pure returns (uint256) {
        if (reserveIn == 0 || reserveOut == 0) return 0;
        
        uint256 amountInWithFee = amountIn * 9975;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * FEE_DENOMINATOR) + amountInWithFee;
        return numerator / denominator;
    }

    function getAdapterInfo() external view override returns (AdapterInfo memory) {
        address[] memory tokens = _supportedTokens.values();
        uint256 tvl = _calculateTVL();
        
        return AdapterInfo({
            name: _name,
            adapterAddress: address(this),
            isActive: _active,
            tvl: tvl,
            fee: _feePercent,
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

        try IUniswapV2Router(_router).getAmountsIn(amountOut, path) returns (uint[] memory amounts) {
            return amounts[0];
        } catch {
            return 0;
        }
    }

    function _getReserves(
        address tokenA, 
        address tokenB, 
        PairInfo storage pair
    ) private view returns (uint112 reserveIn, uint112 reserveOut) {
        if (pair.pair == address(0)) return (0, 0);
        
        try IUniswapV2Pair(pair.pair).token0() returns (address token0) {
            if (token0 == tokenA) {
                return (pair.reserve0, pair.reserve1);
            } else {
                return (pair.reserve1, pair.reserve0);
            }
        } catch {
            return (0, 0);
        }
    }

    function _syncPairIfNeeded(address tokenA, address tokenB) private {
        PairInfo storage pair = _pairInfo[tokenA][tokenB];
        if (pair.pair != address(0) && block.timestamp >= pair.lastUpdate + SYNC_INTERVAL) {
            _syncPair(tokenA, tokenB);
        }
    }

    function _syncPair(address tokenA, address tokenB) private {
        PairInfo storage pair = _pairInfo[tokenA][tokenB];
        if (pair.pair == address(0)) return;
        
        try IUniswapV2Pair(pair.pair).getReserves() returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
            pair.reserve0 = reserve0;
            pair.reserve1 = reserve1;
            pair.lastUpdate = blockTimestampLast;
            
            try IUniswapV2Pair(pair.pair).totalSupply() returns (uint256 totalSupply) {
                pair.liquidity = totalSupply;
            } catch {
                // Keep existing liquidity
            }
            
            emit PairSynced(tokenA, tokenB, reserve0, reserve1);
        } catch {
            // Silently fail if pair doesn't exist or call fails
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

        address pair = address(0);
        
        if (_factory != address(0)) {
            try IUniswapV2Factory(_factory).getPair(tokenA, tokenB) returns (address existingPair) {
                pair = existingPair;
            } catch {
                // Factory call failed
            }
            
            if (pair == address(0)) {
                try IUniswapV2Factory(_factory).createPair(tokenA, tokenB) returns (address newPair) {
                    pair = newPair;
                } catch {
                    // Creation failed
                }
            }
        }

        _supportedPairs[tokenA][tokenB] = true;
        _supportedPairs[tokenB][tokenA] = true;
        
        _supportedTokens.add(tokenA);
        _supportedTokens.add(tokenB);

        uint112 reserve0 = 0;
        uint112 reserve1 = 0;
        uint32 blockTimestampLast = uint32(block.timestamp);
        uint256 totalSupply = 0;

        if (pair != address(0)) {
            try IUniswapV2Pair(pair).getReserves() returns (uint112 r0, uint112 r1, uint32 ts) {
                reserve0 = r0;
                reserve1 = r1;
                blockTimestampLast = ts;
            } catch {}
            
            try IUniswapV2Pair(pair).totalSupply() returns (uint256 supply) {
                totalSupply = supply;
            } catch {}
        }
        
        _pairInfo[tokenA][tokenB] = PairInfo({
            pair: pair,
            reserve0: reserve0,
            reserve1: reserve1,
            lastUpdate: blockTimestampLast,
            swapFee: 30,
            liquidity: totalSupply
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

        try IUniswapV2Router(_router).addLiquidity(
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            to,
            block.timestamp + 30 minutes
        ) returns (uint256 a, uint256 b, uint256 liq) {
            amountA = a;
            amountB = b;
            liquidity = liq;
        } catch {
            revert("Add liquidity failed");
        }

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
        if (pair == address(0)) revert PairNotInitialized(tokenA, tokenB);
        
        IERC20(pair).safeTransferFrom(msg.sender, address(this), liquidity);
        IERC20(pair).safeIncreaseAllowance(_router, liquidity);

        try IUniswapV2Router(_router).removeLiquidity(
            tokenA,
            tokenB,
            liquidity,
            amountAMin,
            amountBMin,
            to,
            block.timestamp + 30 minutes
        ) returns (uint256 a, uint256 b) {
            amountA = a;
            amountB = b;
        } catch {
            revert("Remove liquidity failed");
        }

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
    ) external onlyRole(LIQUIDITY_PROVIDER) {
        (address tokenB, uint256 amountBDesired, uint256 amountAMin) = abi.decode(data, (address, uint256, uint256));
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        IERC20(token).safeIncreaseAllowance(_router, amount);
        IERC20(tokenB).safeIncreaseAllowance(_router, amountBDesired);

        try IUniswapV2Router(_router).addLiquidity(
            token,
            tokenB,
            amount,
            amountBDesired,
            amountAMin,
            amountBDesired,
            address(this),
            block.timestamp + 30 minutes
        ) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
            _pairLiquidity[token][tokenB] += liquidity;
            _pairLiquidity[tokenB][token] += liquidity;
            
            _tokenBalances[token] = IERC20(token).balanceOf(address(this));
            _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
            
            _syncPair(token, tokenB);

            emit LiquidityAdded(token, amount, _tokenBalances[token]);
            emit LiquidityProvided(msg.sender, token, tokenB, amountA, amountB, liquidity);
        } catch {
            revert("Add liquidity failed");
        }
    }

    function removeLiquidity(
        address token,
        uint256 amount,
        bytes calldata data
    ) external onlyRole(LIQUIDITY_PROVIDER) {
        (address tokenB, uint256 amountAMin, uint256 amountBMin) = abi.decode(data, (address, uint256, uint256));
        
        address pair = _pairInfo[token][tokenB].pair;
        if (pair == address(0)) revert PairNotInitialized(token, tokenB);
        
        uint256 pairBalance = IERC20(pair).balanceOf(address(this));
        
        if (pairBalance < amount) revert InsufficientLiquidity(pairBalance, amount);

        IERC20(pair).safeIncreaseAllowance(_router, amount);

        try IUniswapV2Router(_router).removeLiquidity(
            token,
            tokenB,
            amount,
            amountAMin,
            amountBMin,
            msg.sender,
            block.timestamp + 30 minutes
        ) returns (uint256 amountA, uint256 amountB) {
            _pairLiquidity[token][tokenB] -= amount;
            _pairLiquidity[tokenB][token] -= amount;
            
            _tokenBalances[token] = IERC20(token).balanceOf(address(this));
            _tokenBalances[tokenB] = IERC20(tokenB).balanceOf(address(this));
            
            _syncPair(token, tokenB);

            emit LiquidityRemoved(token, amount, _tokenBalances[token]);
        } catch {
            revert("Remove liquidity failed");
        }
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
        if (newFee > MAX_FEE_PERCENT) revert("Fee too high");
        _feePercent = newFee;
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
        
        try IUniswapV2Pair(pair).skim(to) {
            _syncPair(tokenA, tokenB);
        } catch {
            // Silently fail
        }
    }

    function syncPair(address tokenA, address tokenB) external onlyRole(ADAPTER_ADMIN) {
        _syncPair(tokenA, tokenB);
    }

    // View functions for testing
    function name() external view returns (string memory) {
        return _name;
    }

    function getFee() external view returns (uint24) {
        return _feePercent;
    }

    function minSwapAmount() external view returns (uint256) {
        return _minSwapAmount;
    }

    function maxSwapAmount() external view returns (uint256) {
        return _maxSwapAmount;
    }

    function fee() external view returns (uint24) {
        return _feePercent;
    }

    function feeCollector() external view returns (address) {
        return _feeCollector;
    }

    function isActive() external view returns (bool) {
        return _active;
    }

    function MAX_FEE() external pure returns (uint24) {
        return MAX_FEE_PERCENT;
    }
}