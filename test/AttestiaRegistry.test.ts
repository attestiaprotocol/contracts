import { expect } from "chai";
import { ethers } from "hardhat";

const MIN = ethers.parseEther("0.1");
const SUBMITTER_STAKE = ethers.parseEther("0.01");
const HASH = ethers.keccak256(ethers.toUtf8Bytes("content"));
const UID = ethers.zeroPadValue("0x01", 32);

describe("AttestiaRegistry", () => {
  async function deployFixture() {
    const [deployer, sub, other] = await ethers.getSigners();
    const Stake = await ethers.getContractFactory("AttestiaStake");
    const stake = await Stake.deploy(MIN);
    await stake.waitForDeployment();
    await stake.connect(sub).registerAsSubmitter();
    const Registry = await ethers.getContractFactory("AttestiaRegistry");
    const reg = await Registry.deploy(await stake.getAddress());
    await reg.waitForDeployment();
    await stake.connect(deployer).setRegistry(await reg.getAddress());
    return { stake, reg, deployer, sub, other };
  }

  it("register and finalize with 90% refund when scores exist", async () => {
    const { stake, reg, sub } = await deployFixture();
    await expect(
      reg.connect(sub).registerMedia(HASH, "ipfs://bafy", { value: SUBMITTER_STAKE }),
    )
      .to.emit(reg, "MediaRegistered")
      .withArgs(1n, sub.address, HASH, "ipfs://bafy");
    expect(await reg.nextAssetId()).to.equal(1n);
    const m = await reg.getMedia(1n);
    expect(m.owner).to.equal(sub.address);
    expect(m.contentHash).to.equal(HASH);
    await ethers.provider.send("evm_increaseTime", [12 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await reg.connect(sub).finalizeWithEAS(1n, UID, 3);
    const m2 = await reg.getMedia(1n);
    expect(m2.easAttestationUid).to.equal(UID);
    expect(m2.refundedAmount).to.equal(ethers.parseEther("0.009"));
    expect(m2.networkFeeAmount).to.equal(ethers.parseEther("0.001"));
    expect(await reg.accruedNetworkFees()).to.equal(ethers.parseEther("0.001"));
    expect(await stake.rewardPoolWei()).to.equal(ethers.parseEther("0.001"));
  });

  it("register media reverts if not submitter", async () => {
    const { stake, reg, other } = await deployFixture();
    await stake.connect(other).stake({ value: MIN });
    await stake.connect(other).registerAsAttester();
    await expect(
      reg.connect(other).registerMedia(HASH, "ipfs://x", { value: SUBMITTER_STAKE }),
    ).to.be.revertedWithCustomError(reg, "NotRegisteredSubmitter");
  });

  it("register media reverts with wrong stake amount", async () => {
    const { reg, sub } = await deployFixture();
    await expect(
      reg.connect(sub).registerMedia(HASH, "ipfs://x", { value: ethers.parseEther("0.005") }),
    ).to.be.revertedWithCustomError(reg, "InvalidContributorStake");
  });

  it("finalize reverts if not media owner", async () => {
    const { reg, sub, other } = await deployFixture();
    await reg.connect(sub).registerMedia(HASH, "ipfs://x", { value: SUBMITTER_STAKE });
    await ethers.provider.send("evm_increaseTime", [12 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      reg.connect(other).finalizeWithEAS(1n, UID, 1),
    ).to.be.revertedWithCustomError(reg, "NotMediaOwner");
  });

  it("finalize reverts if already finalized", async () => {
    const { reg, sub } = await deployFixture();
    await reg.connect(sub).registerMedia(HASH, "ipfs://x", { value: SUBMITTER_STAKE });
    await ethers.provider.send("evm_increaseTime", [12 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await reg.connect(sub).finalizeWithEAS(1n, UID, 1);
    await expect(
      reg.connect(sub).finalizeWithEAS(1n, UID, 1),
    ).to.be.revertedWithCustomError(reg, "AlreadyFinalized");
  });

  it("finalize reverts if verification window is still open", async () => {
    const { reg, sub } = await deployFixture();
    await reg.connect(sub).registerMedia(HASH, "ipfs://x", { value: SUBMITTER_STAKE });
    await expect(
      reg.connect(sub).finalizeWithEAS(1n, UID, 1),
    ).to.be.revertedWithCustomError(reg, "VerificationDeadlineNotReached");
  });

  it("returns 100% when no scores are provided", async () => {
    const { reg, sub } = await deployFixture();
    await reg.connect(sub).registerMedia(HASH, "ipfs://x", { value: SUBMITTER_STAKE });
    await ethers.provider.send("evm_increaseTime", [12 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await reg.connect(sub).finalizeWithEAS(1n, UID, 0);
    const m = await reg.getMedia(1n);
    expect(m.refundedAmount).to.equal(SUBMITTER_STAKE);
    expect(m.networkFeeAmount).to.equal(0n);
  });

  it("allows governance to tune verification window", async () => {
    const { reg, deployer, other, sub } = await deployFixture();
    await expect(
      reg.connect(other).setVerificationWindow(60),
    ).to.be.revertedWithCustomError(reg, "NotGovernance");

    await reg.connect(deployer).setVerificationWindow(60);
    expect(await reg.verificationWindow()).to.equal(60n);

    await reg.connect(sub).registerMedia(HASH, "ipfs://x", { value: SUBMITTER_STAKE });
    const m = await reg.getMedia(1n);
    expect(m.verificationDeadline - m.createdAt).to.equal(60n);
  });

  it("supports governance transfer", async () => {
    const { reg, deployer, other } = await deployFixture();
    await reg.connect(deployer).transferGovernance(other.address);
    expect(await reg.governance()).to.equal(other.address);

    await expect(
      reg.connect(deployer).setVerificationWindow(120),
    ).to.be.revertedWithCustomError(reg, "NotGovernance");
    await reg.connect(other).setVerificationWindow(120);
    expect(await reg.verificationWindow()).to.equal(120n);
  });

  it("allows governance to tune contributor stake in configured range", async () => {
    const { reg, deployer, sub } = await deployFixture();
    await reg.connect(deployer).setContributorMediaStake(ethers.parseEther("0.02"));
    expect(await reg.contributorMediaStake()).to.equal(ethers.parseEther("0.02"));

    await reg.connect(sub).registerMedia(HASH, "ipfs://x", { value: ethers.parseEther("0.02") });
    const m = await reg.getMedia(1n);
    expect(m.contributorStake).to.equal(ethers.parseEther("0.02"));
  });
});
