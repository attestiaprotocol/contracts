// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISchemaResolver} from "@ethereum-attestation-service/eas-contracts/contracts/resolver/ISchemaResolver.sol";
import {Attestation} from "@ethereum-attestation-service/eas-contracts/contracts/Common.sol";

/// @dev Invokes a schema resolver with `msg.sender` = this contract (mimics the real EAS contract).
contract FakeEAS {
    function attest(ISchemaResolver resolver, Attestation calldata attestation) external payable returns (bool) {
        return resolver.attest{value: msg.value}(attestation);
    }
}
