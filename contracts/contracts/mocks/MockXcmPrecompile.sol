// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title MockXcmPrecompile
 * @notice Deployed at 0x00000000000000000000000000000000000a0000
 *         in Hardhat tests via hardhat_setCode.
 *         Records xcmSend calls and can be told to revert.
 */
contract MockXcmPrecompile {
    struct Weight {
        uint64 refTime;
        uint64 proofSize;
    }

    struct LastSend {
        bytes destination;
        bytes message;
    }

    LastSend public lastSend;
    uint256  public sendCallCount;
    bool     public shouldRevert;

    function setShouldRevert(bool _revert) external {
        shouldRevert = _revert;
    }

    function xcmSend(bytes calldata destination, bytes calldata message) external {
        if (shouldRevert) revert("MockXcmPrecompile: forced revert");
        lastSend = LastSend({ destination: destination, message: message });
        sendCallCount++;
    }

    function xcmExecute(bytes calldata /*message*/, Weight calldata /*weight*/) external view {
        if (shouldRevert) revert("MockXcmPrecompile: forced revert");
    }

    function weighMessage(bytes calldata /*message*/) external pure returns (Weight memory) {
        return Weight({ refTime: 400_000_000, proofSize: 8_192 });
    }
}
