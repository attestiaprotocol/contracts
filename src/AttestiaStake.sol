// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AttestiaStake — stake, participant signup (submitters / attesters), slashing, rewards (Base)
/// @dev After `stake()` meets `minStake`, call `registerAsSubmitter()` or `registerAsAttester()` once.
contract AttestiaStake {
    enum ParticipantRole {
        None,
        Submitter,
        Attester
    }

    address public owner;
    uint256 public minStake;

    mapping(address => uint256) public staked;
    mapping(address => uint256) public pendingRewards;
    mapping(address => uint256) public slashAccumulator;
    mapping(address => ParticipantRole) public roleOf;

    address[] private _submitters;
    address[] private _attesters;

    uint256 private _locked;

    event Staked(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event Slashed(address indexed account, uint256 amount, string reason);
    event Rewarded(address indexed account, uint256 amount);
    event RewardsFunded(uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RegisteredSubmitter(address indexed account);
    event RegisteredAttester(address indexed account);

    error BelowMinStake();
    error InsufficientStake();
    error NoRewards();
    error TransferFailed();
    error ReentrantCall();
    error NotOwner();
    error ZeroAddress();
    error AlreadyRegistered();

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

    constructor(uint256 minStakeWei) {
        owner = msg.sender;
        minStake = minStakeWei;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setMinStake(uint256 newMin) external onlyOwner {
        minStake = newMin;
    }

    function stake() external payable {
        if (msg.value == 0) revert InsufficientStake();
        if (staked[msg.sender] + msg.value < minStake) revert BelowMinStake();
        staked[msg.sender] += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    /// @notice Requires `staked[msg.sender] >= minStake` (e.g. after `stake()` is confirmed).
    function registerAsSubmitter() external {
        if (roleOf[msg.sender] != ParticipantRole.None) revert AlreadyRegistered();
        if (staked[msg.sender] < minStake) revert BelowMinStake();
        roleOf[msg.sender] = ParticipantRole.Submitter;
        _submitters.push(msg.sender);
        emit RegisteredSubmitter(msg.sender);
    }

    /// @notice Requires `staked[msg.sender] >= minStake` (e.g. after `stake()` is confirmed).
    function registerAsAttester() external {
        if (roleOf[msg.sender] != ParticipantRole.None) revert AlreadyRegistered();
        if (staked[msg.sender] < minStake) revert BelowMinStake();
        roleOf[msg.sender] = ParticipantRole.Attester;
        _attesters.push(msg.sender);
        emit RegisteredAttester(msg.sender);
    }

    function isSubmitter(address account) external view returns (bool) {
        return roleOf[account] == ParticipantRole.Submitter;
    }

    function isAttester(address account) external view returns (bool) {
        return roleOf[account] == ParticipantRole.Attester;
    }

    function submittersLength() external view returns (uint256) {
        return _submitters.length;
    }

    function attestersLength() external view returns (uint256) {
        return _attesters.length;
    }

    function submitterAt(uint256 index) external view returns (address) {
        return _submitters[index];
    }

    function attesterAt(uint256 index) external view returns (address) {
        return _attesters[index];
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
        emit RewardsFunded(msg.value);
    }

    function grantReward(address recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        pendingRewards[recipient] += amount;
    }

    function claimRewards() external nonReentrant {
        uint256 r = pendingRewards[msg.sender];
        if (r == 0) revert NoRewards();
        pendingRewards[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: r}("");
        if (!ok) revert TransferFailed();
        emit Rewarded(msg.sender, r);
    }

    receive() external payable {}
}
