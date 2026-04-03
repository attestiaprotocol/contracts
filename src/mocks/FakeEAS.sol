// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISchemaResolver} from "@ethereum-attestation-service/eas-contracts/contracts/resolver/ISchemaResolver.sol";
import {Attestation} from "@ethereum-attestation-service/eas-contracts/contracts/Common.sol";

/// @dev Invokes a schema resolver with `msg.sender` = this contract (mimics the real EAS contract).
contract FakeEAS {
    mapping(bytes32 uid => Attestation) private _attestations;

    function attest(ISchemaResolver resolver, Attestation calldata attestation) external payable returns (bool) {
        bool ok = resolver.attest{value: msg.value}(attestation);
        _attestations[attestation.uid] = attestation;
        return ok;
    }

    function setAttestation(Attestation calldata attestation) external {
        _attestations[attestation.uid] = attestation;
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        return _attestations[uid];
    }
}
