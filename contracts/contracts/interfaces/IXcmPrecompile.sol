// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IXcmPrecompile
 * @notice Interface for the XCM precompile on Polkadot Hub.
 *         Deployed at: 0x00000000000000000000000000000000000a0000
 */
interface IXcmPrecompile {
    struct Weight {
        uint64 refTime;
        uint64 proofSize;
    }

    /// @notice Send an XCM message to a destination chain.
    /// @param destination SCALE-encoded MultiLocation of the destination.
    /// @param message     SCALE-encoded VersionedXcm message.
    function xcmSend(bytes calldata destination, bytes calldata message) external;

    /// @notice Execute an XCM message locally (same chain).
    function xcmExecute(bytes calldata message, Weight calldata weight) external;

    /// @notice Estimate the weight of an XCM message (view).
    function weighMessage(bytes calldata message) external view returns (Weight memory weight);
}
