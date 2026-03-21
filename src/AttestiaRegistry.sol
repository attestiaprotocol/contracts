// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AttestiaStake} from "./AttestiaStake.sol";

/// @title AttestiaRegistry — on-chain media handles for the Attestia Protocol (Base)
/// @dev Only registered submitters (`AttestiaStake`) may register media. Pair with off-chain scores + EAS.
contract AttestiaRegistry {
    AttestiaStake public immutable stake;

    struct Media {
        address owner;
        bytes32 contentHash;
        string uri;
        uint64 createdAt;
        bytes32 easAttestationUid;
    }

    uint256 public nextAssetId;
    mapping(uint256 assetId => Media) private _media;

    event MediaRegistered(uint256 indexed assetId, address indexed owner, bytes32 indexed contentHash, string uri);
    event MediaFinalized(uint256 indexed assetId, bytes32 indexed easAttestationUid);

    error NotMediaOwner();
    error UnknownAsset();
    error AlreadyFinalized();
    error NotRegisteredSubmitter();

    constructor(AttestiaStake _stake) {
        stake = _stake;
    }

    modifier onlyAssetOwner(uint256 assetId) {
        if (_media[assetId].owner == address(0)) revert UnknownAsset();
        if (msg.sender != _media[assetId].owner) revert NotMediaOwner();
        _;
    }

    modifier onlySubmitter() {
        if (!stake.isSubmitter(msg.sender)) revert NotRegisteredSubmitter();
        _;
    }

    /// @notice Register a media item (must be a staked, registered submitter).
    function registerMedia(bytes32 contentHash, string calldata uri)
        external
        onlySubmitter
        returns (uint256 assetId)
    {
        assetId = ++nextAssetId;
        _media[assetId] = Media({
            owner: msg.sender,
            contentHash: contentHash,
            uri: uri,
            createdAt: uint64(block.timestamp),
            easAttestationUid: bytes32(0)
        });
        emit MediaRegistered(assetId, msg.sender, contentHash, uri);
    }

    function getMedia(uint256 assetId) external view returns (Media memory) {
        if (_media[assetId].owner == address(0)) revert UnknownAsset();
        return _media[assetId];
    }

    function finalizeWithEAS(uint256 assetId, bytes32 easAttestationUid) external onlyAssetOwner(assetId) {
        Media storage m = _media[assetId];
        if (m.easAttestationUid != bytes32(0)) revert AlreadyFinalized();
        m.easAttestationUid = easAttestationUid;
        emit MediaFinalized(assetId, easAttestationUid);
    }
}
