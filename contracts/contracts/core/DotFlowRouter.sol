// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/ILiquidityAdapter.sol";
import "../interfaces/IXCM.sol";

contract DotFlowRouter is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    bytes32 public constant ROUTER_ADMIN = keccak256("ROUTER_ADMIN");
    bytes32 public constant LIQUIDITY_MANAGER = keccak256("LIQUIDITY_MANAGER");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    struct SwapPath {
        address[] adapters;
        address[] path;
        bool isCrossChain;
        uint32[] destinationChains;
    }

    struct SwapRequest {
        bytes32 id;
        address user;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMin;
        address recipient;
        uint256 deadline;
        SwapPath path;
        uint256 nonce;
    }

    struct CrossChainSwapRequest {
        bytes32 swapId;
        bytes32 xcmMessageId;
        uint32 destinationChainId;
        address executor;
        bytes xcmCallData;
        uint256 sourceAmount;
        uint256 targetAmount;
        uint64 timeout;
    }

    uint256 private _swapNonces;
    mapping(bytes32 => SwapRequest) private _swapRequests;
    mapping(bytes32 => CrossChainSwapRequest) private _crossChainSwaps;
    mapping(bytes32 => bool) private _executedSwaps;
    mapping(address => EnumerableSet.Bytes32Set) private _userSwaps;
    mapping(address => mapping(address => uint256)) private _userSwapCount;
    
    EnumerableSet.AddressSet private _activeAdapters;
    mapping(address => ILiquidityAdapter.AdapterInfo) private _adapterInfo;
    
    IXCM private _xcmExecutor;
    address public feeCollector;
    uint24 public protocolFee;
    uint24 public constant MAX_PROTOCOL_FEE = 1000; // 10%
    uint256 private constant FEE_DENOMINATOR = 10000;

    error InvalidPath();
    error ExpiredDeadline(uint256 deadline, uint256 timestamp);
    error InsufficientOutput(uint256 expected, uint256 actual);
    error AdapterNotApproved(address adapter);
    error CrossChainMismatch();
    error TransferFailed();
    error ZeroAddress();
    error ZeroAmount();

    event SwapCreated(
        bytes32 indexed swapId,
        address indexed user,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        uint256 deadline
    );

    event SwapExecuted(
        bytes32 indexed swapId,
        address indexed user,
        uint256 amountOut,
        uint256 fee,
        uint256 timestamp
    );

    event CrossChainSwapInitiated(
        bytes32 indexed swapId,
        bytes32 indexed xcmMessageId,
        uint32 indexed destinationChain,
        uint256 amount
    );

    event CrossChainSwapCompleted(
        bytes32 indexed swapId,
        bytes32 indexed xcmMessageId,
        address recipient,
        uint256 amount
    );

    event AdapterAdded(address indexed adapter, string name, uint24 fee);
    event AdapterRemoved(address indexed adapter);
    event ProtocolFeeUpdated(uint24 oldFee, uint24 newFee);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event XCMExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);

    modifier validPath(SwapPath calldata path) {
        if (path.adapters.length == 0 || path.path.length < 2) revert InvalidPath();
        if (path.adapters.length != path.path.length - 1) revert InvalidPath();
        if (path.isCrossChain && path.destinationChains.length != path.adapters.length) revert CrossChainMismatch();
        
        for (uint i = 0; i < path.adapters.length; i++) {
            if (!_activeAdapters.contains(path.adapters[i])) revert AdapterNotApproved(path.adapters[i]);
        }
        _;
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert ExpiredDeadline(deadline, block.timestamp);
        _;
    }

    constructor(address feeCollector_, uint24 protocolFee_) {
        if (feeCollector_ == address(0)) revert ZeroAddress();
        if (protocolFee_ > MAX_PROTOCOL_FEE) revert("Fee too high");
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ROUTER_ADMIN, msg.sender);
        
        feeCollector = feeCollector_;
        protocolFee = protocolFee_;
        
        _swapNonces = 1;
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        SwapPath calldata path,
        uint256 deadline
    ) 
        external 
        nonReentrant 
        whenNotPaused 
        validPath(path)
        checkDeadline(deadline) 
        returns (bytes32 swapId, uint256 amountOut) 
    {
        if (amountIn == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (path.isCrossChain) revert("Use crossChainSwap for cross-chain transfers");

        swapId = _generateSwapId(msg.sender, tokenIn, tokenOut, amountIn, _swapNonces);
        
        SwapRequest storage request = _swapRequests[swapId];
        request.id = swapId;
        request.user = msg.sender;
        request.tokenIn = tokenIn;
        request.tokenOut = tokenOut;
        request.amountIn = amountIn;
        request.amountOutMin = amountOutMin;
        request.recipient = recipient;
        request.deadline = deadline;
        request.path = path;
        request.nonce = _swapNonces;
        
        _swapNonces++;
        _userSwaps[msg.sender].add(swapId);
        _userSwapCount[msg.sender][tokenIn]++;

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        emit SwapCreated(swapId, msg.sender, tokenIn, tokenOut, amountIn, amountOutMin, recipient, deadline);

        amountOut = _executeSwap(request);

        if (amountOut < amountOutMin) revert InsufficientOutput(amountOutMin, amountOut);

        uint256 fee = (amountOut * protocolFee) / FEE_DENOMINATOR;
        uint256 amountAfterFee = amountOut - fee;

        if (fee > 0) {
            IERC20(tokenOut).safeTransfer(feeCollector, fee);
        }

        IERC20(tokenOut).safeTransfer(recipient, amountAfterFee);
        
        _executedSwaps[swapId] = true;

        emit SwapExecuted(swapId, msg.sender, amountAfterFee, fee, block.timestamp);

        return (swapId, amountAfterFee);
    }

    function crossChainSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        SwapPath calldata path,
        uint32 destinationChainId,
        bytes calldata xcmCallData,
        uint64 xcmTimeout,
        uint256 deadline
    )
        external
        payable
        nonReentrant
        whenNotPaused
        validPath(path)
        checkDeadline(deadline)
        returns (bytes32 swapId, bytes32 xcmMessageId)
    {
        if (amountIn == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (!path.isCrossChain) revert("Path must be cross-chain");
        if (address(_xcmExecutor) == address(0)) revert("XCM executor not set");

        swapId = _generateSwapId(msg.sender, tokenIn, tokenOut, amountIn, _swapNonces);
        
        SwapRequest storage swapRequest = _swapRequests[swapId];
        swapRequest.id = swapId;
        swapRequest.user = msg.sender;
        swapRequest.tokenIn = tokenIn;
        swapRequest.tokenOut = tokenOut;
        swapRequest.amountIn = amountIn;
        swapRequest.amountOutMin = amountOutMin;
        swapRequest.recipient = address(this);
        swapRequest.deadline = deadline;
        swapRequest.path = path;
        swapRequest.nonce = _swapNonces;

        _swapNonces++;

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        emit SwapCreated(swapId, msg.sender, tokenIn, tokenOut, amountIn, amountOutMin, address(this), deadline);

        uint256 swapOutput = _executeSwap(swapRequest);

        if (swapOutput < amountOutMin) revert InsufficientOutput(amountOutMin, swapOutput);

        IXCM.XCMInstruction memory instruction = IXCM.XCMInstruction({
            destinationChainId: destinationChainId,
            sender: address(this),
            recipient: recipient,
            asset: tokenOut,
            amount: uint128(swapOutput),
            callData: xcmCallData,
            weight: _calculateWeight(tokenOut, swapOutput, xcmCallData),
            transactWeight: _calculateTransactWeight(tokenOut, swapOutput, xcmCallData),
            timeout: xcmTimeout
        });

        uint256 xcmFee = _xcmExecutor.calculateFee(destinationChainId, instruction.weight, swapOutput);
        if (msg.value < xcmFee) revert("Insufficient XCM fee");

        xcmMessageId = _xcmExecutor.sendXCM{value: xcmFee}(instruction);

        CrossChainSwapRequest storage ccRequest = _crossChainSwaps[swapId];
        ccRequest.swapId = swapId;
        ccRequest.xcmMessageId = xcmMessageId;
        ccRequest.destinationChainId = destinationChainId;
        ccRequest.executor = recipient;
        ccRequest.xcmCallData = xcmCallData;
        ccRequest.sourceAmount = amountIn;
        ccRequest.targetAmount = swapOutput;
        ccRequest.timeout = xcmTimeout;

        if (msg.value > xcmFee) {
            payable(msg.sender).transfer(msg.value - xcmFee);
        }

        emit CrossChainSwapInitiated(swapId, xcmMessageId, destinationChainId, swapOutput);

        return (swapId, xcmMessageId);
    }

    function _executeSwap(SwapRequest memory request) private returns (uint256 amountOut) {
        uint256 currentAmount = request.amountIn;
        address currentToken = request.tokenIn;

        for (uint i = 0; i < request.path.adapters.length; i++) {
            address adapter = request.path.adapters[i];
            address nextToken = request.path.path[i + 1];

            // FIX: Reset allowance using safeDecreaseAllowance pattern
            uint256 currentAllowance = IERC20(currentToken).allowance(address(this), adapter);
            if (currentAllowance > 0) {
                IERC20(currentToken).safeDecreaseAllowance(adapter, currentAllowance);
            }
            IERC20(currentToken).safeIncreaseAllowance(adapter, currentAmount);

            (uint256 adapterOutput, uint256 adapterFee) = ILiquidityAdapter(adapter).swapExactTokensForTokens(
                currentToken,
                nextToken,
                currentAmount,
                0,
                address(this),
                ""
            );

            if (adapterOutput == 0) revert("Swap failed at adapter");

            currentAmount = adapterOutput;
            currentToken = nextToken;
        }

        return currentAmount;
    }

    function _generateSwapId(
        address user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 nonce
    ) private view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                user,
                tokenIn,
                tokenOut,
                amountIn,
                nonce,
                block.chainid,
                block.timestamp
            )
        );
    }

    function _calculateWeight(
        address token,
        uint256 amount,
        bytes memory callData
    ) private pure returns (uint64) {
        uint64 baseWeight = 1000000000;
        uint64 tokenWeight = 10000000;
        uint64 dataWeight = uint64(callData.length) * 1000;
        return baseWeight + tokenWeight + dataWeight;
    }

    function _calculateTransactWeight(
        address token,
        uint256 amount,
        bytes memory callData
    ) private pure returns (uint128) {
        return uint128(_calculateWeight(token, amount, callData)) * 2;
    }

    function getSwapRequest(bytes32 swapId) external view returns (SwapRequest memory) {
        return _swapRequests[swapId];
    }

    function getCrossChainSwap(bytes32 swapId) external view returns (CrossChainSwapRequest memory) {
        return _crossChainSwaps[swapId];
    }

    function isSwapExecuted(bytes32 swapId) external view returns (bool) {
        return _executedSwaps[swapId];
    }

    function getUserSwaps(address user) external view returns (bytes32[] memory) {
        return _userSwaps[user].values();
    }

    function getUserSwapCount(address user, address token) external view returns (uint256) {
        return _userSwapCount[user][token];
    }

    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        SwapPath calldata path
    ) external view validPath(path) returns (uint256 amountOut, uint256 totalFee, uint256 priceImpact) {
        uint256 currentAmount = amountIn;
        uint256 cumulativeFee = 0;

        for (uint i = 0; i < path.adapters.length; i++) {
            address adapter = path.adapters[i];
            address nextToken = path.path[i + 1];

            (uint256 adapterOutput, uint24 fee, uint256 impact) = ILiquidityAdapter(adapter).getAmountOut(
                path.path[i],
                nextToken,
                currentAmount
            );

            currentAmount = adapterOutput;
            cumulativeFee += (adapterOutput * fee) / FEE_DENOMINATOR;
            priceImpact += impact;
        }

        uint256 protocolFeeAmount = (currentAmount * protocolFee) / FEE_DENOMINATOR;
        amountOut = currentAmount - protocolFeeAmount;
        totalFee = cumulativeFee + protocolFeeAmount;

        return (amountOut, totalFee, priceImpact / path.adapters.length);
    }

    function addAdapter(address adapter) external onlyRole(ROUTER_ADMIN) {
        if (adapter == address(0)) revert ZeroAddress();
        if (_activeAdapters.contains(adapter)) revert("Adapter already added");

        ILiquidityAdapter.AdapterInfo memory info = ILiquidityAdapter(adapter).getAdapterInfo();
        
        _adapterInfo[adapter] = info;
        _activeAdapters.add(adapter);

        emit AdapterAdded(adapter, info.name, info.fee);
    }

    function removeAdapter(address adapter) external onlyRole(ROUTER_ADMIN) {
        if (!_activeAdapters.contains(adapter)) revert("Adapter not found");
        
        _activeAdapters.remove(adapter);
        delete _adapterInfo[adapter];

        emit AdapterRemoved(adapter);
    }

    function getActiveAdapters() external view returns (address[] memory) {
        return _activeAdapters.values();
    }

    function getAdapterInfo(address adapter) external view returns (ILiquidityAdapter.AdapterInfo memory) {
        return _adapterInfo[adapter];
    }

    function setProtocolFee(uint24 newFee) external onlyRole(ROUTER_ADMIN) {
        if (newFee > MAX_PROTOCOL_FEE) revert("Fee too high");
        uint24 oldFee = protocolFee;
        protocolFee = newFee;
        emit ProtocolFeeUpdated(oldFee, newFee);
    }

    function setFeeCollector(address newCollector) external onlyRole(ROUTER_ADMIN) {
        if (newCollector == address(0)) revert ZeroAddress();
        address oldCollector = feeCollector;
        feeCollector = newCollector;
        emit FeeCollectorUpdated(oldCollector, newCollector);
    }

    function setXCMExecutor(address executor) external onlyRole(ROUTER_ADMIN) {
        if (executor == address(0)) revert ZeroAddress();
        address oldExecutor = address(_xcmExecutor);
        _xcmExecutor = IXCM(executor);
        emit XCMExecutorUpdated(oldExecutor, executor);
    }

    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }

    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(EMERGENCY_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }
}