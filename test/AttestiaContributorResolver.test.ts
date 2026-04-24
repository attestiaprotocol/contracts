import { expect } from "chai";
import { ethers } from "hardhat";

describe("AttestiaContributorResolver", () => {
  function contributorData(input: {
    contentHash: `0x${string}`;
    mediaUri: string;
    mediaContext: string;
    verificationDeadline: bigint;
  }) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "string", "string", "uint64"],
      [input.contentHash, input.mediaUri, input.mediaContext, input.verificationDeadline],
    );
  }

  function emptyAttestation(attester: string, uid: `0x${string}`, data = "0x") {
    return {
      uid,
      schema: ethers.ZeroHash,
      time: 0,
      expirationTime: 0,
      revocationTime: 0,
      refUID: ethers.ZeroHash,
      recipient: attester,
      attester,
      revocable: true,
      data,
    };
  }

  it("accepts registered contributor and forwards metadata to registry", async () => {
    const [deployer, contributor] = await ethers.getSigners();

    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();

    const Stake = await ethers.getContractFactory("AttestiaStake");
    const stake = await Stake.deploy(ethers.parseEther("0.1"));
    await stake.waitForDeployment();

    const Registry = await ethers.getContractFactory("AttestiaRegistry");
    const registry = await Registry.deploy(await stake.getAddress(), await fake.getAddress());
    await registry.waitForDeployment();
    await stake.connect(deployer).setRegistry(await registry.getAddress());

    const Resolver = await ethers.getContractFactory("AttestiaContributorResolver");
    const resolver = await Resolver.deploy(await fake.getAddress(), await registry.getAddress());
    await resolver.waitForDeployment();
    await registry.connect(deployer).setContributorResolver(await resolver.getAddress());

    const uid = ethers.keccak256(ethers.toUtf8Bytes("contrib-attestation-1"));
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes("media-content"));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const a = emptyAttestation(
      contributor.address,
      uid,
      contributorData({
        contentHash,
        mediaUri: "ipfs://bafy-media",
        mediaContext: "Video clip from event",
        verificationDeadline: deadline,
      }),
    );

    const requiredStake = await registry.contributorMediaStake();
    await expect(fake.attest(await resolver.getAddress(), a, { value: requiredStake })).not.to.be.reverted;

    const stored = await registry.getContributorMediaAttestation(uid);
    expect(stored.exists).to.equal(true);
    expect(stored.assetId).to.equal(1n);
    expect(stored.contributor).to.equal(contributor.address);
    expect(stored.contentHash).to.equal(contentHash);
    expect(stored.mediaUri).to.equal("ipfs://bafy-media");
    expect(stored.mediaContext).to.equal("Video clip from event");
    expect(stored.verificationDeadline).to.equal(deadline);
    expect(await registry.assetIdByContributorAttestation(uid)).to.equal(1n);
  });

  it("accepts contributor without on-chain registration", async () => {
    const [deployer, contributor] = await ethers.getSigners();

    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();

    const Stake = await ethers.getContractFactory("AttestiaStake");
    const stake = await Stake.deploy(ethers.parseEther("0.1"));
    await stake.waitForDeployment();

    const Registry = await ethers.getContractFactory("AttestiaRegistry");
    const registry = await Registry.deploy(await stake.getAddress(), await fake.getAddress());
    await registry.waitForDeployment();
    await stake.connect(deployer).setRegistry(await registry.getAddress());

    const Resolver = await ethers.getContractFactory("AttestiaContributorResolver");
    const resolver = await Resolver.deploy(await fake.getAddress(), await registry.getAddress());
    await resolver.waitForDeployment();
    await registry.connect(deployer).setContributorResolver(await resolver.getAddress());

    const uid = ethers.keccak256(ethers.toUtf8Bytes("contrib-attestation-2"));
    const a = emptyAttestation(
      contributor.address,
      uid,
      contributorData({
        contentHash: ethers.keccak256(ethers.toUtf8Bytes("x")),
        mediaUri: "ipfs://x",
        mediaContext: "x",
        verificationDeadline: 1000n,
      }),
    );

    const requiredStake = await registry.contributorMediaStake();
    await expect(fake.attest(await resolver.getAddress(), a, { value: requiredStake })).not.to.be.reverted;
  });
});
