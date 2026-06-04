import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAttestiaStake } from "./helpers/stakeToken";

const HASH = ethers.keccak256(ethers.toUtf8Bytes("content")) as `0x${string}`;

describe("AttestiaRegistry", () => {
  function contributorData(input: {
    contentHash: `0x${string}`;
    mediaUri: string;
    mediaContext: string;
    contentType: string;
    verificationDeadline: bigint;
  }) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "string", "string", "string", "uint64"],
      [input.contentHash, input.mediaUri, input.mediaContext, input.contentType, input.verificationDeadline],
    ) as `0x${string}`;
  }

  function aggregateData(input: {
    contentHash: `0x${string}`;
    aggregateDeepFakeRiskScore?: number;
    numVerifiers?: number;
    verifiers: string[];
    deepfakeRiskScores: number[];
  }) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "bytes32",
        "uint16",
        "uint32",
        "bytes32",
        "bytes32",
        "address[]",
        "uint16[]",
      ],
      [
        input.contentHash,
        input.aggregateDeepFakeRiskScore ?? 0,
        input.numVerifiers ?? input.verifiers.length,
        ethers.ZeroHash,
        ethers.ZeroHash,
        input.verifiers,
        input.deepfakeRiskScores,
      ],
    ) as `0x${string}`;
  }

  function easAttestation(attester: string, uid: `0x${string}`, data: `0x${string}`) {
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

  async function deployFixture() {
    const [deployer, sub, other, verifier] = await ethers.getSigners();
    const Fake = await ethers.getContractFactory("FakeEAS");
    const fake = await Fake.deploy();
    await fake.waitForDeployment();

    const { stake, stakeAddr } = await deployAttestiaStake();
    const Registry = await ethers.getContractFactory("AttestiaRegistry");
    const reg = (await Registry.deploy(stakeAddr, await fake.getAddress())) as any;
    await reg.waitForDeployment();
    const regAddr = await reg.getAddress();
    await stake.connect(deployer).setRegistry(regAddr);

    const Resolver = await ethers.getContractFactory("AttestiaContributorResolver");
    const resolver = (await Resolver.deploy(await fake.getAddress(), regAddr)) as any;
    await resolver.waitForDeployment();
    await reg.connect(deployer).setContributorResolver(await resolver.getAddress());

    return { fake, stake, reg, resolver, deployer, sub, other, verifier };
  }

  async function attestContributorMedia(input: {
    fake: any;
    resolver: any;
    attesterAddress: string;
    contentHash: `0x${string}`;
    mediaUri: string;
    mediaContext: string;
    contentType: string;
    deadline: bigint;
    uid?: `0x${string}`;
  }) {
    const uid = (input.uid ?? ethers.keccak256(ethers.toUtf8Bytes(`contrib-${Date.now()}`))) as `0x${string}`;
    const attestation = easAttestation(
      input.attesterAddress,
      uid,
      contributorData({
        contentHash: input.contentHash,
        mediaUri: input.mediaUri,
        mediaContext: input.mediaContext,
        contentType: input.contentType,
        verificationDeadline: input.deadline,
      }),
    );
    await input.fake.attest(input.resolver, attestation);
    return uid;
  }

  it("registers media from contributor resolver onAttest without stake", async () => {
    const { fake, reg, resolver, sub } = await deployFixture();
    const uid = await attestContributorMedia({
      fake,
      resolver,
      attesterAddress: sub.address,
      contentHash: HASH,
      mediaUri: "ipfs://bafy",
      mediaContext: "context",
      contentType: "image/png",
      deadline: 9999999999n,
    });

    expect(await reg.nextAssetId()).to.equal(1n);
    expect(await reg.assetIdByContributorAttestation(uid)).to.equal(1n);
    const media = await reg.getMedia(1n);
    expect(media.owner).to.equal(sub.address);
    expect(media.contentHash).to.equal(HASH);
    expect(media.uri).to.equal("ipfs://bafy");
    expect(media.finalized).to.equal(false);
  });

  it("finalizes with score count when aggregate includes verifiers", async () => {
    const { fake, reg, resolver, sub, verifier } = await deployFixture();
    const uid = await attestContributorMedia({
      fake,
      resolver,
      attesterAddress: sub.address,
      contentHash: HASH,
      mediaUri: "ipfs://bafy",
      mediaContext: "context",
      contentType: "image/png",
      deadline: 9999999999n,
    });

    const aggregateUid = ethers.keccak256(ethers.toUtf8Bytes("aggregate-1")) as `0x${string}`;
    await fake.setAttestation(
      easAttestation(
        sub.address,
        aggregateUid,
        aggregateData({
          contentHash: HASH,
          verifiers: [verifier.address],
          deepfakeRiskScores: [5000],
        }),
      ),
    );

    await ethers.provider.send("evm_increaseTime", [15 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await reg.connect(sub).finalizeWithEASByContributorUid(uid, aggregateUid);

    const m = await reg.getMedia(1n);
    expect(m.easAttestationUid).to.equal(aggregateUid);
    expect(m.numScoresProvided).to.equal(1);
    expect(m.finalized).to.equal(true);
  });

  it("finalizes with zero scores when aggregate has no verifiers", async () => {
    const { fake, reg, resolver, sub } = await deployFixture();
    const uid = await attestContributorMedia({
      fake,
      resolver,
      attesterAddress: sub.address,
      contentHash: HASH,
      mediaUri: "ipfs://x",
      mediaContext: "x",
      contentType: "video/mp4",
      deadline: 9999999999n,
    });

    const aggregateUid = ethers.keccak256(ethers.toUtf8Bytes("aggregate-2")) as `0x${string}`;
    await fake.setAttestation(
      easAttestation(
        sub.address,
        aggregateUid,
        aggregateData({
          contentHash: HASH,
          numVerifiers: 0,
          verifiers: [],
          deepfakeRiskScores: [],
        }),
      ),
    );

    await ethers.provider.send("evm_increaseTime", [15 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await reg.connect(sub).finalizeWithEASByContributorUid(uid, aggregateUid);

    const m = await reg.getMedia(1n);
    expect(m.numScoresProvided).to.equal(0);
    expect(m.finalized).to.equal(true);
  });

  it("finalizes without aggregate UID when no scores were submitted", async () => {
    const { reg, resolver, fake, sub } = await deployFixture();
    const uid = await attestContributorMedia({
      fake,
      resolver,
      attesterAddress: sub.address,
      contentHash: HASH,
      mediaUri: "ipfs://noscore",
      mediaContext: "no scores",
      contentType: "audio/mpeg",
      deadline: 9999999999n,
    });

    await ethers.provider.send("evm_increaseTime", [15 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await reg.connect(sub).finalizeWithoutEASByContributorUid(uid);

    const m = await reg.getMedia(1n);
    expect(m.easAttestationUid).to.equal(ethers.ZeroHash);
    expect(m.numScoresProvided).to.equal(0);
    expect(m.finalized).to.equal(true);
  });
});
