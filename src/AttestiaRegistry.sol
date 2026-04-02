// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AttestiaStake} from "./AttestiaStake.sol";

/// @title AttestiaRegistry — on-chain media handles for the Attestia Protocol (Base)
/// @dev Registered submitters lock a fixed per-media stake on submission.
contract AttestiaRegistry {
    uint16 public constant CONTRIBUTOR_REFUND_BPS = 9_000; // 90%
    uint256 public contributorMediaStake = 0.01 ether;
    uint64 public verificationWindow = 15 minutes;

    AttestiaStake public immutable stake;
    IEAS public immutable eas;
    address public governance;

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
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);
    event VerificationWindowSet(uint64 previousWindow, uint64 newWindow);
    event ContributorStakeSet(uint256 previousStake, uint256 newStake);

    error NotMediaOwner();
    error NotGovernance();
    error UnknownAsset();
    error AlreadyFinalized();
    error NotRegisteredSubmitter();
    error InvalidContributorStake();
    error ZeroAddress();
    error InvalidVerificationWindow();
    error VerificationDeadlineNotReached();
    error TransferFailed();
    error ReentrantCall();
    error InvalidAggregateAttestation();
    error InvalidAggregateVectors();

    constructor(AttestiaStake _stake, IEAS _eas) {
        stake = _stake;
        eas = _eas;
        governance = msg.sender;
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

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    function transferGovernance(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        emit GovernanceTransferred(governance, newGovernance);
        governance = newGovernance;
    }

    function setVerificationWindow(uint64 newVerificationWindow) external onlyGovernance {
        if (newVerificationWindow == 0) revert InvalidVerificationWindow();
        uint64 previous = verificationWindow;
        verificationWindow = newVerificationWindow;
        emit VerificationWindowSet(previous, newVerificationWindow);
    }

    function setContributorMediaStake(uint256 newStake) external onlyGovernance {
        if (newStake == 0) revert InvalidContributorStake();
        uint256 previous = contributorMediaStake;
        contributorMediaStake = newStake;
        emit ContributorStakeSet(previous, newStake);
    }

    /// @notice Register a media item with contributor stake escrow.
    function registerMedia(bytes32 contentHash, string calldata uri)
        external
        payable
        onlySubmitter
        returns (uint256 assetId)
    {
        if (msg.value != contributorMediaStake) revert InvalidContributorStake();
        uint64 nowTs = uint64(block.timestamp);
        assetId = ++nextAssetId;
        _media[assetId] = Media({
            owner: msg.sender,
            contentHash: contentHash,
            uri: uri,
            createdAt: nowTs,
            verificationDeadline: nowTs + verificationWindow,
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
    function finalizeWithEAS(uint256 assetId, bytes32 easAttestationUid)
        external
        nonReentrant
        onlyAssetOwner(assetId)
    {
        Media storage m = _media[assetId];
        if (m.easAttestationUid != bytes32(0)) revert AlreadyFinalized();
        if (block.timestamp < m.verificationDeadline) revert VerificationDeadlineNotReached();

        uint32 numScoresProvided = _numScoresFromAggregateAttestation(m.contentHash, easAttestationUid);

        m.easAttestationUid = easAttestationUid;
        m.numScoresProvided = numScoresProvided;
        m.stakeSettled = true;

        uint256 refund = m.contributorStake;
        uint256 fee;
        if (numScoresProvided > 0) {
            refund = (m.contributorStake * CONTRIBUTOR_REFUND_BPS) / 10_000;
            fee = m.contributorStake - refund;
            accruedNetworkFees += fee;
            stake.depositContributorFees{value: fee}();
        }

        m.refundedAmount = refund;
        m.networkFeeAmount = fee;

        (bool ok,) = payable(m.owner).call{value: refund}("");
        if (!ok) revert TransferFailed();

        emit MediaFinalized(assetId, easAttestationUid, numScoresProvided, refund, fee);
    }

    function _numScoresFromAggregateAttestation(bytes32 contentHash, bytes32 uid) internal view returns (uint32) {
        IEAS.Attestation memory a = eas.getAttestation(uid);
        if (a.uid == bytes32(0)) revert InvalidAggregateAttestation();
        if (a.data.length == 0) revert InvalidAggregateAttestation();

        (
            bytes32 attestedContentHash,
            uint256 aggregateScore,
            uint32 numVerifiers,
            uint32 confidenceBps,
            bytes32 payloadHash,
            bytes32 proofCommitment,
            address[] memory verifiers,
            uint16[] memory scores
        ) = abi.decode(a.data, (bytes32, uint256, uint32, uint32, bytes32, bytes32, address[], uint16[]));

        // Silence unused locals (kept for schema compatibility / forward-proofing).
        aggregateScore;
        confidenceBps;
        payloadHash;
        proofCommitment;

        if (attestedContentHash != contentHash) revert InvalidAggregateAttestation();
        if (verifiers.length != scores.length) revert InvalidAggregateVectors();
        if (verifiers.length != uint256(numVerifiers)) revert InvalidAggregateVectors();

        return numVerifiers;
    }
}

interface IEAS {
    struct Attestation {
        bytes32 uid;
        bytes32 schema;
        uint64 time;
        uint64 expirationTime;
        uint64 revocationTime;
        bytes32 refUID;
        address recipient;
        address attester;
        bool revocable;
        bytes data;
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory);
}
