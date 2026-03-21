// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SchemaResolver} from "@ethereum-attestation-service/eas-contracts/contracts/resolver/SchemaResolver.sol";
import {IEAS} from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import {Attestation} from "@ethereum-attestation-service/eas-contracts/contracts/Common.sol";

/// @title AttestiaAggregateResolver
/// @notice EAS schema resolver for the on-chain aggregate attestation: only `authorizedAttester` may attest.
/// @dev `authorizedAttester` is set once to `msg.sender` at deployment (deploy the resolver from that key).
contract AttestiaAggregateResolver is SchemaResolver {
    address public immutable authorizedAttester;

    error UnauthorizedAttester();

    constructor(IEAS eas) SchemaResolver(eas) {
        authorizedAttester = msg.sender;
    }

    function onAttest(Attestation calldata attestation, uint256 /*value*/)
        internal
        view
        override
        returns (bool)
    {
        if (attestation.attester != authorizedAttester) {
            revert UnauthorizedAttester();
        }
        return true;
    }

    function onRevoke(Attestation calldata /*attestation*/, uint256 /*value*/)
        internal
        pure
        override
        returns (bool)
    {
        return true;
    }
}
