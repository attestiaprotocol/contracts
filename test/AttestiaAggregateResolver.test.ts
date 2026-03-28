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

    const Stake = await ethers.getContractFactory("AttestiaStake");
    const stake = await Stake.deploy(ethers.parseEther("0.01"));
    await stake.waitForDeployment();

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(
      fakeAddr,
      await stake.getAddress(),
    );
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

    const Stake = await ethers.getContractFactory("AttestiaStake");
    const stake = await Stake.deploy(ethers.parseEther("0.01"));
    await stake.waitForDeployment();

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(
      fakeAddr,
      await stake.getAddress(),
    );
    await resolver.waitForDeployment();

    const a = emptyAttestation(other.address);
    await expect(fake.attest(await resolver.getAddress(), a)).to.be.revertedWithCustomError(
      resolver,
      "UnauthorizedAttester",
    );
  });

  it("publishes reviewer scores once per accepted aggregate", async () => {
    const [deployer, v1, v2, v3, v4, v5] = await ethers.getSigners();

    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();

    const Stake = await ethers.getContractFactory("AttestiaStake");
    const stake = await Stake.deploy(ethers.parseEther("0.01"));
    await stake.waitForDeployment();
    await stake.connect(deployer).setBaseRewardPerRound(ethers.parseEther("0.001"));

    for (const verifier of [v1, v2, v3, v4, v5]) {
      await stake.connect(verifier).stake({ value: ethers.parseEther("0.01") });
      await stake.connect(verifier).registerAsAttester();
    }

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(
      await fake.getAddress(),
      await stake.getAddress(),
    );
    await resolver.waitForDeployment();
    await stake
      .connect(deployer)
      .setPerformanceReporter(await resolver.getAddress());

    const uid = ethers.keccak256(ethers.toUtf8Bytes("aggregate-1"));
    const a = {
      ...emptyAttestation(deployer.address),
      uid,
    };
    await fake.attest(await resolver.getAddress(), a);

    await expect(
      resolver.publishReviewerScores(
        uid,
        [v1.address, v2.address, v3.address, v4.address, v5.address],
        [5000, 5000, 5000, 8500, 5000],
      ),
    ).not.to.be.reverted;

    const perf = await stake.verifierPerformance(v4.address);
    expect(perf.slashCount).to.equal(1n);
    expect(await resolver.aggregateProcessed(uid)).to.equal(true);

    await expect(
      resolver.publishReviewerScores(
        uid,
        [v1.address, v2.address, v3.address, v4.address, v5.address],
        [5000, 5000, 5000, 8500, 5000],
      ),
    ).to.be.revertedWithCustomError(resolver, "AggregateAlreadyProcessed");
  });
});
