// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SchemaResolver} from "@ethereum-attestation-service/eas-contracts/contracts/resolver/SchemaResolver.sol";
import {IEAS} from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import {Attestation} from "@ethereum-attestation-service/eas-contracts/contracts/Common.sol";

interface IAttestiaStakePerformance {
    function processAggregateScores(bytes32 aggregateUid, address[] calldata verifiers, uint16[] calldata scores)
        external;
}

/// @title AttestiaAggregateResolver
/// @notice EAS schema resolver for the on-chain aggregate attestation: only `authorizedAttester` may attest.
/// @dev `authorizedAttester` is set once to `msg.sender` at deployment (deploy the resolver from that key).
contract AttestiaAggregateResolver is SchemaResolver {
    address public immutable authorizedAttester;
    IAttestiaStakePerformance public immutable stake;

    error UnauthorizedAttester();
    error ZeroAddress();
    error InvalidScoreVectors();

    event AggregateAccepted(bytes32 indexed aggregateUid, address indexed attester);
    event ReviewerScoresPublished(bytes32 indexed aggregateUid, uint256 verifierCount);

    constructor(IEAS eas, address stakeContract) SchemaResolver(eas) {
        if (stakeContract == address(0)) revert ZeroAddress();
        authorizedAttester = msg.sender;
        stake = IAttestiaStakePerformance(stakeContract);
    }

    function onAttest(Attestation calldata attestation, uint256 /*value*/)
        internal
        override
        returns (bool)
    {
        if (attestation.attester != authorizedAttester) {
            revert UnauthorizedAttester();
        }

        (
            ,
            ,
            uint32 numVerifiers,
            ,
            ,
            ,
            address[] memory verifiers,
            uint16[] memory scores
        ) = abi.decode(attestation.data, (bytes32, uint256, uint32, uint32, bytes32, bytes32, address[], uint16[]));

        if (verifiers.length != numVerifiers || scores.length != numVerifiers) revert InvalidScoreVectors();

        stake.processAggregateScores(attestation.uid, verifiers, scores);
        emit AggregateAccepted(attestation.uid, attestation.attester);
        emit ReviewerScoresPublished(attestation.uid, verifiers.length);
        return true;
    }

    function onRevoke(Attestation calldata attestation, uint256 /*value*/)
        internal
        view
        override
        returns (bool)
    {
        if (attestation.attester != authorizedAttester) revert UnauthorizedAttester();
        return true;
    }
}
