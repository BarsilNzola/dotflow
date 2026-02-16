// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IXCM {
    struct XCMInstruction {
        uint32 destinationChainId;
        address sender;
        address recipient;
        address asset;
        uint128 amount;
        bytes callData;
        uint64 weight;
        uint128 transactWeight;
        uint64 timeout;
    }
    
    struct ParachainAsset {
        bytes32 assetId;
        uint128 amount;
        bool isNative;
    }
    
    struct XCMMessage {
        bytes32 id;
        uint32 sourceChainId;
        uint32 destinationChainId;
        address sender;
        address recipient;
        address asset;
        uint128 amount;
        uint64 timestamp;
        uint64 timeout;
        bytes32 hash;
        MessageStatus status;
    }
    
    enum MessageStatus {
        Pending,
        Executed,
        Failed,
        Cancelled,
        Expired
    }
    
    error ChainNotSupported(uint32 chainId);
    error InsufficientFee(uint256 required, uint256 provided);
    error MessageExpired(bytes32 messageId);
    error MessageAlreadyExecuted(bytes32 messageId);
    error MessageNotFound(bytes32 messageId);
    error InvalidRecipient();
    error AssetTransferFailed();
    
    event XCMMessagePrepared(
        bytes32 indexed messageId,
        uint32 indexed destinationChainId,
        address indexed sender,
        address recipient,
        address asset,
        uint256 amount,
        uint64 timeout
    );
    
    event XCMMessageExecuted(
        bytes32 indexed messageId,
        bytes32 indexed transactionHash,
        bool success
    );
    
    event XCMMessageFailed(
        bytes32 indexed messageId,
        bytes reason
    );
    
    event XCMMessageExpired(bytes32 indexed messageId);
    event XCMMessageCancelled(bytes32 indexed messageId);
    
    function sendXCM(
        XCMInstruction calldata instruction
    ) external payable returns (bytes32 messageId);
    
    function sendParachainAssets(
        uint32 parachainId,
        address recipient,
        ParachainAsset[] calldata assets,
        bytes calldata callData,
        uint64 timeout
    ) external payable returns (bytes32 messageId);
    
    function executeXCM(
        bytes calldata encodedMessage,
        bytes calldata signature
    ) external returns (bool success, bytes memory result);
    
    function verifyXCM(
        bytes32 messageId,
        bytes calldata proof
    ) external view returns (bool isValid, bytes memory decodedMessage);
    
    function getMessageStatus(bytes32 messageId) external view returns (MessageStatus);
    
    function getMessageDetails(bytes32 messageId) external view returns (XCMMessage memory);
    
    function calculateFee(
        uint32 destinationChainId,
        uint64 weight,
        uint256 amount
    ) external view returns (uint256 fee);
    
    function cancelMessage(bytes32 messageId) external returns (bool success);
    
    function processExpiredMessages(bytes32[] calldata messageIds) external;
}