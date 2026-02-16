// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/ILiquidityAdapter.sol";
import "../interfaces/IXCM.sol";

contract ParachainAdapter is ILiquidityAdapter, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

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

    error ParachainNotSupported(uint32 parachainId);
    error TokenNotMapped(address token, uint32 parachainId);
    error BridgeFeeTooHigh(uint256 fee, uint256 max);

    event ParachainConfigured(uint32 indexed parachainId, string name, uint256 bridgeFee);
    event TokenMapped(address indexed token, uint32 indexed parachainId, bytes32 assetId);
    event BridgeExecuted(bytes32 indexed messageId, uint32 indexed parachainId, address token, uint256 amount);

    constructor(
        string memory name_,
        address xcmExecutor_,
        uint24 fee_,
        uint256 minSwapAmount_,
        uint256 maxSwapAmount_
    ) {
        _name = name_;
        _xcmExecutor = IXCM(xcmExecutor_);
        _fee = fee_;
        _minSwapAmount = minSwapAmount_;
        _maxSwapAmount = maxSwapAmount_;
        _active = true;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADAPTER_ADMIN, msg.sender);
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
        if (amountIn < _minSwapAmount || amountIn > _maxSwapAmount) 
            revert InvalidAmount(amountIn, _minSwapAmount, _maxSwapAmount);
        if (recipient == address(0)) revert("Invalid recipient");

        (uint32 targetParachainId, bytes memory callData) = abi.decode(data, (uint32, bytes));

        ParachainConfig storage parachain = _parachains[targetParachainId];
        if (!parachain.isActive) revert ParachainNotSupported(targetParachainId);

        TokenMapping storage mappingIn = _tokenMappings[tokenIn][targetParachainId];
        if (!mappingIn.isActive) revert TokenNotMapped(tokenIn, targetParachainId);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        fee = (amountIn * _fee) / FEE_DENOMINATOR;
        uint256 amountAfterFee = amountIn - fee;
        uint256 bridgeFee = (amountAfterFee * parachain.bridgeFee) / FEE_DENOMINATOR;
        uint256 transferAmount = amountAfterFee - bridgeFee;

        if (transferAmount < parachain.minTransfer || transferAmount > parachain.maxTransfer) {
            revert InvalidAmount(transferAmount, parachain.minTransfer, parachain.maxTransfer);
        }

        IXCM.ParachainAsset[] memory assets = new IXCM.ParachainAsset[](1);
        assets[0] = IXCM.ParachainAsset({
            assetId: mappingIn.parachainAssetId,
            amount: uint128(transferAmount),
            isNative: mappingIn.isNative
        });

        bytes32 messageId = _xcmExecutor.sendParachainAssets(
            targetParachainId,
            recipient,
            assets,
            callData,
            parachain.timeout
        );

        if (fee > 0) {
            IERC20(tokenIn).safeTransfer(_getFeeCollector(), fee);
        }

        if (bridgeFee > 0) {
            IERC20(tokenIn).safeTransfer(_getBridgeCollector(targetParachainId), bridgeFee);
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
        
        // Bridge fee would be applied based on destination
        amountOut = afterFee;
        priceImpact = 0; // Parachain transfers typically have minimal price impact

        return (amountOut, fee, priceImpact);
    }

    function getAdapterInfo() external view override returns (AdapterInfo memory) {
        address[] memory tokens = _supportedTokens.values();
        
        return AdapterInfo({
            name: _name,
            adapterAddress: address(this),
            isActive: _active,
            tvl: _calculateTVL(),
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
        // Parachain adapters don't maintain reserves
        return (0, 0);
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

        _supportedParachains.add(parachainId);

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
        if (token == address(0)) revert("Invalid token");
        
        uint256 actualMinTransfer = minTransfer == 0 ? _parachains[parachainId].minTransfer : minTransfer;
        uint256 actualMaxTransfer = maxTransfer == 0 ? _parachains[parachainId].maxTransfer : maxTransfer;

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
        mapping_.isActive = false;
        delete _reverseMappings[parachainId][assetId];
        _parachainTokens[parachainId].remove(token);
        
        // Check if token is still mapped to any parachain
        bool stillSupported = false;
        uint32[] memory parachains = getSupportedParachains();
        for (uint i = 0; i < parachains.length; i++) {
            if (_tokenMappings[token][parachains[i]].isActive) {
                stillSupported = true;
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
        if (minTransfer > 0) config.minTransfer = minTransfer;
        if (maxTransfer > 0) config.maxTransfer = maxTransfer;
        if (timeout > 0) config.timeout = timeout;
        config.isActive = isActive;
    }

    function setXCMExecutor(address newExecutor) external onlyRole(ADAPTER_ADMIN) {
        if (newExecutor == address(0)) revert("Invalid address");
        _xcmExecutor = IXCM(newExecutor);
    }

    function setFee(uint24 newFee) external onlyRole(ADAPTER_ADMIN) {
        if (newFee > MAX_FEE) revert("Fee too high");
        _fee = newFee;
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

    function _getFeeCollector() private view returns (address) {
        // This would be configurable in production
        return address(this);
    }

    function _getBridgeCollector(uint32 parachainId) private view returns (address) {
        // This would be configurable per parachain
        return address(this);
    }

    function _calculateTVL() private view returns (uint256) {
        uint256 totalValue = 0;
        address[] memory tokens = _supportedTokens.values();

        for (uint i = 0; i < tokens.length; i++) {
            // In production, you'd query actual balances
            totalValue += IERC20(tokens[i]).balanceOf(address(this));
        }

        return totalValue;
    }

    function addLiquidity(
        address token,
        uint256 amount,
        bytes calldata data
    ) external override onlyRole(BRIDGE_OPERATOR) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        emit LiquidityAdded(token, amount, IERC20(token).balanceOf(address(this)));
    }

    function removeLiquidity(
        address token,
        uint256 amount,
        bytes calldata data
    ) external override onlyRole(BRIDGE_OPERATOR) {
        if (IERC20(token).balanceOf(address(this)) < amount) revert("Insufficient balance");
        
        IERC20(token).safeTransfer(msg.sender, amount);
        
        emit LiquidityRemoved(token, amount, IERC20(token).balanceOf(address(this)));
    }
}