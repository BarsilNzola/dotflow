// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/ILiquidityAdapter.sol";
import "../interfaces/IXCM.sol";

contract ParachainAdapter is ILiquidityAdapter, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant ADAPTER_ADMIN = keccak256("ADAPTER_ADMIN");
    bytes32 public constant BRIDGE_OPERATOR = keccak256("BRIDGE_OPERATOR");

    struct ParachainConfig {
        uint32 parachainId;
        string name;
        uint256 bridgeFee;
        uint256 minTransfer;
        uint256 maxTransfer;
        uint64 timeout;
        bool isActive;
    }

    struct TokenMapping {
        address erc20Address;
        bytes32 parachainAssetId;
        uint8 decimals;
        uint256 minTransfer;
        uint256 maxTransfer;
        bool isNative;
        bool isActive;
    }

    string private _name;
    IXCM private _xcmExecutor;
    uint24 private _fee;
    uint256 private _minSwapAmount;
    uint256 private _maxSwapAmount;
    bool private _active;

    mapping(uint32 => ParachainConfig) private _parachains;
    mapping(address => mapping(uint32 => TokenMapping)) private _tokenMappings;
    mapping(uint32 => mapping(bytes32 => address)) private _reverseMappings;
    mapping(uint32 => EnumerableSet.AddressSet) private _parachainTokens;
    
    EnumerableSet.AddressSet private _supportedTokens;
    EnumerableSet.UintSet private _supportedParachains;

    uint256 private constant FEE_DENOMINATOR = 10000;
    uint24 private constant MAX_FEE = 200; // 2%
    uint64 private constant DEFAULT_TIMEOUT = 1 hours;

    // Fee collector addresses
    address private _feeCollector;
    mapping(uint32 => address) private _bridgeCollectors;

    error ParachainNotSupported(uint32 parachainId);
    error TokenNotMapped(address token, uint32 parachainId);
    error BridgeFeeTooHigh(uint256 fee, uint256 max);
    error InsufficientBalance(uint256 available, uint256 required);
    error InsufficientOutput(uint256 expected, uint256 actual);
    error ZeroAddress();

    event ParachainConfigured(uint32 indexed parachainId, string name, uint256 bridgeFee);
    event TokenMapped(address indexed token, uint32 indexed parachainId, bytes32 assetId);
    event BridgeExecuted(bytes32 indexed messageId, uint32 indexed parachainId, address token, uint256 amount);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event BridgeCollectorUpdated(uint32 indexed parachainId, address indexed oldCollector, address indexed newCollector);

    constructor(
        string memory name_,
        address xcmExecutor_,
        uint24 fee_,
        uint256 minSwapAmount_,
        uint256 maxSwapAmount_
    ) {
        if (xcmExecutor_ == address(0)) revert ZeroAddress();
        
        _name = name_;
        _xcmExecutor = IXCM(xcmExecutor_);
        _fee = fee_;
        _minSwapAmount = minSwapAmount_;
        _maxSwapAmount = maxSwapAmount_;
        _active = true;
        _feeCollector = msg.sender; // Default fee collector is deployer

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADAPTER_ADMIN, msg.sender);
    }

    // External function - non-payable version
    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bytes calldata data
    ) external override nonReentrant returns (uint256 amountOut, uint256 fee) {
        return _swap(tokenIn, tokenOut, amountIn, amountOutMin, recipient, data);
    }

    // External function - payable version with fee handling
    function swapExactTokensForTokensWithFee(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bytes calldata data
    ) external payable nonReentrant returns (uint256 amountOut, uint256 fee) {
        uint256 xcmFee = msg.value;
        
        (amountOut, fee) = _swap(tokenIn, tokenOut, amountIn, amountOutMin, recipient, data);
        
        // Forward the ETH to the XCM executor
        (bool success, ) = address(_xcmExecutor).call{value: xcmFee}("");
        require(success, "ETH transfer failed");
        
        return (amountOut, fee);
    }

    // Internal swap logic - NOT nonReentrant (called by external functions)
    function _swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bytes calldata data
    ) internal returns (uint256 amountOut, uint256 fee) {
        if (!_active) revert AdapterInactive();
        if (amountIn < _minSwapAmount || amountIn > _maxSwapAmount) 
            revert InvalidAmount(amountIn, _minSwapAmount, _maxSwapAmount);
        if (recipient == address(0)) revert("Invalid recipient");

        (uint32 targetParachainId, bytes memory callData) = abi.decode(data, (uint32, bytes));

        ParachainConfig storage parachain = _parachains[targetParachainId];
        if (!parachain.isActive) revert ParachainNotSupported(targetParachainId);

        TokenMapping storage mappingIn = _tokenMappings[tokenIn][targetParachainId];
        if (!mappingIn.isActive) revert TokenNotMapped(tokenIn, targetParachainId);

        // Transfer tokens from sender to this contract
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Calculate fees
        fee = (amountIn * _fee) / FEE_DENOMINATOR;
        uint256 amountAfterFee = amountIn - fee;
        uint256 bridgeFee = (amountAfterFee * parachain.bridgeFee) / FEE_DENOMINATOR;
        uint256 transferAmount = amountAfterFee - bridgeFee;

        if (transferAmount < mappingIn.minTransfer || transferAmount > mappingIn.maxTransfer) {
            revert InvalidAmount(transferAmount, mappingIn.minTransfer, mappingIn.maxTransfer);
        }

        if (amountOutMin > 0 && transferAmount < amountOutMin) {
            revert InsufficientOutput(amountOutMin, transferAmount);
        }

        // Prepare assets for XCM
        IXCM.ParachainAsset[] memory assets = new IXCM.ParachainAsset[](1);
        assets[0] = IXCM.ParachainAsset({
            assetId: mappingIn.parachainAssetId,
            amount: uint128(transferAmount),
            isNative: mappingIn.isNative
        });

        // FIX: Use forceApprove instead of safeApprove (deprecated)
        // First reset to 0, then set to exact amount
        IERC20(tokenIn).safeDecreaseAllowance(address(_xcmExecutor), IERC20(tokenIn).allowance(address(this), address(_xcmExecutor)));
        IERC20(tokenIn).safeIncreaseAllowance(address(_xcmExecutor), transferAmount);

        // Send via XCM
        bytes32 messageId = _xcmExecutor.sendParachainAssets(
            targetParachainId,
            recipient,
            assets,
            callData,
            parachain.timeout
        );

        // Transfer fees to actual collectors
        if (fee > 0) {
            IERC20(tokenIn).safeTransfer(_feeCollector, fee);
        }

        if (bridgeFee > 0) {
            address bridgeCollector = _bridgeCollectors[targetParachainId];
            if (bridgeCollector == address(0)) {
                bridgeCollector = _feeCollector; // Fallback to main fee collector
            }
            IERC20(tokenIn).safeTransfer(bridgeCollector, bridgeFee);
        }

        emit SwapExecuted(address(this), tokenIn, tokenOut, amountIn, transferAmount, fee, recipient);
        emit BridgeExecuted(messageId, targetParachainId, tokenIn, transferAmount);

        return (transferAmount, fee);
    }

    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view override returns (uint256 amountOut, uint24 fee, uint256 priceImpact) {
        if (amountIn < _minSwapAmount || amountIn > _maxSwapAmount) 
            revert InvalidAmount(amountIn, _minSwapAmount, _maxSwapAmount);

        fee = _fee;
        uint256 afterFee = amountIn - ((amountIn * fee) / FEE_DENOMINATOR);
        
        amountOut = afterFee;
        priceImpact = 0; // Parachain transfers have no price impact

        return (amountOut, fee, priceImpact);
    }

    function getAdapterInfo() external view override returns (AdapterInfo memory) {
        address[] memory tokens = _supportedTokens.values();
        uint256 tvl = 0;
        
        // Calculate actual TVL from token balances
        for (uint i = 0; i < tokens.length; i++) {
            tvl += IERC20(tokens[i]).balanceOf(address(this));
        }
        
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
        return (IERC20(token).balanceOf(address(this)), block.timestamp);
    }

    function configureParachain(
        uint32 parachainId,
        string calldata name,
        uint256 bridgeFee,
        uint256 minTransfer,
        uint256 maxTransfer,
        uint64 timeout
    ) external onlyRole(ADAPTER_ADMIN) {
        if (bridgeFee > MAX_FEE) revert BridgeFeeTooHigh(bridgeFee, MAX_FEE);
        if (minTransfer >= maxTransfer) revert("Invalid transfer limits");
        if (minTransfer == 0) revert("Min transfer cannot be zero");
        
        uint64 actualTimeout = timeout == 0 ? DEFAULT_TIMEOUT : timeout;

        _parachains[parachainId] = ParachainConfig({
            parachainId: parachainId,
            name: name,
            bridgeFee: bridgeFee,
            minTransfer: minTransfer,
            maxTransfer: maxTransfer,
            timeout: actualTimeout,
            isActive: true
        });

        _supportedParachains.add(uint256(parachainId));

        emit ParachainConfigured(parachainId, name, bridgeFee);
    }

    function mapToken(
        address token,
        uint32 parachainId,
        bytes32 assetId,
        uint8 decimals,
        uint256 minTransfer,
        uint256 maxTransfer,
        bool isNative
    ) external onlyRole(ADAPTER_ADMIN) {
        if (!_parachains[parachainId].isActive) revert ParachainNotSupported(parachainId);
        if (token == address(0)) revert ZeroAddress();
        if (assetId == bytes32(0)) revert("Invalid asset ID");
        
        ParachainConfig storage parachain = _parachains[parachainId];
        uint256 actualMinTransfer = minTransfer == 0 ? parachain.minTransfer : minTransfer;
        uint256 actualMaxTransfer = maxTransfer == 0 ? parachain.maxTransfer : maxTransfer;

        if (actualMinTransfer < parachain.minTransfer) revert("Min transfer below parachain minimum");
        if (actualMaxTransfer > parachain.maxTransfer) revert("Max transfer above parachain maximum");

        _tokenMappings[token][parachainId] = TokenMapping({
            erc20Address: token,
            parachainAssetId: assetId,
            decimals: decimals,
            minTransfer: actualMinTransfer,
            maxTransfer: actualMaxTransfer,
            isNative: isNative,
            isActive: true
        });

        _reverseMappings[parachainId][assetId] = token;
        _parachainTokens[parachainId].add(token);
        _supportedTokens.add(token);

        emit TokenMapped(token, parachainId, assetId);
    }

    function unmapToken(address token, uint32 parachainId) external onlyRole(ADAPTER_ADMIN) {
        TokenMapping storage mapping_ = _tokenMappings[token][parachainId];
        if (!mapping_.isActive) revert TokenNotMapped(token, parachainId);

        bytes32 assetId = mapping_.parachainAssetId;
        delete _tokenMappings[token][parachainId];
        delete _reverseMappings[parachainId][assetId];
        _parachainTokens[parachainId].remove(token);
        
        // Check if token is still mapped to any parachain
        bool stillSupported = false;
        address[] memory tokens = _supportedTokens.values();
        for (uint i = 0; i < tokens.length; i++) {
            if (tokens[i] == token) {
                // Check all parachains for this token
                uint32[] memory parachains = getSupportedParachains();
                for (uint j = 0; j < parachains.length; j++) {
                    if (_tokenMappings[token][parachains[j]].isActive) {
                        stillSupported = true;
                        break;
                    }
                }
                break;
            }
        }
        
        if (!stillSupported) {
            _supportedTokens.remove(token);
        }
    }

    function updateParachainConfig(
        uint32 parachainId,
        uint256 bridgeFee,
        uint256 minTransfer,
        uint256 maxTransfer,
        uint64 timeout,
        bool isActive
    ) external onlyRole(ADAPTER_ADMIN) {
        ParachainConfig storage config = _parachains[parachainId];
        if (config.parachainId != parachainId) revert ParachainNotSupported(parachainId);

        if (bridgeFee > 0) {
            if (bridgeFee > MAX_FEE) revert BridgeFeeTooHigh(bridgeFee, MAX_FEE);
            config.bridgeFee = bridgeFee;
        }
        if (minTransfer > 0) {
            if (minTransfer >= config.maxTransfer) revert("Invalid min transfer");
            config.minTransfer = minTransfer;
        }
        if (maxTransfer > 0) {
            if (maxTransfer <= config.minTransfer) revert("Invalid max transfer");
            config.maxTransfer = maxTransfer;
        }
        if (timeout > 0) config.timeout = timeout;
        config.isActive = isActive;
    }

    function setFeeCollector(address newCollector) external onlyRole(ADAPTER_ADMIN) {
        if (newCollector == address(0)) revert ZeroAddress();
        address oldCollector = _feeCollector;
        _feeCollector = newCollector;
        emit FeeCollectorUpdated(oldCollector, newCollector);
    }

    function setBridgeCollector(uint32 parachainId, address newCollector) external onlyRole(ADAPTER_ADMIN) {
        if (!_parachains[parachainId].isActive) revert ParachainNotSupported(parachainId);
        if (newCollector == address(0)) revert ZeroAddress();
        
        address oldCollector = _bridgeCollectors[parachainId];
        _bridgeCollectors[parachainId] = newCollector;
        emit BridgeCollectorUpdated(parachainId, oldCollector, newCollector);
    }

    function setXCMExecutor(address newExecutor) external onlyRole(ADAPTER_ADMIN) {
        if (newExecutor == address(0)) revert ZeroAddress();
        address oldExecutor = address(_xcmExecutor);
        _xcmExecutor = IXCM(newExecutor);
        emit XCMExecutorUpdated(oldExecutor, newExecutor);
    }

    function setFee(uint24 newFee) external onlyRole(ADAPTER_ADMIN) {
        if (newFee > MAX_FEE) revert("Fee too high");
        uint24 oldFee = _fee;
        _fee = newFee;
        emit ProtocolFeeUpdated(oldFee, newFee);
    }

    function setSwapLimits(uint256 minAmount, uint256 maxAmount) external onlyRole(ADAPTER_ADMIN) {
        if (minAmount >= maxAmount) revert("Invalid limits");
        if (minAmount == 0) revert("Min amount cannot be zero");
        
        uint256 oldMin = _minSwapAmount;
        uint256 oldMax = _maxSwapAmount;
        _minSwapAmount = minAmount;
        _maxSwapAmount = maxAmount;
        emit SwapLimitsUpdated(oldMin, oldMax, minAmount, maxAmount);
    }

    function setActive(bool active) external onlyRole(ADAPTER_ADMIN) {
        _active = active;
        if (active) {
            emit AdapterActivated(address(this));
        } else {
            emit AdapterDeactivated(address(this));
        }
    }

    function getParachainConfig(uint32 parachainId) external view returns (ParachainConfig memory) {
        return _parachains[parachainId];
    }

    function getTokenMapping(address token, uint32 parachainId) external view returns (TokenMapping memory) {
        return _tokenMappings[token][parachainId];
    }

    function getParachainTokens(uint32 parachainId) external view returns (address[] memory) {
        return _parachainTokens[parachainId].values();
    }

    function getSupportedParachains() public view returns (uint32[] memory) {
        uint256 length = _supportedParachains.length();
        uint32[] memory parachains = new uint32[](length);
        
        for (uint256 i = 0; i < length; i++) {
            parachains[i] = uint32(_supportedParachains.at(i));
        }
        
        return parachains;
    }

    function getAssetId(address token, uint32 parachainId) external view returns (bytes32) {
        return _tokenMappings[token][parachainId].parachainAssetId;
    }

    function getFeeCollector() external view returns (address) {
        return _feeCollector;
    }

    function getBridgeCollector(uint32 parachainId) external view returns (address) {
        address collector = _bridgeCollectors[parachainId];
        return collector == address(0) ? _feeCollector : collector;
    }

    // Events for transparency
    event ProtocolFeeUpdated(uint24 oldFee, uint24 newFee);
    event SwapLimitsUpdated(uint256 oldMin, uint256 oldMax, uint256 newMin, uint256 newMax);
    event XCMExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);

    function addLiquidity(
        address token,
        uint256 amount,
        bytes calldata /* data */
    ) external onlyRole(BRIDGE_OPERATOR) {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert("Amount cannot be zero");
        
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        
        emit LiquidityAdded(token, balanceAfter - balanceBefore, balanceAfter);
    }

    function removeLiquidity(
        address token,
        uint256 amount,
        bytes calldata /* data */
    ) external onlyRole(BRIDGE_OPERATOR) {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert("Amount cannot be zero");
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) revert InsufficientBalance(balance, amount);
        
        IERC20(token).safeTransfer(msg.sender, amount);
        uint256 newBalance = IERC20(token).balanceOf(address(this));
        
        emit LiquidityRemoved(token, amount, newBalance);
    }
}