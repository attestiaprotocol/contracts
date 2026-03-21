import { expect } from "chai";
import { ethers } from "hardhat";

describe("AttestiaAggregateResolver", () => {
  function emptyAttestation(attester: string) {
    return {
      uid: ethers.ZeroHash,
      schema: ethers.ZeroHash,
      time: 0,
      expirationTime: 0,
      revocationTime: 0,
      refUID: ethers.ZeroHash,
      recipient: ethers.ZeroAddress,
      attester,
      revocable: true,
      data: "0x",
    };
  }

  it("allows attest when attester matches deployer", async () => {
    const [deployer] = await ethers.getSigners();
    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();
    const fakeAddr = await fake.getAddress();

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(fakeAddr);
    await resolver.waitForDeployment();

    expect(await resolver.authorizedAttester()).to.equal(deployer.address);

    const a = emptyAttestation(deployer.address);
    await expect(fake.attest(await resolver.getAddress(), a)).not.to.be.reverted;
  });

  it("reverts when attester is not the authorized address", async () => {
    const [deployer, other] = await ethers.getSigners();
    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();
    const fakeAddr = await fake.getAddress();

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(fakeAddr);
    await resolver.waitForDeployment();

    const a = emptyAttestation(other.address);
    await expect(fake.attest(await resolver.getAddress(), a)).to.be.revertedWithCustomError(
      resolver,
      "UnauthorizedAttester",
    );
  });
});
