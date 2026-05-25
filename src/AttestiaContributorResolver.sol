// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SchemaResolver} from "@ethereum-attestation-service/eas-contracts/contracts/resolver/SchemaResolver.sol";
import {IEAS} from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import {Attestation} from "@ethereum-attestation-service/eas-contracts/contracts/Common.sol";

interface IAttestiaRegistryContributor {
    function onContributorMediaAttested(
        bytes32 uid,
        address contributor,
        bytes32 contentHash,
        string calldata mediaUri,
        string calldata mediaContext,
        string calldata contentType,
        uint64 verificationDeadline
    ) external payable;
}

/// @title AttestiaContributorResolver
/// @notice EAS schema resolver for contributor media attestations.
/// @dev Submitters are not registered on-chain; forwards media metadata to `AttestiaRegistry`.
contract AttestiaContributorResolver is SchemaResolver {
    IAttestiaRegistryContributor public immutable registry;

    error ZeroAddress();

    event ContributorAttestationAccepted(bytes32 indexed uid, address indexed contributor, bytes32 indexed contentHash);

    constructor(IEAS eas, address registryContract) SchemaResolver(eas) {
        if (registryContract == address(0)) revert ZeroAddress();
        registry = IAttestiaRegistryContributor(registryContract);
    }

    function isPayable() public pure override returns (bool) {
        return true;
    }

    function onAttest(Attestation calldata attestation, uint256 value)
        internal
        override
        returns (bool)
    {
        (bytes32 contentHash, string memory mediaUri, string memory mediaContext, string memory contentType, uint64 verificationDeadline) =
            abi.decode(attestation.data, (bytes32, string, string, string, uint64));

        registry.onContributorMediaAttested{value: value}(
            attestation.uid, attestation.attester, contentHash, mediaUri, mediaContext, contentType, verificationDeadline
        );

        emit ContributorAttestationAccepted(attestation.uid, attestation.attester, contentHash);
        return true;
    }

    function onRevoke(Attestation calldata attestation, uint256 /*value*/)
        internal
        view
        override
        returns (bool)
    {
        attestation;
        return true;
    }
}
