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
    address public contributorResolver;

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

    struct ContributorMediaAttestation {
        uint256 assetId;
        address contributor;
        bytes32 contentHash;
        string mediaUri;
        string mediaContext;
        uint64 verificationDeadline;
        uint64 attestedAt;
        bool exists;
    }

    uint256 public nextAssetId;
    uint256 public accruedNetworkFees;
    mapping(uint256 assetId => Media) private _media;
    mapping(bytes32 uid => ContributorMediaAttestation) private _contributorMediaAttestations;
    mapping(address contributor => bytes32[]) private _contributorAttestationUids;
    mapping(bytes32 uid => uint256 assetId) private _assetIdByContributorAttestation;
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
    event ContributorResolverSet(address indexed previousResolver, address indexed newResolver);
    event ContributorMediaAttested(
        bytes32 indexed uid,
        uint256 indexed assetId,
        address indexed contributor,
        bytes32 contentHash,
        string mediaUri,
        string mediaContext,
        uint64 verificationDeadline
    );
    event VerificationWindowSet(uint64 previousWindow, uint64 newWindow);
    event ContributorStakeSet(uint256 previousStake, uint256 newStake);

    error NotMediaOwner();
    error NotGovernance();
    error NotContributorResolver();
    error UnknownAsset();
    error UnknownContributorAttestation();
    error ContributorAttestationAlreadyRecorded();
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
    error UnknownContributorAttestationUid();

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

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier onlyContributorResolver() {
        if (msg.sender != contributorResolver) revert NotContributorResolver();
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

    function setContributorResolver(address newResolver) external onlyGovernance {
        if (newResolver == address(0)) revert ZeroAddress();
        emit ContributorResolverSet(contributorResolver, newResolver);
        contributorResolver = newResolver;
    }

    function setContributorMediaStake(uint256 newStake) external onlyGovernance {
        if (newStake == 0) revert InvalidContributorStake();
        uint256 previous = contributorMediaStake;
        contributorMediaStake = newStake;
        emit ContributorStakeSet(previous, newStake);
    }

    function getMedia(uint256 assetId) external view returns (Media memory) {
        if (_media[assetId].owner == address(0)) revert UnknownAsset();
        return _media[assetId];
    }

    function isRegisteredContributor(address contributor) external view returns (bool) {
        return stake.isSubmitter(contributor);
    }

    function onContributorMediaAttested(
        bytes32 uid,
        address contributor,
        bytes32 contentHash,
        string calldata mediaUri,
        string calldata mediaContext,
        uint64 verificationDeadline
    ) external payable onlyContributorResolver {
        if (!stake.isSubmitter(contributor)) revert NotRegisteredSubmitter();
        if (msg.value != contributorMediaStake) revert InvalidContributorStake();
        if (_assetIdByContributorAttestation[uid] != 0) revert ContributorAttestationAlreadyRecorded();

        uint64 nowTs = uint64(block.timestamp);
        uint64 effectiveVerificationDeadline = nowTs + verificationWindow;
        uint256 assetId = ++nextAssetId;

        _media[assetId] = Media({
            owner: contributor,
            contentHash: contentHash,
            uri: mediaUri,
            createdAt: nowTs,
            verificationDeadline: effectiveVerificationDeadline,
            contributorStake: msg.value,
            refundedAmount: 0,
            networkFeeAmount: 0,
            numScoresProvided: 0,
            stakeSettled: false,
            easAttestationUid: bytes32(0)
        });
        _assetIdByContributorAttestation[uid] = assetId;

        _contributorMediaAttestations[uid] = ContributorMediaAttestation({
            assetId: assetId,
            contributor: contributor,
            contentHash: contentHash,
            mediaUri: mediaUri,
            mediaContext: mediaContext,
            verificationDeadline: verificationDeadline,
            attestedAt: uint64(block.timestamp),
            exists: true
        });
        _contributorAttestationUids[contributor].push(uid);

        emit MediaRegistered(assetId, contributor, contentHash, mediaUri);
        emit ContributorMediaAttested(uid, assetId, contributor, contentHash, mediaUri, mediaContext, verificationDeadline);
    }

    function getContributorMediaAttestation(bytes32 uid) external view returns (ContributorMediaAttestation memory) {
        ContributorMediaAttestation memory a = _contributorMediaAttestations[uid];
        if (!a.exists) revert UnknownContributorAttestation();
        return a;
    }

    function contributorMediaAttestationsLength(address contributor) external view returns (uint256) {
        return _contributorAttestationUids[contributor].length;
    }

    function contributorMediaAttestationUidAt(address contributor, uint256 index) external view returns (bytes32) {
        return _contributorAttestationUids[contributor][index];
    }

    function assetIdByContributorAttestation(bytes32 uid) external view returns (uint256) {
        return _assetIdByContributorAttestation[uid];
    }

    /// @notice Finalize with aggregate UID and settle contributor stake after deadline.
    function finalizeWithEAS(uint256 assetId, bytes32 easAttestationUid)
        external
        nonReentrant
    {
        _finalizeWithEAS(assetId, easAttestationUid);
    }

    /// @notice Finalize with contributor attestation UID and settle contributor stake after deadline.
    function finalizeWithEASByContributorUid(bytes32 contributorAttestationUid, bytes32 easAttestationUid)
        external
        nonReentrant
    {
        uint256 assetId = _assetIdByContributorAttestation[contributorAttestationUid];
        if (assetId == 0) revert UnknownContributorAttestationUid();
        _finalizeWithEAS(assetId, easAttestationUid);
    }

    /// @notice Finalize with no aggregate UID and return full contributor stake after deadline.
    /// @dev Intended for rounds where no verifier scores were submitted on-chain.
    function finalizeWithoutEAS(uint256 assetId) external nonReentrant {
        _finalizeWithoutEAS(assetId);
    }

    /// @notice Finalize with contributor attestation UID and no aggregate UID after deadline.
    function finalizeWithoutEASByContributorUid(bytes32 contributorAttestationUid) external nonReentrant {
        uint256 assetId = _assetIdByContributorAttestation[contributorAttestationUid];
        if (assetId == 0) revert UnknownContributorAttestationUid();
        _finalizeWithoutEAS(assetId);
    }

    function _finalizeWithEAS(uint256 assetId, bytes32 easAttestationUid) internal onlyAssetOwner(assetId) {
        Media storage m = _media[assetId];
        if (m.easAttestationUid != bytes32(0)) revert AlreadyFinalized();
        if (m.stakeSettled) revert AlreadyFinalized();
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

    function _finalizeWithoutEAS(uint256 assetId) internal onlyAssetOwner(assetId) {
        Media storage m = _media[assetId];
        if (m.easAttestationUid != bytes32(0)) revert AlreadyFinalized();
        if (m.stakeSettled) revert AlreadyFinalized();
        if (block.timestamp < m.verificationDeadline) revert VerificationDeadlineNotReached();

        uint256 refund = m.contributorStake;
        m.numScoresProvided = 0;
        m.stakeSettled = true;
        m.refundedAmount = refund;
        m.networkFeeAmount = 0;

        (bool ok,) = payable(m.owner).call{value: refund}("");
        if (!ok) revert TransferFailed();

        emit MediaFinalized(assetId, bytes32(0), 0, refund, 0);
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
