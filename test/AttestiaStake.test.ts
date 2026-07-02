import { expect } from "chai";
import { ethers } from "hardhat";
import {
  BASE_REWARD,
  MIN_STAKE,
  deployMockStakeToken,
  mintAndApprove,
} from "./helpers/stakeToken";

describe("AttestiaStake", () => {
  async function deployStake() {
    const [deployer, alice, bob] = await ethers.getSigners();
    const token = await deployMockStakeToken();
    const tokenAddr = await token.getAddress();
    const Stake = await ethers.getContractFactory("AttestiaStake");
    const stake = await Stake.deploy(tokenAddr, MIN_STAKE, BASE_REWARD);
    await stake.waitForDeployment();
    const stakeAddr = await stake.getAddress();
    return { stake, token, tokenAddr, stakeAddr, deployer, alice, bob };
  }

  it("stake meets min", async () => {
    const { stake, token, stakeAddr, alice } = await deployStake();
    await mintAndApprove(token, alice, stakeAddr, MIN_STAKE);
    await stake.connect(alice).stake(MIN_STAKE);
    expect(await stake.staked(alice.address)).to.equal(MIN_STAKE);
  });

  it("stake reverts below min", async () => {
    const { stake, token, stakeAddr, alice } = await deployStake();
    await mintAndApprove(token, alice, stakeAddr, MIN_STAKE - 1n);
    await expect(
      stake.connect(alice).stake(MIN_STAKE - 1n),
    ).to.be.revertedWithCustomError(stake, "BelowMinStake");
  });

  it("register attester after stake", async () => {
    const { stake, token, stakeAddr, bob } = await deployStake();
    await mintAndApprove(token, bob, stakeAddr, MIN_STAKE);
    await stake.connect(bob).stake(MIN_STAKE);
    await stake.connect(bob).registerAsAttester();
    expect(await stake.isAttester(bob.address)).to.equal(true);
    expect(await stake.attestersLength()).to.equal(1n);
    expect(await stake.attesterAt(0)).to.equal(bob.address);
  });

  it("getAttesterReputationSnapshots returns registered attesters", async () => {
    const { stake, token, stakeAddr, bob } = await deployStake();
    await mintAndApprove(token, bob, stakeAddr, MIN_STAKE);
    await stake.connect(bob).stake(MIN_STAKE);
    await stake.connect(bob).registerAsAttester();
    const rows = await stake.getAttesterReputationSnapshots(0, 10);
    expect(rows.length).to.equal(1);
    expect(rows[0].account).to.equal(bob.address);
    expect(rows[0].reputationBps).to.equal(10000);
    expect(rows[0].evaluations).to.equal(0n);
    expect(rows[0].stakedAmount).to.equal(MIN_STAKE);
  });

  it("attester register still reverts without stake", async () => {
    const { stake, alice } = await deployStake();
    await expect(
      stake.connect(alice).registerAsAttester(),
    ).to.be.revertedWithCustomError(stake, "BelowMinStake");
  });

  it("register reverts double role", async () => {
    const { stake, token, stakeAddr, alice } = await deployStake();
    await mintAndApprove(token, alice, stakeAddr, MIN_STAKE);
    await stake.connect(alice).stake(MIN_STAKE);
    await stake.connect(alice).registerAsAttester();
    await expect(stake.connect(alice).registerAsAttester()).to.be.revertedWithCustomError(
      stake,
      "AlreadyRegistered",
    );
  });

  it("withdraw", async () => {
    const { stake, token, stakeAddr, alice } = await deployStake();
    await mintAndApprove(token, alice, stakeAddr, MIN_STAKE);
    await stake.connect(alice).stake(MIN_STAKE);
    await stake.connect(alice).withdraw(MIN_STAKE / 2n);
    expect(await stake.staked(alice.address)).to.equal(MIN_STAKE / 2n);
  });

  it("slash", async () => {
    const { stake, token, stakeAddr, deployer, alice } = await deployStake();
    const slashAmt = 18n * 10n ** 6n; // ~0.005 ETH → 18 USDC
    await mintAndApprove(token, alice, stakeAddr, MIN_STAKE);
    await stake.connect(alice).stake(MIN_STAKE);
    await stake
      .connect(deployer)
      .slash(alice.address, slashAmt, "bad attestation");
    expect(await stake.slashAccumulator(alice.address)).to.equal(slashAmt);
    expect(await stake.staked(alice.address)).to.equal(MIN_STAKE - slashAmt);
  });

  it("rewards", async () => {
    const { stake, token, stakeAddr, deployer, alice } = await deployStake();
    const fund = 1_000_000n * 10n ** 6n;
    const reward = 250_000n * 10n ** 6n;
    await mintAndApprove(token, alice, stakeAddr, MIN_STAKE);
    await stake.connect(alice).stake(MIN_STAKE);
    await mintAndApprove(token, deployer, stakeAddr, fund);
    await stake.connect(deployer).fundRewards(fund);
    await stake.connect(deployer).grantReward(alice.address, reward);
    await expect(stake.connect(alice).claimRewards()).to.changeTokenBalance(
      token,
      alice,
      reward,
    );
  });

  it("claim reverts with no rewards", async () => {
    const { stake, alice } = await deployStake();
    await expect(
      stake.connect(alice).claimRewards(),
    ).to.be.revertedWithCustomError(stake, "NoRewards");
  });

  it("slashes when consensus is AI-leaning and attester scores too human", async () => {
    const { stake, token, stakeAddr, deployer, alice, bob } = await deployStake();
    const [, , , dave, eve, frank] = await ethers.getSigners();
    const fund = 1_000_000n * 10n ** 6n;

    await stake.connect(deployer).setBaseRewardPerRound(BASE_REWARD);
    await mintAndApprove(token, deployer, stakeAddr, fund);
    await stake.connect(deployer).fundRewards(fund);

    for (const verifier of [alice, bob, dave, eve, frank]) {
      await mintAndApprove(token, verifier, stakeAddr, MIN_STAKE);
      await stake.connect(verifier).stake(MIN_STAKE);
      await stake.connect(verifier).registerAsAttester();
    }

    await stake.processAggregateScores(
      ethers.keccak256(ethers.toUtf8Bytes("round-1")),
      5,
      [alice.address, bob.address, dave.address, eve.address, frank.address],
      [6000, 6000, 6000, 4000, 6000],
    );

    const perfOutlier = await stake.verifierPerformance(eve.address);
    expect(perfOutlier.slashCount).to.equal(1n);
    expect(perfOutlier.consecutiveGood).to.equal(0n);
    expect(await stake.suspendedUntilRound(eve.address)).to.equal(2n);
  });

  it("slashes when consensus is human-leaning and attester scores too AI", async () => {
    const { stake, token, stakeAddr, deployer, alice, bob } = await deployStake();
    const [, , , dave, eve, frank] = await ethers.getSigners();
    const fund = 1_000_000n * 10n ** 6n;

    await stake.connect(deployer).setBaseRewardPerRound(BASE_REWARD);
    await mintAndApprove(token, deployer, stakeAddr, fund);
    await stake.connect(deployer).fundRewards(fund);

    for (const verifier of [alice, bob, dave, eve, frank]) {
      await mintAndApprove(token, verifier, stakeAddr, MIN_STAKE);
      await stake.connect(verifier).stake(MIN_STAKE);
      await stake.connect(verifier).registerAsAttester();
    }

    await stake.processAggregateScores(
      ethers.keccak256(ethers.toUtf8Bytes("round-human")),
      5,
      [alice.address, bob.address, dave.address, eve.address, frank.address],
      [4000, 4000, 4000, 6000, 4000],
    );

    expect((await stake.verifierPerformance(eve.address)).slashCount).to.equal(1n);
  });

  it("does not slash in bootstrapping phase", async () => {
    const { stake, token, stakeAddr, deployer, alice, bob } = await deployStake();
    const [, , , dave] = await ethers.getSigners();
    const fund = 1_000_000n * 10n ** 6n;

    await stake.connect(deployer).setBaseRewardPerRound(BASE_REWARD);
    await mintAndApprove(token, deployer, stakeAddr, fund);
    await stake.connect(deployer).fundRewards(fund);

    for (const verifier of [alice, bob, dave]) {
      await mintAndApprove(token, verifier, stakeAddr, MIN_STAKE);
      await stake.connect(verifier).stake(MIN_STAKE);
      await stake.connect(verifier).registerAsAttester();
    }

    await stake.processAggregateScores(
      ethers.keccak256(ethers.toUtf8Bytes("round-bootstrap")),
      3,
      [alice.address, bob.address, dave.address],
      [5000, 9000, 5000],
    );

    const perf = await stake.verifierPerformance(bob.address);
    expect(perf.slashCount).to.equal(0n);
    expect(perf.consecutiveGood).to.equal(1n);
  });

  it("allows owner to tune economic parameters", async () => {
    const { stake, deployer } = await deployStake();

    await stake.connect(deployer).setPhaseRewardBps(4500, 7500, 10000);
    await stake.connect(deployer).setRewardWeights(8500, 1500);
    await stake.connect(deployer).setDirectionalSlashThresholds(5000, 4500, 5500);
    await stake.connect(deployer).setSlashRates(900, 2500);
    await stake.connect(deployer).setReputationParams(35000, 7000, 6000, 14000);

    expect(await stake.phase0RewardBps()).to.equal(4500);
    expect(await stake.phase1RewardBps()).to.equal(7500);
    expect(await stake.phase2RewardBps()).to.equal(10000);
    expect(await stake.alignmentWeightBps()).to.equal(8500);
    expect(await stake.influenceWeightBps()).to.equal(1500);
    expect(await stake.slashConsensusMidBps()).to.equal(5000);
    expect(await stake.slashLowScoreWhenConsensusHighBps()).to.equal(4500);
    expect(await stake.slashHighScoreWhenConsensusLowBps()).to.equal(5500);
    expect(await stake.phase1SlashBps()).to.equal(900);
    expect(await stake.phase2SlashBps()).to.equal(2500);
    expect(await stake.alphaBps()).to.equal(35000);
    expect(await stake.reputationLambdaBps()).to.equal(7000);
    expect(await stake.reputationMinBps()).to.equal(6000);
    expect(await stake.reputationMaxBps()).to.equal(14000);
  });

  it("rejects invalid economic parameters", async () => {
    const { stake, deployer } = await deployStake();

    await expect(
      stake.connect(deployer).setPhaseRewardBps(5000, 8000, 10001),
    ).to.be.revertedWithCustomError(stake, "InvalidParam");

    await expect(
      stake.connect(deployer).setRewardWeights(8000, 1000),
    ).to.be.revertedWithCustomError(stake, "InvalidParam");

    await expect(
      stake.connect(deployer).setDirectionalSlashThresholds(5000, 5000, 5500),
    ).to.be.revertedWithCustomError(stake, "InvalidParam");

    await expect(
      stake.connect(deployer).setSlashRates(10_001, 500),
    ).to.be.revertedWithCustomError(stake, "InvalidParam");

    await expect(
      stake.connect(deployer).setReputationParams(30000, 9000, 16000, 12000),
    ).to.be.revertedWithCustomError(stake, "InvalidParam");
  });

  it("prevents non-owner from tuning economic parameters", async () => {
    const { stake, alice } = await deployStake();

    await expect(
      stake.connect(alice).setPhaseRewardBps(5000, 8000, 10000),
    ).to.be.revertedWithCustomError(stake, "NotOwner");
  });

  it("returns compact economic config snapshot", async () => {
    const { stake, deployer } = await deployStake();

    await stake.connect(deployer).setBaseRewardPerRound(BASE_REWARD);
    await stake.connect(deployer).setPhaseRewardBps(4200, 7800, 10000);
    await stake.connect(deployer).setRewardWeights(7000, 3000);
    await stake.connect(deployer).setDirectionalSlashThresholds(5100, 4400, 5600);
    await stake.connect(deployer).setSlashRates(800, 2200);
    await stake.connect(deployer).setReputationParams(33000, 7500, 6500, 14500);

    const cfg = await stake.getEconomicConfig();
    expect(cfg.baseRewardPerRound).to.equal(BASE_REWARD);
    expect(cfg.phase0RewardBps).to.equal(4200);
    expect(cfg.phase1RewardBps).to.equal(7800);
    expect(cfg.phase2RewardBps).to.equal(10000);
    expect(cfg.alignmentWeightBps).to.equal(7000);
    expect(cfg.influenceWeightBps).to.equal(3000);
    expect(cfg.slashConsensusMidBps).to.equal(5100);
    expect(cfg.slashLowScoreWhenConsensusHighBps).to.equal(4400);
    expect(cfg.slashHighScoreWhenConsensusLowBps).to.equal(5600);
    expect(cfg.phase1SlashBps).to.equal(800);
    expect(cfg.phase2SlashBps).to.equal(2200);
    expect(cfg.alphaBps).to.equal(33000);
    expect(cfg.reputationLambdaBps).to.equal(7500);
    expect(cfg.reputationMinBps).to.equal(6500);
    expect(cfg.reputationMaxBps).to.equal(14500);
  });

  it("excludes native attester from rewards and slashing", async () => {
    const { stake, token, stakeAddr, deployer, alice, bob } = await deployStake();
    const [, , , dave, eve, native] = await ethers.getSigners();
    const fund = 1_000_000n * 10n ** 6n;

    await stake.connect(deployer).setNativeAttester(native.address);
    await stake.connect(deployer).setBaseRewardPerRound(BASE_REWARD);
    await mintAndApprove(token, deployer, stakeAddr, fund);
    await stake.connect(deployer).fundRewards(fund);

    for (const verifier of [alice, bob, dave, eve]) {
      await mintAndApprove(token, verifier, stakeAddr, MIN_STAKE);
      await stake.connect(verifier).stake(MIN_STAKE);
      await stake.connect(verifier).registerAsAttester();
    }

    await stake.processAggregateScores(
      ethers.keccak256(ethers.toUtf8Bytes("round-native")),
      4,
      [native.address, alice.address, bob.address, dave.address, eve.address],
      [9000, 5000, 5000, 5000, 8500],
    );

    const nativePerf = await stake.verifierPerformance(native.address);
    expect(nativePerf.evaluations).to.equal(0n);
    expect(await stake.pendingRewards(native.address)).to.equal(0n);

    expect((await stake.verifierPerformance(eve.address)).evaluations).to.equal(1n);
  });

  it("uses higher native weight when few independent attesters participate", async () => {
    const { stake, token, stakeAddr, deployer, alice, bob } = await deployStake();
    const [, , , native] = await ethers.getSigners();
    const fund = 1_000_000n * 10n ** 6n;

    await stake.connect(deployer).setNativeAttester(native.address);
    await stake.connect(deployer).setBaseRewardPerRound(BASE_REWARD);
    await mintAndApprove(token, deployer, stakeAddr, fund);
    await stake.connect(deployer).fundRewards(fund);

    for (const verifier of [alice, bob]) {
      await mintAndApprove(token, verifier, stakeAddr, MIN_STAKE);
      await stake.connect(verifier).stake(MIN_STAKE);
      await stake.connect(verifier).registerAsAttester();
    }

    await stake.processAggregateScores(
      ethers.keccak256(ethers.toUtf8Bytes("round-weighted")),
      2,
      [native.address, alice.address, bob.address],
      [10_000, 5000, 5000],
    );

    const alicePerf = await stake.verifierPerformance(alice.address);
    expect(alicePerf.evaluations).to.equal(1n);
    expect(alicePerf.slashCount).to.equal(0n);
    expect(await stake.nativeWeightBpsForIndependentCount(2)).to.equal(8000);
  });

  it("returns native weight tiers by independent count", async () => {
    const { stake } = await deployStake();
    expect(await stake.nativeWeightBpsForIndependentCount(2)).to.equal(8000);
    expect(await stake.nativeWeightBpsForIndependentCount(7)).to.equal(5000);
    expect(await stake.nativeWeightBpsForIndependentCount(12)).to.equal(3000);
    expect(await stake.nativeWeightBpsForIndependentCount(18)).to.equal(2000);
    expect(await stake.nativeWeightBpsForIndependentCount(25)).to.equal(1000);
  });

  it("reverts when rewards exceed funded pool", async () => {
    const { stake, token, stakeAddr, deployer, alice } = await deployStake();
    const fund = 10n * 10n ** 6n;
    await mintAndApprove(token, deployer, stakeAddr, fund);
    await stake.connect(deployer).fundRewards(fund);
    await expect(
      stake.connect(deployer).grantReward(alice.address, 20n * 10n ** 6n),
    ).to.be.revertedWithCustomError(stake, "InsufficientRewardPool");
  });
});
