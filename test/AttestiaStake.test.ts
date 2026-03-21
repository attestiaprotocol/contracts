import { expect } from "chai";
import { ethers } from "hardhat";

const MIN = ethers.parseEther("0.01");

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

  it("register reverts without stake", async () => {
    const { stake, alice } = await deployStake();
    await expect(
      stake.connect(alice).registerAsSubmitter(),
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
});
