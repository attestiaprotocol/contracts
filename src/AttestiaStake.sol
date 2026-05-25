// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AttestiaStake — stake, attester signup, slashing, rewards (Base)
/// @dev Only attesters are registered on-chain. Submitters are handled off-chain.
contract AttestiaStake {
    enum ParticipantRole {
        None,
        Attester
    }

    address public owner;
    address public performanceReporter;
    address public registry;
    uint256 public minStake;
    uint256 public baseRewardPerRound;
    uint256 public rewardPoolWei;
    uint256 public totalPendingRewardsWei;

    mapping(address => uint256) public staked;
    mapping(address => uint256) public pendingRewards;
    mapping(address => uint256) public slashAccumulator;
    mapping(address => ParticipantRole) public roleOf;

    uint64 public currentRoundId;

    uint16 public constant BPS = 10_000;
    uint16 public phase0RewardBps = 5_000;
    uint16 public phase1RewardBps = 8_000;
    uint16 public phase2RewardBps = 10_000;

    uint16 public phase1DeviationThresholdBps = 2_500; // 0.25
    uint16 public phase2DeviationThresholdBps = 2_000; // 0.20
    uint256 public phase1VarianceThresholdBps2 = 2_000_000; // 0.02 on [0,1] scores
    uint16 public phase1SlashBps = 1_000; // 10%
    uint16 public phase2SlashBps = 2_500; // 25%

    uint16 public alignmentWeightBps = 8_000;
    uint16 public influenceWeightBps = 2_000;

    uint16 public alphaBps = 40_000; // alpha = 4.0
    uint16 public reputationLambdaBps = 8_000; // lambda = 0.8
    uint16 public reputationMinBps = 5_000; // 0.5x
    uint16 public reputationMaxBps = 15_000; // 1.5x

    /// @notice Wallet that signs the Attestia native (detector) off-chain attestation; excluded from stake rewards/slashing.
    address public nativeAttester;
    /// @notice Native score weight w_A(N) by independent attester count N: N<5, 5≤N<10, 10≤N<15, 15≤N≤20, N>20.
    uint16 public nativeWeightLt5Bps = 8_000;
    uint16 public nativeWeightLt10Bps = 5_000;
    uint16 public nativeWeightLt15Bps = 3_000;
    uint16 public nativeWeightLe20Bps = 2_000;
    uint16 public nativeWeightGt20Bps = 1_000;

    struct VerifierPerformance {
        uint64 evaluations;
        uint64 slashCount;
        uint64 consecutiveGood;
        uint64 goodCount;
        uint64 lastRoundId;
        uint16 reputationBps; // [0.5x, 1.5x], initialized at 1.0x
    }

    struct RoundContext {
        bytes32 aggregateUid;
        uint64 roundId;
        NetworkPhase phase;
        uint256 variance;
        uint256 consensusScoreBps;
        uint256 independentSum;
        uint256 independentCount;
        uint16 nativeWeightBps;
        bool hasNative;
        uint16 nativeScore;
    }

    struct EconomicConfig {
        uint256 baseRewardPerRound;
        uint16 phase0RewardBps;
        uint16 phase1RewardBps;
        uint16 phase2RewardBps;
        uint16 phase1DeviationThresholdBps;
        uint16 phase2DeviationThresholdBps;
        uint256 phase1VarianceThresholdBps2;
        uint16 phase1SlashBps;
        uint16 phase2SlashBps;
        uint16 alignmentWeightBps;
        uint16 influenceWeightBps;
        uint16 alphaBps;
        uint16 reputationLambdaBps;
        uint16 reputationMinBps;
        uint16 reputationMaxBps;
        address nativeAttester;
        uint16 nativeWeightLt5Bps;
        uint16 nativeWeightLt10Bps;
        uint16 nativeWeightLt15Bps;
        uint16 nativeWeightLe20Bps;
        uint16 nativeWeightGt20Bps;
    }

    enum NetworkPhase {
        Bootstrapping,
        WeakConsensus,
        Mature
    }

    mapping(address => VerifierPerformance) public verifierPerformance;
    mapping(address => uint64) public suspendedUntilRound;

    address[] private _attesters;

    /// @notice Packed row for dashboards: on-chain reputation multiplier and round stats.
    struct AttesterReputationSnapshot {
        address account;
        uint16 reputationBps;
        uint64 evaluations;
        uint64 slashCount;
        uint256 stakedWei;
    }

    uint256 private _locked;

    event Staked(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event Slashed(address indexed account, uint256 amount, string reason);
    event Rewarded(address indexed account, uint256 amount);
    event RewardsFunded(uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RegisteredAttester(address indexed account);
    event RegistrarRegisteredAttester(address indexed registrar, address indexed account);
    event PerformanceReporterSet(address indexed reporter);
    event RegistrySet(address indexed registry);
    event ContributorFeesDeposited(address indexed registry, uint256 amount);
    event BaseRewardPerRoundSet(uint256 amount);
    event PhaseRewardBpsSet(uint16 phase0RewardBps, uint16 phase1RewardBps, uint16 phase2RewardBps);
    event RewardWeightsSet(uint16 alignmentWeightBps, uint16 influenceWeightBps);
    event DeviationThresholdsSet(uint16 phase1DeviationThresholdBps, uint16 phase2DeviationThresholdBps);
    event SlashingParamsSet(uint256 phase1VarianceThresholdBps2, uint16 phase1SlashBps, uint16 phase2SlashBps);
    event ReputationParamsSet(uint16 alphaBps, uint16 reputationLambdaBps, uint16 reputationMinBps, uint16 reputationMaxBps);
    event NativeAttesterSet(address indexed nativeAttester);
    event NativeWeightBpsSet(
        uint16 nativeWeightLt5Bps,
        uint16 nativeWeightLt10Bps,
        uint16 nativeWeightLt15Bps,
        uint16 nativeWeightLe20Bps,
        uint16 nativeWeightGt20Bps
    );
    event RoundScored(
        bytes32 indexed aggregateUid,
        uint64 indexed roundId,
        NetworkPhase phase,
        uint256 consensusScoreBps,
        uint256 varianceBpsSquared,
        uint256 independentVerifierCount,
        uint16 nativeWeightBps
    );
    event VerifierRoundOutcome(
        bytes32 indexed aggregateUid,
        uint64 indexed roundId,
        address indexed verifier,
        uint256 rewardWei,
        uint256 slashWei
    );

    error BelowMinStake();
    error InsufficientStake();
    error NoRewards();
    error TransferFailed();
    error ReentrantCall();
    error NotOwner();
    error ZeroAddress();
    error AlreadyRegistered();
    error NotPerformanceReporter();
    error NotRegistry();
    error InvalidInputLength();
    error EmptyScores();
    error InvalidScore();
    error InvalidVerifier();
    error DuplicateVerifier();
    error InvalidNativeAttester();
    error DuplicateNativeAttester();
    error IndependentCountMismatch();
    error InvalidParam();
    error InsufficientRewardPool();

    uint256 public constant MIN_VERIFIER_STAKE = 0.05 ether;
    uint256 public constant MAX_VERIFIER_STAKE = 0.2 ether;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked == 1) revert ReentrantCall();
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier onlyPerformanceReporter() {
        if (msg.sender != performanceReporter) revert NotPerformanceReporter();
        _;
    }

    modifier onlyRegistry() {
        if (msg.sender != registry) revert NotRegistry();
        _;
    }

    constructor(uint256 minStakeWei, uint256 baseRewardPerRoundWei) {
        if (minStakeWei < MIN_VERIFIER_STAKE || minStakeWei > MAX_VERIFIER_STAKE) revert InvalidParam();
        owner = msg.sender;
        performanceReporter = msg.sender;
        minStake = minStakeWei;
        baseRewardPerRound = baseRewardPerRoundWei;
        emit BaseRewardPerRoundSet(baseRewardPerRoundWei);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setMinStake(uint256 newMin) external onlyOwner {
        if (newMin < MIN_VERIFIER_STAKE || newMin > MAX_VERIFIER_STAKE) revert InvalidParam();
        minStake = newMin;
    }

    function setPerformanceReporter(address reporter) external onlyOwner {
        if (reporter == address(0)) revert ZeroAddress();
        performanceReporter = reporter;
        emit PerformanceReporterSet(reporter);
    }

    function setRegistry(address registryAddress) external onlyOwner {
        if (registryAddress == address(0)) revert ZeroAddress();
        registry = registryAddress;
        emit RegistrySet(registryAddress);
    }

    function setBaseRewardPerRound(uint256 amount) external onlyOwner {
        baseRewardPerRound = amount;
        emit BaseRewardPerRoundSet(amount);
    }

    function setPhaseRewardBps(uint16 phase0, uint16 phase1, uint16 phase2) external onlyOwner {
        if (phase0 > BPS || phase1 > BPS || phase2 > BPS) revert InvalidParam();
        phase0RewardBps = phase0;
        phase1RewardBps = phase1;
        phase2RewardBps = phase2;
        emit PhaseRewardBpsSet(phase0, phase1, phase2);
    }

    function setRewardWeights(uint16 alignmentWeight, uint16 influenceWeight) external onlyOwner {
        if (alignmentWeight + influenceWeight != BPS) revert InvalidParam();
        alignmentWeightBps = alignmentWeight;
        influenceWeightBps = influenceWeight;
        emit RewardWeightsSet(alignmentWeight, influenceWeight);
    }

    function setDeviationThresholds(uint16 phase1DeviationBps, uint16 phase2DeviationBps) external onlyOwner {
        if (phase1DeviationBps > BPS || phase2DeviationBps > BPS) revert InvalidParam();
        phase1DeviationThresholdBps = phase1DeviationBps;
        phase2DeviationThresholdBps = phase2DeviationBps;
        emit DeviationThresholdsSet(phase1DeviationBps, phase2DeviationBps);
    }

    function setSlashingParams(uint256 phase1VarianceBps2, uint16 phase1SlashRateBps, uint16 phase2SlashRateBps)
        external
        onlyOwner
    {
        if (phase1VarianceBps2 > uint256(BPS) * uint256(BPS)) revert InvalidParam();
        if (phase1SlashRateBps > BPS || phase2SlashRateBps > BPS) revert InvalidParam();
        phase1VarianceThresholdBps2 = phase1VarianceBps2;
        phase1SlashBps = phase1SlashRateBps;
        phase2SlashBps = phase2SlashRateBps;
        emit SlashingParamsSet(phase1VarianceBps2, phase1SlashRateBps, phase2SlashRateBps);
    }

    function setReputationParams(uint16 alpha, uint16 lambda, uint16 repMin, uint16 repMax) external onlyOwner {
        if (lambda > BPS) revert InvalidParam();
        if (repMin > repMax) revert InvalidParam();
        if (repMax > 5 * BPS) revert InvalidParam();
        alphaBps = alpha;
        reputationLambdaBps = lambda;
        reputationMinBps = repMin;
        reputationMaxBps = repMax;
        emit ReputationParamsSet(alpha, lambda, repMin, repMax);
    }

    function setNativeAttester(address attester) external onlyOwner {
        nativeAttester = attester;
        emit NativeAttesterSet(attester);
    }

    function setNativeWeightBps(uint16 lt5, uint16 lt10, uint16 lt15, uint16 le20, uint16 gt20) external onlyOwner {
        if (lt5 > BPS || lt10 > BPS || lt15 > BPS || le20 > BPS || gt20 > BPS) revert InvalidParam();
        nativeWeightLt5Bps = lt5;
        nativeWeightLt10Bps = lt10;
        nativeWeightLt15Bps = lt15;
        nativeWeightLe20Bps = le20;
        nativeWeightGt20Bps = gt20;
        emit NativeWeightBpsSet(lt5, lt10, lt15, le20, gt20);
    }

    /// @notice w_A(N) for N independent attesters in the aggregate (whitepaper §3.4).
    function nativeWeightBpsForIndependentCount(uint256 independentCount) public view returns (uint16) {
        if (independentCount < 5) return nativeWeightLt5Bps;
        if (independentCount < 10) return nativeWeightLt10Bps;
        if (independentCount < 15) return nativeWeightLt15Bps;
        if (independentCount <= 20) return nativeWeightLe20Bps;
        return nativeWeightGt20Bps;
    }

    function networkPhase() public view returns (NetworkPhase) {
        return _phaseFromActiveVerifiers(_activeAttesterCount(currentRoundId + 1));
    }

    function getEconomicConfig() external view returns (EconomicConfig memory cfg) {
        cfg = EconomicConfig({
            baseRewardPerRound: baseRewardPerRound,
            phase0RewardBps: phase0RewardBps,
            phase1RewardBps: phase1RewardBps,
            phase2RewardBps: phase2RewardBps,
            phase1DeviationThresholdBps: phase1DeviationThresholdBps,
            phase2DeviationThresholdBps: phase2DeviationThresholdBps,
            phase1VarianceThresholdBps2: phase1VarianceThresholdBps2,
            phase1SlashBps: phase1SlashBps,
            phase2SlashBps: phase2SlashBps,
            alignmentWeightBps: alignmentWeightBps,
            influenceWeightBps: influenceWeightBps,
            alphaBps: alphaBps,
            reputationLambdaBps: reputationLambdaBps,
            reputationMinBps: reputationMinBps,
            reputationMaxBps: reputationMaxBps,
            nativeAttester: nativeAttester,
            nativeWeightLt5Bps: nativeWeightLt5Bps,
            nativeWeightLt10Bps: nativeWeightLt10Bps,
            nativeWeightLt15Bps: nativeWeightLt15Bps,
            nativeWeightLe20Bps: nativeWeightLe20Bps,
            nativeWeightGt20Bps: nativeWeightGt20Bps
        });
    }

    function stake() external payable {
        if (msg.value == 0) revert InsufficientStake();
        if (staked[msg.sender] + msg.value < minStake) revert BelowMinStake();
        staked[msg.sender] += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    /// @notice Requires `staked[msg.sender] >= minStake` (e.g. after `stake()` is confirmed).
    function registerAsAttester() external {
        if (roleOf[msg.sender] != ParticipantRole.None) revert AlreadyRegistered();
        if (staked[msg.sender] < minStake) revert BelowMinStake();
        roleOf[msg.sender] = ParticipantRole.Attester;
        _attesters.push(msg.sender);
        emit RegisteredAttester(msg.sender);
    }

    /// @notice Admin-sponsored attester registration; requires `staked[account] >= minStake`.
    function registerAsAttesterFor(address account) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (roleOf[account] != ParticipantRole.None) revert AlreadyRegistered();
        if (staked[account] < minStake) revert BelowMinStake();
        roleOf[account] = ParticipantRole.Attester;
        _attesters.push(account);
        emit RegisteredAttester(account);
        emit RegistrarRegisteredAttester(msg.sender, account);
    }

    function isAttester(address account) external view returns (bool) {
        return roleOf[account] == ParticipantRole.Attester;
    }

    function attestersLength() external view returns (uint256) {
        return _attesters.length;
    }

    function attesterAt(uint256 index) external view returns (address) {
        return _attesters[index];
    }

    /// @notice Returns a slice of registered attesters with reputation and stake (sort client-side for leaderboards).
    function getAttesterReputationSnapshots(uint256 offset, uint256 limit)
        external
        view
        returns (AttesterReputationSnapshot[] memory snapshots)
    {
        uint256 n = _attesters.length;
        if (offset >= n || limit == 0) {
            return new AttesterReputationSnapshot[](0);
        }
        uint256 end = offset + limit;
        if (end > n) end = n;
        uint256 len = end - offset;
        snapshots = new AttesterReputationSnapshot[](len);
        for (uint256 i = 0; i < len; i++) {
            address account = _attesters[offset + i];
            VerifierPerformance storage p = verifierPerformance[account];
            uint16 rep = p.reputationBps == 0 ? uint16(BPS) : p.reputationBps;
            snapshots[i] = AttesterReputationSnapshot({
                account: account,
                reputationBps: rep,
                evaluations: p.evaluations,
                slashCount: p.slashCount,
                stakedWei: staked[account]
            });
        }
    }

    function withdraw(uint256 amount) external nonReentrant {
        uint256 s = staked[msg.sender];
        if (amount > s) revert InsufficientStake();
        staked[msg.sender] = s - amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Slashes up to `amount` from the participant's stake (PoC: protocol owner only).
    function slash(address participant, uint256 amount, string calldata reason) external onlyOwner {
        uint256 s = staked[participant];
        uint256 take = amount > s ? s : amount;
        staked[participant] = s - take;
        slashAccumulator[participant] += take;
        emit Slashed(participant, take, reason);
    }

    function fundRewards() external payable onlyOwner {
        rewardPoolWei += msg.value;
        emit RewardsFunded(msg.value);
    }

    /// @notice Receives contributor network fees from AttestiaRegistry.
    function depositContributorFees() external payable onlyRegistry {
        rewardPoolWei += msg.value;
        emit ContributorFeesDeposited(msg.sender, msg.value);
    }

    function grantReward(address recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        _reserveReward(amount);
        pendingRewards[recipient] += amount;
    }

    function claimRewards() external nonReentrant {
        uint256 r = pendingRewards[msg.sender];
        if (r == 0) revert NoRewards();
        pendingRewards[msg.sender] = 0;
        totalPendingRewardsWei -= r;
        rewardPoolWei -= r;
        (bool ok,) = payable(msg.sender).call{value: r}("");
        if (!ok) revert TransferFailed();
        emit Rewarded(msg.sender, r);
    }

    /// @notice Called by the aggregate resolver to score independent attester round performance.
    /// @dev `numIndependentVerifiers` is N (excludes the native attester). `verifiers`/`scores` may include the
    ///      native wallet once; it is identified via `nativeAttester` and is not rewarded or slashed.
    ///      Scores are in [0, 10_000] where 10_000 maps to 1.0.
    function processAggregateScores(
        bytes32 aggregateUid,
        uint32 numIndependentVerifiers,
        address[] calldata verifiers,
        uint16[] calldata scores
    ) external onlyPerformanceReporter {
        uint64 roundId = ++currentRoundId;
        (uint16 nativeScore, bool hasNative, uint256 independentSum, uint256 independentCount) =
            _validateRoundScores(numIndependentVerifiers, verifiers, scores);

        uint16 nativeWeight = nativeWeightBpsForIndependentCount(independentCount);
        uint256 consensus = _consensusScore(nativeScore, hasNative, nativeWeight, independentSum, independentCount);
        uint256 variance = _computeIndependentVariance(verifiers, scores, consensus);
        NetworkPhase phase = _phaseFromActiveVerifiers(_activeAttesterCount(roundId));
        RoundContext memory ctx = RoundContext({
            aggregateUid: aggregateUid,
            roundId: roundId,
            phase: phase,
            variance: variance,
            consensusScoreBps: consensus,
            independentSum: independentSum,
            independentCount: independentCount,
            nativeWeightBps: nativeWeight,
            hasNative: hasNative,
            nativeScore: nativeScore
        });

        emit RoundScored(aggregateUid, roundId, phase, consensus, variance, independentCount, nativeWeight);

        for (uint256 i = 0; i < verifiers.length; i++) {
            address verifier = verifiers[i];
            if (verifier == nativeAttester) {
                continue;
            }
            if (suspendedUntilRound[verifier] >= roundId) {
                continue;
            }
            _scoreVerifier(ctx, verifier, scores[i]);
        }
    }

    function _validateRoundScores(uint32 numIndependentVerifiers, address[] calldata verifiers, uint16[] calldata scores)
        internal
        view
        returns (uint16 nativeScore, bool hasNative, uint256 independentSum, uint256 independentCount)
    {
        uint256 n = verifiers.length;
        if (n == 0) revert EmptyScores();
        if (n != scores.length) revert InvalidInputLength();

        for (uint256 i = 0; i < n; i++) {
            address participant = verifiers[i];
            uint16 score = scores[i];
            if (score > BPS) revert InvalidScore();
            for (uint256 j = 0; j < i; j++) {
                if (verifiers[j] == participant) revert DuplicateVerifier();
            }

            if (participant == nativeAttester) {
                if (nativeAttester == address(0)) revert InvalidNativeAttester();
                if (hasNative) revert DuplicateNativeAttester();
                hasNative = true;
                nativeScore = score;
                continue;
            }

            if (roleOf[participant] != ParticipantRole.Attester) revert InvalidVerifier();
            if (staked[participant] < minStake) revert InvalidVerifier();
            independentSum += score;
            independentCount += 1;
        }

        if (independentCount != uint256(numIndependentVerifiers)) revert IndependentCountMismatch();
        if (nativeAttester != address(0) && !hasNative) revert InvalidNativeAttester();
        if (independentCount == 0 && !hasNative) revert EmptyScores();
    }

    function _consensusScore(
        uint16 nativeScore,
        bool hasNative,
        uint16 nativeWeightBps,
        uint256 independentSum,
        uint256 independentCount
    ) internal pure returns (uint256) {
        if (independentCount == 0) {
            return nativeScore;
        }
        uint256 independentAvg = independentSum / independentCount;
        if (!hasNative) {
            return independentAvg;
        }
        return (uint256(nativeWeightBps) * uint256(nativeScore) + uint256(BPS - nativeWeightBps) * independentAvg)
            / BPS;
    }

    function _computeIndependentVariance(address[] calldata verifiers, uint16[] calldata scores, uint256 consensus)
        internal
        view
        returns (uint256 variance)
    {
        uint256 count;
        for (uint256 i = 0; i < verifiers.length; i++) {
            if (verifiers[i] == nativeAttester) {
                continue;
            }
            uint256 d = _absDiff(scores[i], consensus);
            variance += d * d;
            count += 1;
        }
        if (count == 0) {
            return 0;
        }
        variance /= count;
    }

    function _scoreVerifier(RoundContext memory ctx, address verifier, uint16 score) internal {
        VerifierPerformance storage perf = verifierPerformance[verifier];
        if (perf.reputationBps == 0) {
            perf.reputationBps = BPS;
        }

        uint256 deviation = _absDiff(score, ctx.consensusScoreBps);
        uint256 alignmentBps = _alignmentFromDeviation(deviation);
        uint256 influenceBps = _influenceFromAverageShift(ctx, score);
        uint256 weightedSignalBps =
            (uint256(alignmentWeightBps) * alignmentBps + uint256(influenceWeightBps) * influenceBps) / BPS;

        uint256 phaseRewardMultiplier = _phaseRewardMultiplier(ctx.phase);
        uint256 reward = baseRewardPerRound * phaseRewardMultiplier * weightedSignalBps * perf.reputationBps / uint256(BPS)
            / uint256(BPS) / uint256(BPS);
        if (reward > 0) {
            _reserveReward(reward);
            pendingRewards[verifier] += reward;
        }

        bool shouldSlash;
        uint16 slashRateBps;
        if (ctx.phase == NetworkPhase.WeakConsensus) {
            shouldSlash = deviation > phase1DeviationThresholdBps && ctx.variance < phase1VarianceThresholdBps2;
            slashRateBps = phase1SlashBps;
        } else if (ctx.phase == NetworkPhase.Mature) {
            shouldSlash = deviation > phase2DeviationThresholdBps;
            slashRateBps = phase2SlashBps;
        }

        uint256 slashAmount;
        if (shouldSlash) {
            uint256 s = staked[verifier];
            slashAmount = (s * slashRateBps) / BPS;
            staked[verifier] = s - slashAmount;
            slashAccumulator[verifier] += slashAmount;
            perf.slashCount += 1;
            perf.consecutiveGood = 0;
            if (ctx.phase == NetworkPhase.WeakConsensus) {
                suspendedUntilRound[verifier] = ctx.roundId + 1;
            }
            emit Slashed(verifier, slashAmount, "aggregate_outlier");
        } else {
            perf.consecutiveGood += 1;
            perf.goodCount += 1;
        }

        perf.evaluations += 1;
        perf.lastRoundId = ctx.roundId;
        perf.reputationBps = _updateReputation(perf.reputationBps, uint16(alignmentBps));

        emit VerifierRoundOutcome(
            ctx.aggregateUid,
            ctx.roundId,
            verifier,
            reward,
            slashAmount
        );
    }

    function _activeAttesterCount(uint64 roundId) internal view returns (uint256 count) {
        uint256 total = _attesters.length;
        for (uint256 i = 0; i < total; i++) {
            address verifier = _attesters[i];
            if (staked[verifier] >= minStake && suspendedUntilRound[verifier] < roundId) {
                count++;
            }
        }
    }

    function _phaseFromActiveVerifiers(uint256 activeVerifiers) internal pure returns (NetworkPhase) {
        if (activeVerifiers < 5) return NetworkPhase.Bootstrapping;
        if (activeVerifiers <= 20) return NetworkPhase.WeakConsensus;
        return NetworkPhase.Mature;
    }

    function _phaseRewardMultiplier(NetworkPhase phase) internal view returns (uint256) {
        if (phase == NetworkPhase.Bootstrapping) return phase0RewardBps;
        if (phase == NetworkPhase.WeakConsensus) return phase1RewardBps;
        return phase2RewardBps;
    }

    function _alignmentFromDeviation(uint256 deviationBps) internal view returns (uint256) {
        // Inverse approximation of exp(-alpha * d): 1 / (1 + alpha*d).
        uint256 xBps = (uint256(alphaBps) * deviationBps) / BPS;
        return (uint256(BPS) * uint256(BPS)) / (uint256(BPS) + xBps);
    }

    function _influenceFromAverageShift(RoundContext memory ctx, uint16 score) internal pure returns (uint256) {
        if (ctx.independentCount <= 1) return BPS;
        uint256 consensusWithout = _consensusScore(
            ctx.nativeScore,
            ctx.hasNative,
            ctx.nativeWeightBps,
            ctx.independentSum - uint256(score),
            ctx.independentCount - 1
        );
        return _absDiff(ctx.consensusScoreBps, consensusWithout);
    }

    function _updateReputation(uint16 currentRepBps, uint16 alignmentBps) internal view returns (uint16) {
        uint256 updated = (uint256(reputationLambdaBps) * currentRepBps + uint256(BPS - reputationLambdaBps) * alignmentBps)
            / BPS;
        if (updated < reputationMinBps) return reputationMinBps;
        if (updated > reputationMaxBps) return reputationMaxBps;
        return uint16(updated);
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a - b : b - a;
    }

    function _reserveReward(uint256 amount) internal {
        if (totalPendingRewardsWei + amount > rewardPoolWei) revert InsufficientRewardPool();
        totalPendingRewardsWei += amount;
    }

    receive() external payable {
        rewardPoolWei += msg.value;
        emit RewardsFunded(msg.value);
    }
}
