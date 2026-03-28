// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AttestiaStake} from "./AttestiaStake.sol";

/// @title AttestiaRegistry — on-chain media handles for the Attestia Protocol (Base)
/// @dev Registered submitters lock a fixed per-media stake on submission.
contract AttestiaRegistry {
    uint256 public constant CONTRIBUTOR_MEDIA_STAKE = 0.05 ether;
    uint16 public constant CONTRIBUTOR_REFUND_BPS = 9_000; // 90%
    uint64 public constant VERIFICATION_WINDOW = 12 hours;

    AttestiaStake public immutable stake;

    struct Media {
        address owner;
        bytes32 contentHash;
        string uri;
        uint64 createdAt;
        uint64 verificationDeadline;
        uint256 contributorStake;
        uint256 refundedAmount;
        uint256 networkFeeAmount;
        uint32 numScoresProvided;
        bool stakeSettled;
        bytes32 easAttestationUid;
    }

    uint256 public nextAssetId;
    uint256 public accruedNetworkFees;
    mapping(uint256 assetId => Media) private _media;
    uint256 private _locked;

    event MediaRegistered(uint256 indexed assetId, address indexed owner, bytes32 indexed contentHash, string uri);
    event MediaFinalized(
        uint256 indexed assetId,
        bytes32 indexed easAttestationUid,
        uint32 numScoresProvided,
        uint256 refundedAmount,
        uint256 networkFeeAmount
    );

    error NotMediaOwner();
    error UnknownAsset();
    error AlreadyFinalized();
    error NotRegisteredSubmitter();
    error InvalidContributorStake();
    error VerificationDeadlineNotReached();
    error TransferFailed();
    error ReentrantCall();

    constructor(AttestiaStake _stake) {
        stake = _stake;
    }

    modifier nonReentrant() {
        if (_locked == 1) revert ReentrantCall();
        _locked = 1;
        _;
        _locked = 0;
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

    /// @notice Register a media item with fixed 0.05 ETH contributor stake escrow.
    function registerMedia(bytes32 contentHash, string calldata uri)
        external
        payable
        onlySubmitter
        returns (uint256 assetId)
    {
        if (msg.value != CONTRIBUTOR_MEDIA_STAKE) revert InvalidContributorStake();
        uint64 nowTs = uint64(block.timestamp);
        assetId = ++nextAssetId;
        _media[assetId] = Media({
            owner: msg.sender,
            contentHash: contentHash,
            uri: uri,
            createdAt: nowTs,
            verificationDeadline: nowTs + VERIFICATION_WINDOW,
            contributorStake: msg.value,
            refundedAmount: 0,
            networkFeeAmount: 0,
            numScoresProvided: 0,
            stakeSettled: false,
            easAttestationUid: bytes32(0)
        });
        emit MediaRegistered(assetId, msg.sender, contentHash, uri);
    }

    function getMedia(uint256 assetId) external view returns (Media memory) {
        if (_media[assetId].owner == address(0)) revert UnknownAsset();
        return _media[assetId];
    }

    /// @notice Finalize with aggregate UID and settle contributor stake after deadline.
    function finalizeWithEAS(uint256 assetId, bytes32 easAttestationUid, uint32 numScoresProvided)
        external
        nonReentrant
        onlyAssetOwner(assetId)
    {
        Media storage m = _media[assetId];
        if (m.easAttestationUid != bytes32(0)) revert AlreadyFinalized();
        if (block.timestamp < m.verificationDeadline) revert VerificationDeadlineNotReached();
        m.easAttestationUid = easAttestationUid;
        m.numScoresProvided = numScoresProvided;
        m.stakeSettled = true;

        uint256 refund = m.contributorStake;
        uint256 fee;
        if (numScoresProvided > 0) {
            refund = (m.contributorStake * CONTRIBUTOR_REFUND_BPS) / 10_000;
            fee = m.contributorStake - refund;
            accruedNetworkFees += fee;
        }

        m.refundedAmount = refund;
        m.networkFeeAmount = fee;

        (bool ok,) = payable(m.owner).call{value: refund}("");
        if (!ok) revert TransferFailed();

        emit MediaFinalized(assetId, easAttestationUid, numScoresProvided, refund, fee);
    }
}
