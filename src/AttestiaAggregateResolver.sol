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
    mapping(bytes32 => bool) public aggregateAccepted;
    mapping(bytes32 => bool) public aggregateProcessed;

    error UnauthorizedAttester();
    error ZeroAddress();
    error UnknownAggregateUid();
    error AggregateAlreadyProcessed();

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
        aggregateAccepted[attestation.uid] = true;
        emit AggregateAccepted(attestation.uid, attestation.attester);
        return true;
    }

    /// @notice Publishes reviewer wallet-score pairs and triggers reward/slashing in AttestiaStake.
    function publishReviewerScores(bytes32 aggregateUid, address[] calldata verifiers, uint16[] calldata scores)
        external
    {
        if (msg.sender != authorizedAttester) revert UnauthorizedAttester();
        if (!aggregateAccepted[aggregateUid]) revert UnknownAggregateUid();
        if (aggregateProcessed[aggregateUid]) revert AggregateAlreadyProcessed();
        aggregateProcessed[aggregateUid] = true;
        stake.processAggregateScores(aggregateUid, verifiers, scores);
        emit ReviewerScoresPublished(aggregateUid, verifiers.length);
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
