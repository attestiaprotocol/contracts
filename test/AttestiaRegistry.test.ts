import { expect } from "chai";
import { ethers } from "hardhat";

const MIN = ethers.parseEther("0.01");
const HASH = ethers.keccak256(ethers.toUtf8Bytes("content"));
const UID = ethers.zeroPadValue("0x01", 32);

describe("AttestiaRegistry", () => {
  async function deployFixture() {
    const [deployer, sub, other] = await ethers.getSigners();
    const Stake = await ethers.getContractFactory("AttestiaStake");
    const stake = await Stake.deploy(MIN);
    await stake.waitForDeployment();
    await stake.connect(sub).stake({ value: MIN });
    await stake.connect(sub).registerAsSubmitter();
    const Registry = await ethers.getContractFactory("AttestiaRegistry");
    const reg = await Registry.deploy(await stake.getAddress());
    await reg.waitForDeployment();
    return { stake, reg, deployer, sub, other };
  }

  it("register and finalize", async () => {
    const { reg, sub } = await deployFixture();
    await expect(reg.connect(sub).registerMedia(HASH, "ipfs://bafy"))
      .to.emit(reg, "MediaRegistered")
      .withArgs(1n, sub.address, HASH, "ipfs://bafy");
    expect(await reg.nextAssetId()).to.equal(1n);
    const m = await reg.getMedia(1n);
    expect(m.owner).to.equal(sub.address);
    expect(m.contentHash).to.equal(HASH);
    await reg.connect(sub).finalizeWithEAS(1n, UID);
    const m2 = await reg.getMedia(1n);
    expect(m2.easAttestationUid).to.equal(UID);
  });

  it("register media reverts if not submitter", async () => {
    const { stake, reg, other } = await deployFixture();
    await stake.connect(other).stake({ value: MIN });
    await stake.connect(other).registerAsAttester();
    await expect(
      reg.connect(other).registerMedia(HASH, "ipfs://x"),
    ).to.be.revertedWithCustomError(reg, "NotRegisteredSubmitter");
  });

  it("finalize reverts if not media owner", async () => {
    const { reg, sub, other } = await deployFixture();
    await reg.connect(sub).registerMedia(HASH, "ipfs://x");
    await expect(
      reg.connect(other).finalizeWithEAS(1n, UID),
    ).to.be.revertedWithCustomError(reg, "NotMediaOwner");
  });

  it("finalize reverts if already finalized", async () => {
    const { reg, sub } = await deployFixture();
    await reg.connect(sub).registerMedia(HASH, "ipfs://x");
    await reg.connect(sub).finalizeWithEAS(1n, UID);
    await expect(
      reg.connect(sub).finalizeWithEAS(1n, UID),
    ).to.be.revertedWithCustomError(reg, "AlreadyFinalized");
  });
});
