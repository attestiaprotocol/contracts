// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Six-decimal test USDC for dev/testnets. Only the owner may mint.
contract TestUSDC is ERC20, Ownable {
    constructor(address initialOwner) ERC20("Test USDC", "tUSDC") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint tokens to `to`. Caller must be the contract owner (deployer by default).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
