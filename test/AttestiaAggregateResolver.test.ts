import { expect } from "chai";
import { ethers } from "hardhat";
import {
  BASE_REWARD,
  deployAttestiaStake,
  mintAndApprove,
  MIN_STAKE,
  stakeAsAttester,
} from "./helpers/stakeToken";

describe("AttestiaAggregateResolver", () => {
  function aggregateData(input: {
    aggregateDeepFakeRiskScore?: number;
    numVerifiers?: number;
    verifiers: string[];
    deepfakeRiskScores: number[];
    evaluationScoreReasons?: string[];
  }) {
    const evaluationScoreReasons =
      input.evaluationScoreReasons ?? input.deepfakeRiskScores.map(() => "");
    return ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "bytes32",
        "uint16",
        "uint32",
        "bytes32",
        "bytes32",
        "address[]",
        "uint16[]",
        "string[]",
      ],
      [
        ethers.keccak256(ethers.toUtf8Bytes("content")),
        input.aggregateDeepFakeRiskScore ?? 0,
        input.numVerifiers ?? input.verifiers.length,
        ethers.ZeroHash,
        ethers.ZeroHash,
        input.verifiers,
        input.deepfakeRiskScores,
        evaluationScoreReasons,
      ],
    );
  }

  function emptyAttestation(attester: string, data = "0x") {
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
      data,
    };
  }

  it("allows attest when attester matches deployer", async () => {
    const [deployer, verifier] = await ethers.getSigners();
    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();
    const fakeAddr = await fake.getAddress();

    const { token, stake, stakeAddr } = await deployAttestiaStake();
    await mintAndApprove(token, deployer, stakeAddr, 10n ** 9n);
    await stake.connect(deployer).fundRewards(10n ** 9n);
    await stakeAsAttester(token, stake, stakeAddr, verifier);

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(
      fakeAddr,
      stakeAddr,
    );
    await resolver.waitForDeployment();
    await stake.connect(deployer).setPerformanceReporter(await resolver.getAddress());

    expect(await resolver.authorizedAttester()).to.equal(deployer.address);

    const a = emptyAttestation(
      deployer.address,
      aggregateData({
        verifiers: [verifier.address],
        deepfakeRiskScores: [5000],
      }),
    );
    await expect(fake.attest(await resolver.getAddress(), a)).not.to.be.reverted;
  });

  it("reverts when attester is not the authorized address", async () => {
    const [deployer, other] = await ethers.getSigners();
    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();
    const fakeAddr = await fake.getAddress();

    const { stake, stakeAddr } = await deployAttestiaStake();

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(fakeAddr, stakeAddr);
    await resolver.waitForDeployment();

    const a = emptyAttestation(other.address);
    await expect(fake.attest(await resolver.getAddress(), a)).to.be.revertedWithCustomError(
      resolver,
      "UnauthorizedAttester",
    );
  });

  it("processes reviewer scores in onAttest", async () => {
    const [deployer, v1, v2, v3, v4, v5] = await ethers.getSigners();

    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();

    const { token, stake, stakeAddr } = await deployAttestiaStake();
    const fund = 1_000_000n * 10n ** 6n;
    await stake.connect(deployer).setBaseRewardPerRound(BASE_REWARD);
    await mintAndApprove(token, deployer, stakeAddr, fund);
    await stake.connect(deployer).fundRewards(fund);

    for (const verifier of [v1, v2, v3, v4, v5]) {
      await stakeAsAttester(token, stake, stakeAddr, verifier);
    }

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(
      await fake.getAddress(),
      stakeAddr,
    );
    await resolver.waitForDeployment();
    await stake
      .connect(deployer)
      .setPerformanceReporter(await resolver.getAddress());

    const uid = ethers.keccak256(ethers.toUtf8Bytes("aggregate-1"));
    const a = {
      ...emptyAttestation(deployer.address),
      uid,
      data: aggregateData({
        verifiers: [v1.address, v2.address, v3.address, v4.address, v5.address],
        deepfakeRiskScores: [6000, 6000, 6000, 4000, 6000],
      }),
    };
    await expect(fake.attest(await resolver.getAddress(), a)).not.to.be.reverted;

    const perf = await stake.verifierPerformance(v4.address);
    expect(perf.slashCount).to.equal(1n);
    expect(await stake.currentRoundId()).to.equal(1n);
  });

  it("reverts when independent count does not match numVerifiers", async () => {
    const [deployer, verifier] = await ethers.getSigners();
    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();

    const { token, stake, stakeAddr } = await deployAttestiaStake();

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(
      await fake.getAddress(),
      stakeAddr,
    );
    await resolver.waitForDeployment();
    await stake.connect(deployer).setPerformanceReporter(await resolver.getAddress());
    await stakeAsAttester(token, stake, stakeAddr, verifier);

    const a = emptyAttestation(
      deployer.address,
      aggregateData({
        numVerifiers: 2,
        verifiers: [verifier.address],
        deepfakeRiskScores: [5000],
      }),
    );
    await expect(fake.attest(await resolver.getAddress(), a)).to.be.revertedWithCustomError(
      resolver,
      "InvalidParticipantVectors",
    );
  });

  it("reverts when evaluationScoreReasons length does not match scores", async () => {
    const [deployer, verifier] = await ethers.getSigners();
    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();

    const { token, stake, stakeAddr } = await deployAttestiaStake();

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(
      await fake.getAddress(),
      stakeAddr,
    );
    await resolver.waitForDeployment();
    await stake.connect(deployer).setPerformanceReporter(await resolver.getAddress());
    await stakeAsAttester(token, stake, stakeAddr, verifier);

    const a = emptyAttestation(
      deployer.address,
      aggregateData({
        verifiers: [verifier.address],
        deepfakeRiskScores: [5000],
        evaluationScoreReasons: ["facial artifacts", "audio mismatch"],
      }),
    );
    await expect(fake.attest(await resolver.getAddress(), a)).to.be.revertedWithCustomError(
      resolver,
      "InvalidScoreVectors",
    );
  });

  it("accepts aggregate with native attester plus independents", async () => {
    const [deployer, verifier, native] = await ethers.getSigners();
    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();

    const { token, stake, stakeAddr } = await deployAttestiaStake();
    await mintAndApprove(token, deployer, stakeAddr, 10n ** 9n);
    await stake.connect(deployer).fundRewards(10n ** 9n);
    await stake.connect(deployer).setNativeAttester(native.address);

    const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
    const resolver = await Resolver.connect(deployer).deploy(
      await fake.getAddress(),
      stakeAddr,
    );
    await resolver.waitForDeployment();
    await stake.connect(deployer).setPerformanceReporter(await resolver.getAddress());
    await stakeAsAttester(token, stake, stakeAddr, verifier);

    const a = emptyAttestation(
      deployer.address,
      aggregateData({
        numVerifiers: 1,
        verifiers: [native.address, verifier.address],
        deepfakeRiskScores: [8000, 5000],
      }),
    );
    await expect(fake.attest(await resolver.getAddress(), a)).not.to.be.reverted;
    expect(await stake.pendingRewards(native.address)).to.equal(0n);
  });
});
