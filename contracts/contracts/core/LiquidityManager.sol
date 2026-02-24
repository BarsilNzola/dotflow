// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract LiquidityManager is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant POOL_MANAGER = keccak256("POOL_MANAGER");
    bytes32 public constant LIQUIDITY_PROVIDER = keccak256("LIQUIDITY_PROVIDER");

    struct Pool {
        address token;
        uint256 totalLiquidity;
        uint256 availableLiquidity;
        uint256 borrowedLiquidity;
        uint24 utilizationRate;
        uint24 feeRate;
        uint256 reserveFactor;
        uint256 minLiquidity;
        uint256 maxLiquidity;
        uint256 lastUpdate;
        bool isActive;
    }

    struct ProviderPosition {
        uint256 shares;
        uint256 entryTimestamp;
        uint256 lastDeposit;
        uint256 lastWithdraw;
        uint256 accruedFees;
        uint256 feeDebt;
        uint256 lastFeeUpdate;
    }

    struct PoolMetadata {
        string name;
        string symbol;
        uint8 decimals;
        uint256 createdAt;
        address creator;
    }

    uint256 private constant RATE_PRECISION = 10000;
    uint256 private constant MAX_FEE_RATE = 1000; // 10%
    uint256 private constant MIN_LIQUIDITY_LOCK = 1 days;
    uint256 private constant MAX_UTILIZATION = 9500; // 95%
    uint256 private constant RESERVE_FACTOR_MAX = 2000; // 20%
    uint256 private constant FEE_PRECISION = 1e18;

    mapping(address => Pool) private _pools;
    mapping(address => mapping(address => ProviderPosition)) private _positions;
    mapping(address => PoolMetadata) private _poolMetadata;
    mapping(address => EnumerableSet.AddressSet) private _poolProviders;
    
    EnumerableSet.AddressSet private _activePools;
    
    uint256 private _totalValueLocked;
    uint256 private _totalBorrowed;

    error PoolAlreadyExists(address token);
    error PoolNotActive(address token);
    error InsufficientLiquidity(uint256 available, uint256 requested);
    error InsufficientShares(uint256 has, uint256 requested);
    error LockTimeNotMet(uint256 required, uint256 current);
    error FeeRateTooHigh(uint24 provided, uint24 max);
    error UtilizationTooHigh(uint256 current, uint256 max);
    error InvalidAmount(uint256 amount);
    error InvalidAddress();
    error ReserveFactorTooHigh(uint256 provided, uint256 max);
    error InvalidLiquidityBounds();

    event PoolCreated(
        address indexed token,
        string name,
        string symbol,
        uint256 initialLiquidity,
        uint24 feeRate,
        address creator
    );

    event LiquidityAdded(
        address indexed provider,
        address indexed token,
        uint256 amount,
        uint256 shares,
        uint256 totalLiquidity
    );

    event LiquidityRemoved(
        address indexed provider,
        address indexed token,
        uint256 amount,
        uint256 shares,
        uint256 fee
    );

    event LiquidityBorrowed(
        address indexed borrower,
        address indexed token,
        uint256 amount,
        uint256 newUtilization
    );

    event LiquidityRepaid(
        address indexed borrower,
        address indexed token,
        uint256 amount,
        uint256 newUtilization
    );

    event FeesClaimed(
        address indexed provider,
        address indexed token,
        uint256 amount
    );

    event PoolUpdated(
        address indexed token,
        uint24 feeRate,
        uint256 reserveFactor,
        uint256 maxLiquidity
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(POOL_MANAGER, msg.sender);
    }

    function createPool(
        address token,
        string calldata name,
        string calldata symbol,
        uint256 initialLiquidity,
        uint24 feeRate,
        uint256 reserveFactor,
        uint256 minLiquidity,
        uint256 maxLiquidity
    ) external onlyRole(POOL_MANAGER) returns (address poolAddress) {
        if (token == address(0)) revert InvalidAddress();
        if (_pools[token].isActive) revert PoolAlreadyExists(token);
        if (feeRate > MAX_FEE_RATE) revert FeeRateTooHigh(feeRate, uint24(MAX_FEE_RATE));
        if (reserveFactor > RESERVE_FACTOR_MAX) revert ReserveFactorTooHigh(reserveFactor, RESERVE_FACTOR_MAX);
        if (maxLiquidity <= minLiquidity) revert InvalidLiquidityBounds();
        if (initialLiquidity > 0 && initialLiquidity < minLiquidity) revert("Initial below min");

        Pool storage pool = _pools[token];
        pool.token = token;
        pool.totalLiquidity = initialLiquidity;
        pool.availableLiquidity = initialLiquidity;
        pool.borrowedLiquidity = 0;
        pool.utilizationRate = 0;
        pool.feeRate = feeRate;
        pool.reserveFactor = reserveFactor;
        pool.minLiquidity = minLiquidity;
        pool.maxLiquidity = maxLiquidity;
        pool.lastUpdate = block.timestamp;
        pool.isActive = true;

        _poolMetadata[token] = PoolMetadata({
            name: name,
            symbol: symbol,
            decimals: _getTokenDecimals(token),
            createdAt: block.timestamp,
            creator: msg.sender
        });

        _activePools.add(token);

        if (initialLiquidity > 0) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), initialLiquidity);
            
            ProviderPosition storage position = _positions[msg.sender][token];
            position.shares = initialLiquidity;
            position.entryTimestamp = block.timestamp;
            position.lastDeposit = block.timestamp;
            position.lastFeeUpdate = block.timestamp;
            
            _poolProviders[token].add(msg.sender);
            
            _totalValueLocked += initialLiquidity;
        }

        emit PoolCreated(token, name, symbol, initialLiquidity, feeRate, msg.sender);

        return token;
    }

    function addLiquidity(
        address token,
        uint256 amount
    ) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert InvalidAmount(amount);
        
        Pool storage pool = _pools[token];
        if (!pool.isActive) revert PoolNotActive(token);
        if (pool.totalLiquidity + amount > pool.maxLiquidity) revert("Max liquidity exceeded");

        ProviderPosition storage position = _positions[msg.sender][token];

        // Update pending fees before adding liquidity
        _updatePendingFees(msg.sender, token);

        shares = amount; // 1:1 share ratio for simplicity
        
        if (position.shares == 0) {
            position.entryTimestamp = block.timestamp;
            _poolProviders[token].add(msg.sender);
        }

        position.shares += shares;
        position.lastDeposit = block.timestamp;
        position.lastFeeUpdate = block.timestamp;

        pool.totalLiquidity += amount;
        pool.availableLiquidity += amount;
        pool.lastUpdate = block.timestamp;

        _updateUtilization(pool);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        _totalValueLocked += amount;

        emit LiquidityAdded(msg.sender, token, amount, shares, pool.totalLiquidity);

        return shares;
    }

    function removeLiquidity(
        address token,
        uint256 shares
    ) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert InvalidAmount(shares);

        Pool storage pool = _pools[token];
        if (!pool.isActive) revert PoolNotActive(token);

        ProviderPosition storage position = _positions[msg.sender][token];
        if (position.shares < shares) revert InsufficientShares(position.shares, shares);

        if (block.timestamp < position.entryTimestamp + MIN_LIQUIDITY_LOCK) {
            revert LockTimeNotMet(position.entryTimestamp + MIN_LIQUIDITY_LOCK, block.timestamp);
        }

        // Update pending fees before removing liquidity
        _updatePendingFees(msg.sender, token);

        amount = shares; // 1:1 ratio since shares = amount
        
        if (pool.availableLiquidity < amount) {
            revert InsufficientLiquidity(pool.availableLiquidity, amount);
        }

        uint256 fee = (amount * pool.feeRate) / RATE_PRECISION;
        uint256 amountAfterFee = amount - fee;

        position.shares -= shares;
        position.lastWithdraw = block.timestamp;
        position.lastFeeUpdate = block.timestamp;

        if (position.shares == 0) {
            _poolProviders[token].remove(msg.sender);
        }

        pool.totalLiquidity -= amount;
        pool.availableLiquidity -= amount;
        pool.lastUpdate = block.timestamp;

        _updateUtilization(pool);

        if (fee > 0) {
            IERC20(token).safeTransfer(_poolMetadata[token].creator, fee);
        }

        IERC20(token).safeTransfer(msg.sender, amountAfterFee);
        
        _totalValueLocked -= amount;

        emit LiquidityRemoved(msg.sender, token, amountAfterFee, shares, fee);

        return amountAfterFee;
    }

    function borrowLiquidity(
        address token,
        uint256 amount,
        address recipient
    ) external onlyRole(LIQUIDITY_PROVIDER) nonReentrant returns (bool) {
        if (amount == 0) revert InvalidAmount(amount);
        if (recipient == address(0)) revert InvalidAddress();

        Pool storage pool = _pools[token];
        if (!pool.isActive) revert PoolNotActive(token);

        if (pool.availableLiquidity < amount) {
            revert InsufficientLiquidity(pool.availableLiquidity, amount);
        }

        pool.availableLiquidity -= amount;
        pool.borrowedLiquidity += amount;
        pool.lastUpdate = block.timestamp;

        _updateUtilization(pool);

        IERC20(token).safeTransfer(recipient, amount);
        
        _totalBorrowed += amount;

        emit LiquidityBorrowed(recipient, token, amount, pool.utilizationRate);

        return true;
    }

    function repayLiquidity(
        address token,
        uint256 amount
    ) external nonReentrant returns (bool) {
        if (amount == 0) revert InvalidAmount(amount);

        Pool storage pool = _pools[token];
        if (!pool.isActive) revert PoolNotActive(token);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        pool.availableLiquidity += amount;
        pool.borrowedLiquidity -= amount;
        pool.lastUpdate = block.timestamp;

        _updateUtilization(pool);
        
        _totalBorrowed -= amount;

        emit LiquidityRepaid(msg.sender, token, amount, pool.utilizationRate);

        return true;
    }

    function claimFees(address token) external nonReentrant returns (uint256) {
        Pool storage pool = _pools[token];
        if (!pool.isActive) revert PoolNotActive(token);

        ProviderPosition storage position = _positions[msg.sender][token];

        _updatePendingFees(msg.sender, token);
        
        uint256 totalFees = position.accruedFees;

        if (totalFees == 0) return 0;

        position.accruedFees = 0;
        position.feeDebt = 0;
        position.lastFeeUpdate = block.timestamp;

        IERC20(token).safeTransfer(msg.sender, totalFees);

        emit FeesClaimed(msg.sender, token, totalFees);

        return totalFees;
    }

    function _updateUtilization(Pool storage pool) private {
        if (pool.totalLiquidity > 0) {
            pool.utilizationRate = uint24(
                (pool.borrowedLiquidity * RATE_PRECISION) / pool.totalLiquidity
            );
            if (pool.utilizationRate > MAX_UTILIZATION) {
                revert UtilizationTooHigh(pool.utilizationRate, MAX_UTILIZATION);
            }
        } else {
            pool.utilizationRate = 0;
        }
    }

    function _updatePendingFees(address provider, address token) private {
        Pool storage pool = _pools[token];
        ProviderPosition storage position = _positions[provider][token];

        if (position.shares == 0) return;

        uint256 timeElapsed = block.timestamp - position.lastFeeUpdate;
        if (timeElapsed == 0) return;

        // Calculate fee per second more safely
        // feeRate is in basis points (10000 = 100%), so 100 = 1%
        // We want annual rate: feeRate / RATE_PRECISION = annual rate
        // Then per second: (feeRate / RATE_PRECISION) / 365 days
        // To avoid overflow, calculate in stages
        uint256 annualRate = (pool.feeRate * FEE_PRECISION) / RATE_PRECISION; // fee rate in FEE_PRECISION
        uint256 ratePerSecond = annualRate / 365 days;
        
        uint256 pendingFees = (position.shares * ratePerSecond * timeElapsed) / FEE_PRECISION;
        
        if (pendingFees > 0) {
            position.accruedFees += pendingFees;
            position.lastFeeUpdate = block.timestamp;
        }
    }

    function _calculatePendingFees(address provider, address token) private view returns (uint256) {
        Pool storage pool = _pools[token];
        ProviderPosition storage position = _positions[provider][token];

        if (position.shares == 0) return 0;

        uint256 timeElapsed = block.timestamp - position.lastFeeUpdate;
        if (timeElapsed == 0) return 0;

        uint256 annualRate = (pool.feeRate * FEE_PRECISION) / RATE_PRECISION;
        uint256 ratePerSecond = annualRate / 365 days;
        
        return (position.shares * ratePerSecond * timeElapsed) / FEE_PRECISION;
    }

    function _getTokenDecimals(address token) private view returns (uint8) {
        (bool success, bytes memory data) = token.staticcall(
            abi.encodeWithSignature("decimals()")
        );
        return success && data.length >= 32 ? abi.decode(data, (uint8)) : 18;
    }

    function getPoolInfo(address token) external view returns (
        uint256 totalLiquidity,
        uint256 availableLiquidity,
        uint256 borrowedLiquidity,
        uint24 utilizationRate,
        uint24 feeRate,
        uint256 reserveFactor,
        bool isActive
    ) {
        Pool storage pool = _pools[token];
        return (
            pool.totalLiquidity,
            pool.availableLiquidity,
            pool.borrowedLiquidity,
            pool.utilizationRate,
            pool.feeRate,
            pool.reserveFactor,
            pool.isActive
        );
    }

    function getProviderPosition(address provider, address token) external view returns (
        uint256 shares,
        uint256 entryTimestamp,
        uint256 lastDeposit,
        uint256 lastWithdraw,
        uint256 accruedFees,
        uint256 pendingFees
    ) {
        ProviderPosition storage position = _positions[provider][token];
        uint256 pending = _calculatePendingFees(provider, token);
        return (
            position.shares,
            position.entryTimestamp,
            position.lastDeposit,
            position.lastWithdraw,
            position.accruedFees,
            pending
        );
    }

    function getPoolProviders(address token) external view returns (address[] memory) {
        return _poolProviders[token].values();
    }

    function getActivePools() external view returns (address[] memory) {
        return _activePools.values();
    }

    function getPoolMetadata(address token) external view returns (PoolMetadata memory) {
        return _poolMetadata[token];
    }

    function getTVL() external view returns (uint256 totalValueLocked, uint256 totalBorrowed) {
        return (_totalValueLocked, _totalBorrowed);
    }

    function updatePoolConfig(
        address token,
        uint24 feeRate,
        uint256 reserveFactor,
        uint256 maxLiquidity
    ) external onlyRole(POOL_MANAGER) {
        Pool storage pool = _pools[token];
        if (!pool.isActive) revert PoolNotActive(token);
        if (feeRate > MAX_FEE_RATE) revert FeeRateTooHigh(feeRate, uint24(MAX_FEE_RATE));
        if (reserveFactor > RESERVE_FACTOR_MAX) revert ReserveFactorTooHigh(reserveFactor, RESERVE_FACTOR_MAX);
        if (maxLiquidity <= pool.minLiquidity) revert InvalidLiquidityBounds();

        pool.feeRate = feeRate;
        pool.reserveFactor = reserveFactor;
        pool.maxLiquidity = maxLiquidity;

        emit PoolUpdated(token, feeRate, reserveFactor, maxLiquidity);
    }

    function deactivatePool(address token) external onlyRole(POOL_MANAGER) {
        Pool storage pool = _pools[token];
        if (!pool.isActive) revert PoolNotActive(token);
        if (pool.totalLiquidity > 0) revert("Cannot deactivate pool with liquidity");

        pool.isActive = false;
        _activePools.remove(token);
    }
}