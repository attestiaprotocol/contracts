import { expect } from "chai";
import { ethers } from "hardhat";

const MIN = ethers.parseEther("0.1");

describe("AttestiaStake", () => {
  async function deployStake() {
    const [deployer, alice, bob] = await ethers.getSigners();
    const Stake = await ethers.getContractFactory("AttestiaStake");
    const stake = await Stake.deploy(MIN);
    await stake.waitForDeployment();
    return { stake, deployer, alice, bob };
  }

  it("stake meets min", async () => {
    const { stake, alice } = await deployStake();
    await stake.connect(alice).stake({ value: MIN });
    expect(await stake.staked(alice.address)).to.equal(MIN);
  });

  it("stake reverts below min", async () => {
    const { stake, alice } = await deployStake();
    await expect(
      stake.connect(alice).stake({ value: MIN - 1n }),
    ).to.be.revertedWithCustomError(stake, "BelowMinStake");
  });

  it("register submitter after stake", async () => {
    const { stake, alice } = await deployStake();
    await stake.connect(alice).stake({ value: MIN });
    await stake.connect(alice).registerAsSubmitter();
    expect(await stake.isSubmitter(alice.address)).to.equal(true);
    expect(await stake.submittersLength()).to.equal(1n);
    expect(await stake.submitterAt(0)).to.equal(alice.address);
    expect(await stake.roleOf(alice.address)).to.equal(1n);
  });

  it("register attester after stake", async () => {
    const { stake, bob } = await deployStake();
    await stake.connect(bob).stake({ value: MIN });
    await stake.connect(bob).registerAsAttester();
    expect(await stake.isAttester(bob.address)).to.equal(true);
    expect(await stake.attestersLength()).to.equal(1n);
    expect(await stake.attesterAt(0)).to.equal(bob.address);
  });

  it("submitter register works without stake", async () => {
    const { stake, alice } = await deployStake();
    await stake.connect(alice).registerAsSubmitter();
    expect(await stake.isSubmitter(alice.address)).to.equal(true);
  });

  it("attester register still reverts without stake", async () => {
    const { stake, alice } = await deployStake();
    await expect(
      stake.connect(alice).registerAsAttester(),
    ).to.be.revertedWithCustomError(stake, "BelowMinStake");
  });

  it("register reverts double role", async () => {
    const { stake, alice } = await deployStake();
    await stake.connect(alice).stake({ value: MIN });
    await stake.connect(alice).registerAsSubmitter();
    await expect(
      stake.connect(alice).registerAsAttester(),
    ).to.be.revertedWithCustomError(stake, "AlreadyRegistered");
  });

  it("withdraw", async () => {
    const { stake, alice } = await deployStake();
    await stake.connect(alice).stake({ value: MIN });
    await stake.connect(alice).withdraw(MIN / 2n);
    expect(await stake.staked(alice.address)).to.equal(MIN / 2n);
  });

  it("slash", async () => {
    const { stake, deployer, alice } = await deployStake();
    await stake.connect(alice).stake({ value: MIN });
    await stake
      .connect(deployer)
      .slash(alice.address, ethers.parseEther("0.005"), "bad attestation");
    expect(await stake.slashAccumulator(alice.address)).to.equal(
      ethers.parseEther("0.005"),
    );
    expect(await stake.staked(alice.address)).to.equal(
      MIN - ethers.parseEther("0.005"),
    );
  });

  it("rewards", async () => {
    const { stake, deployer, alice } = await deployStake();
    await stake.connect(alice).stake({ value: MIN });
    await stake.connect(deployer).fundRewards({ value: ethers.parseEther("1") });
    await stake
      .connect(deployer)
      .grantReward(alice.address, ethers.parseEther("0.25"));
    await expect(stake.connect(alice).claimRewards()).to.changeEtherBalance(
      alice,
      ethers.parseEther("0.25"),
    );
  });

  it("claim reverts with no rewards", async () => {
    const { stake, alice } = await deployStake();
    await expect(
      stake.connect(alice).claimRewards(),
    ).to.be.revertedWithCustomError(stake, "NoRewards");
  });

  it("tracks performance and applies phase-1 slashing", async () => {
    const { stake, deployer, alice, bob } = await deployStake();
    const [, , , dave, eve, frank] = await ethers.getSigners();

    await stake.connect(deployer).setBaseRewardPerRound(ethers.parseEther("0.001"));
    await stake.connect(deployer).fundRewards({ value: ethers.parseEther("1") });

    for (const verifier of [alice, bob, dave, eve, frank]) {
      await stake.connect(verifier).stake({ value: MIN });
      await stake.connect(verifier).registerAsAttester();
    }

    await stake.processAggregateScores(
      ethers.keccak256(ethers.toUtf8Bytes("round-1")),
      [alice.address, bob.address, dave.address, eve.address, frank.address],
      [5000, 5000, 5000, 8500, 5000],
    );

    const perfOutlier = await stake.verifierPerformance(eve.address);
    expect(perfOutlier.slashCount).to.equal(1n);
    expect(perfOutlier.consecutiveGood).to.equal(0n);
    expect(await stake.suspendedUntilRound(eve.address)).to.equal(2n);
  });

  it("does not slash in bootstrapping phase", async () => {
    const { stake, deployer, alice, bob } = await deployStake();
    const [, , , dave] = await ethers.getSigners();

    await stake.connect(deployer).setBaseRewardPerRound(ethers.parseEther("0.001"));
    await stake.connect(deployer).fundRewards({ value: ethers.parseEther("1") });

    for (const verifier of [alice, bob, dave]) {
      await stake.connect(verifier).stake({ value: MIN });
      await stake.connect(verifier).registerAsAttester();
    }

    await stake.processAggregateScores(
      ethers.keccak256(ethers.toUtf8Bytes("round-bootstrap")),
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
    await stake.connect(deployer).setDeviationThresholds(2300, 1800);
    await stake.connect(deployer).setSlashingParams(1_500_000, 900, 2500);
    await stake.connect(deployer).setReputationParams(35000, 7000, 6000, 14000);

    expect(await stake.phase0RewardBps()).to.equal(4500);
    expect(await stake.phase1RewardBps()).to.equal(7500);
    expect(await stake.phase2RewardBps()).to.equal(10000);
    expect(await stake.alignmentWeightBps()).to.equal(8500);
    expect(await stake.influenceWeightBps()).to.equal(1500);
    expect(await stake.phase1DeviationThresholdBps()).to.equal(2300);
    expect(await stake.phase2DeviationThresholdBps()).to.equal(1800);
    expect(await stake.phase1VarianceThresholdBps2()).to.equal(1_500_000n);
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
      stake.connect(deployer).setDeviationThresholds(10001, 2000),
    ).to.be.revertedWithCustomError(stake, "InvalidParam");

    await expect(
      stake.connect(deployer).setSlashingParams(100_000_001, 500, 500),
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

    await stake.connect(deployer).setBaseRewardPerRound(ethers.parseEther("0.002"));
    await stake.connect(deployer).setPhaseRewardBps(4200, 7800, 10000);
    await stake.connect(deployer).setRewardWeights(7000, 3000);
    await stake.connect(deployer).setDeviationThresholds(2100, 1700);
    await stake.connect(deployer).setSlashingParams(1_600_000, 800, 2200);
    await stake.connect(deployer).setReputationParams(33000, 7500, 6500, 14500);

    const cfg = await stake.getEconomicConfig();
    expect(cfg.baseRewardPerRound).to.equal(ethers.parseEther("0.002"));
    expect(cfg.phase0RewardBps).to.equal(4200);
    expect(cfg.phase1RewardBps).to.equal(7800);
    expect(cfg.phase2RewardBps).to.equal(10000);
    expect(cfg.alignmentWeightBps).to.equal(7000);
    expect(cfg.influenceWeightBps).to.equal(3000);
    expect(cfg.phase1DeviationThresholdBps).to.equal(2100);
    expect(cfg.phase2DeviationThresholdBps).to.equal(1700);
    expect(cfg.phase1VarianceThresholdBps2).to.equal(1_600_000n);
    expect(cfg.phase1SlashBps).to.equal(800);
    expect(cfg.phase2SlashBps).to.equal(2200);
    expect(cfg.alphaBps).to.equal(33000);
    expect(cfg.reputationLambdaBps).to.equal(7500);
    expect(cfg.reputationMinBps).to.equal(6500);
    expect(cfg.reputationMaxBps).to.equal(14500);
  });

  it("reverts when rewards exceed funded pool", async () => {
    const { stake, deployer, alice } = await deployStake();
    await stake.connect(deployer).fundRewards({ value: ethers.parseEther("0.01") });
    await expect(
      stake.connect(deployer).grantReward(alice.address, ethers.parseEther("0.02")),
    ).to.be.revertedWithCustomError(stake, "InsufficientRewardPool");
  });
});
