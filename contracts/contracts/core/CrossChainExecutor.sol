// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/IXCM.sol";

contract CrossChainExecutor is AccessControl, ReentrancyGuard, EIP712, IXCM {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant CONFIGURATOR_ROLE = keccak256("CONFIGURATOR_ROLE");

    bytes32 private constant XCM_INSTRUCTION_TYPEHASH = keccak256(
        "XCMInstruction(uint32 destinationChainId,address sender,address recipient,address asset,uint128 amount,bytes callData,uint64 weight,uint128 transactWeight,uint64 timeout)"
    );

    struct ChainConfig {
        uint32 chainId;
        string name;
        uint256 baseFee;
        uint256 weightFee;
        uint256 minFee;
        uint64 maxWeight;
        address gateway;
        bytes32 genesisHash;
        bool isActive;
    }

    struct Message {
        bytes32 id;
        uint32 sourceChainId;
        uint32 destinationChainId;
        address sender;
        address recipient;
        address asset;
        uint128 amount;
        bytes callData;
        uint64 timestamp;
        uint64 timeout;
        bytes32 hash;
        MessageStatus status;
    }

    struct AssetMapping {
        bytes32 assetId;
        address tokenAddress;
        uint8 decimals;
        bool isNative;
        bool exists;
    }

    mapping(uint32 => ChainConfig) private _chainConfigs;
    mapping(bytes32 => Message) private _messages;
    mapping(uint32 => mapping(bytes32 => bool)) private _executedMessages;
    mapping(address => mapping(uint32 => uint256)) private _nonces;
    
    mapping(uint32 => mapping(bytes32 => address)) private _assetToToken;
    mapping(address => mapping(uint32 => AssetMapping)) private _tokenToAsset;
    mapping(uint32 => EnumerableSet.Bytes32Set) private _chainAssets;

    uint256 private constant MAX_TIMEOUT = 7 days;
    uint256 private constant MIN_TIMEOUT = 1 hours;
    uint64 private constant MAX_WEIGHT = 10000000000;
    uint256 private constant WEIGHT_DENOMINATOR = 1000000;

    event AssetMapped(uint32 indexed chainId, bytes32 indexed assetId, address indexed token, uint8 decimals, bool isNative);
    event AssetUnmapped(uint32 indexed chainId, bytes32 indexed assetId, address indexed token);
    event ChainConfigured(uint32 indexed chainId, string name, address gateway, uint256 baseFee);
    event ChainDeactivated(uint32 indexed chainId);
    event MessageStatusUpdated(bytes32 indexed messageId, MessageStatus status);
    event AssetsTransferred(bytes32 indexed messageId, uint32 indexed chainId, address indexed sender, uint256 assetCount);

    constructor() EIP712("CrossChainExecutor", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(CONFIGURATOR_ROLE, msg.sender);
    }

    function sendXCM(
        XCMInstruction calldata instruction
    ) external payable override nonReentrant returns (bytes32 messageId) {
        ChainConfig storage config = _chainConfigs[instruction.destinationChainId];
        if (!config.isActive) revert ChainNotSupported(instruction.destinationChainId);
        if (instruction.recipient == address(0)) revert InvalidRecipient();
        if (instruction.amount == 0) revert("Zero amount");
        if (instruction.timeout < MIN_TIMEOUT || instruction.timeout > MAX_TIMEOUT) revert("Invalid timeout");
        if (instruction.weight > config.maxWeight) revert("Weight exceeds max");

        uint256 requiredFee = _calculateFee(instruction.destinationChainId, instruction.weight, instruction.amount);
        if (msg.value < requiredFee) revert InsufficientFee(requiredFee, msg.value);

        messageId = _generateMessageId(
            instruction.sender,
            instruction.recipient,
            instruction.asset,
            instruction.amount,
            instruction.destinationChainId,
            _nonces[instruction.sender][instruction.destinationChainId]++
        );

        Message storage message = _messages[messageId];
        message.id = messageId;
        message.sourceChainId = uint32(block.chainid);
        message.destinationChainId = instruction.destinationChainId;
        message.sender = instruction.sender;
        message.recipient = instruction.recipient;
        message.asset = instruction.asset;
        message.amount = instruction.amount;
        message.callData = instruction.callData;
        message.timestamp = uint64(block.timestamp);
        message.timeout = instruction.timeout;
        message.hash = _hashInstruction(instruction);
        message.status = MessageStatus.Pending;

        if (instruction.asset != address(0)) {
            IERC20(instruction.asset).safeTransferFrom(
                instruction.sender,
                address(this),
                instruction.amount
            );
        }

        emit XCMMessagePrepared(
            messageId,
            instruction.destinationChainId,
            instruction.sender,
            instruction.recipient,
            instruction.asset,
            instruction.amount,
            instruction.timeout
        );

        if (msg.value > requiredFee) {
            payable(msg.sender).transfer(msg.value - requiredFee);
        }

        return messageId;
    }

    function sendParachainAssets(
        uint32 parachainId,
        address recipient,
        ParachainAsset[] calldata assets,
        bytes calldata callData,
        uint64 timeout
    ) external payable override returns (bytes32 messageId) {
        if (assets.length == 0) revert("No assets");
        if (recipient == address(0)) revert InvalidRecipient();

        ChainConfig storage config = _chainConfigs[parachainId];
        if (!config.isActive) revert ChainNotSupported(parachainId);

        uint128 totalAmount = 0;
        for (uint i = 0; i < assets.length; i++) {
            ParachainAsset calldata asset = assets[i];
            
            address tokenAddress = _assetToToken[parachainId][asset.assetId];
            if (tokenAddress == address(0)) revert("Asset not mapped");
            
            if (!asset.isNative) {
                IERC20(tokenAddress).safeTransferFrom(
                    msg.sender,
                    address(this),
                    asset.amount
                );
            }
            totalAmount += asset.amount;
        }

        uint64 weight = _calculateParachainWeight(assets.length, callData.length);
        uint128 transactWeight = weight * 2;

        uint256 requiredFee = _calculateFee(parachainId, weight, totalAmount);
        if (msg.value < requiredFee) revert InsufficientFee(requiredFee, msg.value);

        messageId = _generateMessageId(
            msg.sender,
            recipient,
            address(0),
            totalAmount,
            parachainId,
            _nonces[msg.sender][parachainId]++
        );

        Message storage message = _messages[messageId];
        message.id = messageId;
        message.sourceChainId = uint32(block.chainid);
        message.destinationChainId = parachainId;
        message.sender = msg.sender;
        message.recipient = recipient;
        message.asset = address(0);
        message.amount = totalAmount;
        message.callData = abi.encode(assets, callData);
        message.timestamp = uint64(block.timestamp);
        message.timeout = timeout;
        message.hash = keccak256(abi.encode(assets, callData));
        message.status = MessageStatus.Pending;

        emit XCMMessagePrepared(
            messageId,
            parachainId,
            msg.sender,
            recipient,
            address(0),
            totalAmount,
            timeout
        );

        emit AssetsTransferred(messageId, parachainId, msg.sender, assets.length);

        if (msg.value > requiredFee) {
            payable(msg.sender).transfer(msg.value - requiredFee);
        }

        return messageId;
    }

    function executeXCM(
        bytes calldata encodedMessage,
        bytes calldata signature
    ) external override onlyRole(EXECUTOR_ROLE) returns (bool success, bytes memory result) {
        XCMInstruction memory instruction = abi.decode(encodedMessage, (XCMInstruction));
        bytes32 messageId = keccak256(encodedMessage);
        
        Message storage message = _messages[messageId];
        if (message.id == bytes32(0)) revert MessageNotFound(messageId);
        if (message.status != MessageStatus.Pending) revert MessageAlreadyExecuted(messageId);
        if (block.timestamp > message.timestamp + message.timeout) {
            message.status = MessageStatus.Expired;
            emit MessageStatusUpdated(messageId, MessageStatus.Expired);
            revert MessageExpired(messageId);
        }

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(
                XCM_INSTRUCTION_TYPEHASH,
                instruction.destinationChainId,
                instruction.sender,
                instruction.recipient,
                instruction.asset,
                instruction.amount,
                keccak256(instruction.callData),
                instruction.weight,
                instruction.transactWeight,
                instruction.timeout
            ))
        );

        address signer = digest.recover(signature);
        if (signer != instruction.sender) revert("Invalid signature");

        message.status = MessageStatus.Executed;
        _executedMessages[instruction.destinationChainId][messageId] = true;

        if (instruction.asset != address(0)) {
            IERC20(instruction.asset).safeTransfer(instruction.recipient, instruction.amount);
        } else {
            (ParachainAsset[] memory assets, bytes memory originalCallData) = 
                abi.decode(instruction.callData, (ParachainAsset[], bytes));
            
            for (uint i = 0; i < assets.length; i++) {
                ParachainAsset memory asset = assets[i];
                if (!asset.isNative) {
                    address tokenAddress = _assetToToken[instruction.destinationChainId][asset.assetId];
                    if (tokenAddress != address(0)) {
                        IERC20(tokenAddress).safeTransfer(instruction.recipient, asset.amount);
                    }
                }
            }
        }

        emit XCMMessageExecuted(messageId, bytes32(0), true);
        emit MessageStatusUpdated(messageId, MessageStatus.Executed);

        return (true, abi.encode(instruction.recipient, instruction.amount));
    }

    function mapAsset(
        uint32 chainId,
        bytes32 assetId,
        address tokenAddress,
        uint8 decimals,
        bool isNative
    ) external onlyRole(CONFIGURATOR_ROLE) {
        if (tokenAddress == address(0) && !isNative) revert("Invalid token address");
        if (_assetToToken[chainId][assetId] != address(0)) revert("Asset already mapped");
        
        _assetToToken[chainId][assetId] = tokenAddress;
        _tokenToAsset[tokenAddress][chainId] = AssetMapping({
            assetId: assetId,
            tokenAddress: tokenAddress,
            decimals: decimals,
            isNative: isNative,
            exists: true
        });
        
        _chainAssets[chainId].add(assetId);
        
        emit AssetMapped(chainId, assetId, tokenAddress, decimals, isNative);
    }

    function unmapAsset(uint32 chainId, bytes32 assetId) external onlyRole(CONFIGURATOR_ROLE) {
        address tokenAddress = _assetToToken[chainId][assetId];
        if (tokenAddress == address(0) && !_tokenToAsset[address(0)][chainId].exists) {
            revert("Asset not mapped");
        }
        
        delete _assetToToken[chainId][assetId];
        if (tokenAddress != address(0)) {
            delete _tokenToAsset[tokenAddress][chainId];
        } else {
            delete _tokenToAsset[address(0)][chainId];
        }
        
        _chainAssets[chainId].remove(assetId);
        
        emit AssetUnmapped(chainId, assetId, tokenAddress);
    }

    function getTokenForAsset(uint32 chainId, bytes32 assetId) external view returns (address) {
        return _assetToToken[chainId][assetId];
    }

    function getAssetForToken(address token, uint32 chainId) external view returns (bytes32 assetId, bool exists) {
        AssetMapping storage mapping_ = _tokenToAsset[token][chainId];
        return (mapping_.assetId, mapping_.exists);
    }

    function getChainAssets(uint32 chainId) external view returns (bytes32[] memory) {
        return _chainAssets[chainId].values();
    }

    function verifyXCM(
        bytes32 messageId,
        bytes calldata proof
    ) external view override returns (bool isValid, bytes memory decodedMessage) {
        Message storage message = _messages[messageId];
        if (message.id == bytes32(0)) return (false, "");

        bytes32 proofHash = keccak256(proof);
        isValid = (proofHash == message.hash);
        
        if (isValid) {
            decodedMessage = abi.encode(
                message.sender,
                message.recipient,
                message.asset,
                message.amount,
                message.callData
            );
        }

        return (isValid, decodedMessage);
    }

    function getMessageStatus(bytes32 messageId) external view override returns (MessageStatus) {
        return _messages[messageId].status;
    }

    function getMessageDetails(bytes32 messageId) external view override returns (XCMMessage memory) {
        Message storage m = _messages[messageId];
        return XCMMessage({
            id: m.id,
            sourceChainId: m.sourceChainId,
            destinationChainId: m.destinationChainId,
            sender: m.sender,
            recipient: m.recipient,
            asset: m.asset,
            amount: m.amount,
            timestamp: m.timestamp,
            timeout: m.timeout,
            hash: m.hash,
            status: m.status
        });
    }

    function calculateFee(
        uint32 destinationChainId,
        uint64 weight,
        uint256 amount
    ) public view override returns (uint256 fee) {
        return _calculateFee(destinationChainId, weight, amount);
    }

    function cancelMessage(bytes32 messageId) external override returns (bool success) {
        Message storage message = _messages[messageId];
        if (message.sender != msg.sender && !hasRole(RELAYER_ROLE, msg.sender)) {
            revert("Not authorized");
        }
        if (message.status != MessageStatus.Pending) revert("Cannot cancel");
        if (block.timestamp > message.timestamp + message.timeout) {
            message.status = MessageStatus.Expired;
            revert MessageExpired(messageId);
        }

        message.status = MessageStatus.Cancelled;

        if (message.asset != address(0)) {
            IERC20(message.asset).safeTransfer(message.sender, message.amount);
        } else {
            (ParachainAsset[] memory assets,) = abi.decode(message.callData, (ParachainAsset[], bytes));
            for (uint i = 0; i < assets.length; i++) {
                if (!assets[i].isNative) {
                    address tokenAddress = _assetToToken[message.destinationChainId][assets[i].assetId];
                    if (tokenAddress != address(0)) {
                        IERC20(tokenAddress).safeTransfer(message.sender, assets[i].amount);
                    }
                }
            }
        }

        emit XCMMessageCancelled(messageId);
        emit MessageStatusUpdated(messageId, MessageStatus.Cancelled);

        return true;
    }

    function processExpiredMessages(bytes32[] calldata messageIds) external override onlyRole(RELAYER_ROLE) {
        for (uint i = 0; i < messageIds.length; i++) {
            Message storage message = _messages[messageIds[i]];
            if (message.status == MessageStatus.Pending && 
                block.timestamp > message.timestamp + message.timeout) {
                message.status = MessageStatus.Expired;
                emit XCMMessageExpired(messageIds[i]);
                emit MessageStatusUpdated(messageIds[i], MessageStatus.Expired);
            }
        }
    }

    function _calculateFee(
        uint32 destinationChainId,
        uint64 weight,
        uint256 /* amount */
    ) private view returns (uint256) {
        ChainConfig storage config = _chainConfigs[destinationChainId];
        if (!config.isActive) return type(uint256).max;

        uint256 weightFee = (config.weightFee * weight) / WEIGHT_DENOMINATOR;
        uint256 totalFee = config.baseFee + weightFee;
        
        if (totalFee < config.minFee) {
            totalFee = config.minFee;
        }

        return totalFee;
    }

    function _generateMessageId(
        address sender,
        address recipient,
        address asset,
        uint256 amount,
        uint32 destinationChainId,
        uint256 nonce
    ) private view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                sender,
                recipient,
                asset,
                amount,
                destinationChainId,
                block.chainid,
                nonce,
                block.timestamp
            )
        );
    }

    function _hashInstruction(XCMInstruction memory instruction) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                instruction.destinationChainId,
                instruction.sender,
                instruction.recipient,
                instruction.asset,
                instruction.amount,
                keccak256(instruction.callData),
                instruction.weight,
                instruction.transactWeight,
                instruction.timeout
            )
        );
    }

    function _calculateParachainWeight(
        uint256 assetsLength,
        uint256 callDataLength
    ) private pure returns (uint64) {
        uint64 baseWeight = 100000000;
        uint64 assetWeight = uint64(assetsLength) * 1000000;
        uint64 dataWeight = uint64(callDataLength) * 100;
        return baseWeight + assetWeight + dataWeight;
    }

    function configureChain(
        uint32 chainId,
        string calldata name,
        uint256 baseFee,
        uint256 weightFee,
        uint256 minFee,
        uint64 maxWeight,
        address gateway,
        bytes32 genesisHash
    ) external onlyRole(CONFIGURATOR_ROLE) {
        if (gateway == address(0)) revert("Invalid gateway");
        if (maxWeight > MAX_WEIGHT) revert("Max weight too high");

        _chainConfigs[chainId] = ChainConfig({
            chainId: chainId,
            name: name,
            baseFee: baseFee,
            weightFee: weightFee,
            minFee: minFee,
            maxWeight: maxWeight,
            gateway: gateway,
            genesisHash: genesisHash,
            isActive: true
        });

        emit ChainConfigured(chainId, name, gateway, baseFee);
    }

    function deactivateChain(uint32 chainId) external onlyRole(CONFIGURATOR_ROLE) {
        _chainConfigs[chainId].isActive = false;
        emit ChainDeactivated(chainId);
    }

    function getChainConfig(uint32 chainId) external view returns (ChainConfig memory) {
        return _chainConfigs[chainId];
    }

    function getNonce(address sender, uint32 destinationChainId) external view returns (uint256) {
        return _nonces[sender][destinationChainId];
    }

    function getChainAssetCount(uint32 chainId) external view returns (uint256) {
        return _chainAssets[chainId].length();
    }
}