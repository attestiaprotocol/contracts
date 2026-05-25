import { expect } from "chai";
import { ethers } from "hardhat";

const MIN = ethers.parseEther("0.1");
const SUBMITTER_STAKE = ethers.parseEther("0.01");
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
    numVerifiers?: number;
    verifiers: string[];
    scores: number[];
  }) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "bytes32",
        "uint256",
        "uint32",
        "uint32",
        "bytes32",
        "bytes32",
        "address[]",
        "uint16[]",
      ],
      [
        input.contentHash,
        0n,
        input.numVerifiers ?? input.verifiers.length,
        0,
        ethers.ZeroHash,
        ethers.ZeroHash,
        input.verifiers,
        input.scores,
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

    const Stake = await ethers.getContractFactory("AttestiaStake");
    const stake = (await Stake.deploy(MIN)) as any;
    await stake.waitForDeployment();

    const Registry = await ethers.getContractFactory("AttestiaRegistry");
    const reg = (await Registry.deploy(await stake.getAddress(), await fake.getAddress())) as any;
    await reg.waitForDeployment();
    await stake.connect(deployer).setRegistry(await reg.getAddress());
    const Resolver = await ethers.getContractFactory("AttestiaContributorResolver");
    const resolver = (await Resolver.deploy(await fake.getAddress(), await reg.getAddress())) as any;
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
    stakeValue: bigint;
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
    await input.fake.attest(input.resolver, attestation, { value: input.stakeValue });
    return uid;
  }

  it("registers media from contributor resolver onAttest", async () => {
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
      stakeValue: SUBMITTER_STAKE,
    });

    expect(await reg.nextAssetId()).to.equal(1n);
    expect(await reg.assetIdByContributorAttestation(uid)).to.equal(1n);
    const media = await reg.getMedia(1n);
    expect(media.owner).to.equal(sub.address);
    expect(media.contentHash).to.equal(HASH);
    expect(media.uri).to.equal("ipfs://bafy");
    expect(media.contributorStake).to.equal(SUBMITTER_STAKE);
  });

  it("reverts if contributor stake is wrong during resolver callback", async () => {
    const { fake, reg, resolver, sub } = await deployFixture();
    const uid = ethers.keccak256(ethers.toUtf8Bytes("bad-stake")) as `0x${string}`;
    const attestation = easAttestation(
      sub.address,
      uid,
      contributorData({
        contentHash: HASH,
        mediaUri: "ipfs://x",
        mediaContext: "x",
        contentType: "text/plain",
        verificationDeadline: 1000n,
      }),
    );
    await expect(fake.attest(resolver, attestation, { value: ethers.parseEther("0.005") })).to.be.revertedWithCustomError(
      reg,
      "InvalidContributorStake",
    );
  });

  it("finalizes with 90% refund when aggregate includes scores", async () => {
    const { fake, stake, reg, resolver, sub, verifier } = await deployFixture();
    const uid = await attestContributorMedia({
      fake,
      resolver,
      attesterAddress: sub.address,
      contentHash: HASH,
      mediaUri: "ipfs://bafy",
      mediaContext: "context",
      contentType: "image/png",
      deadline: 9999999999n,
      stakeValue: SUBMITTER_STAKE,
    });

    const aggregateUid = ethers.keccak256(ethers.toUtf8Bytes("aggregate-1")) as `0x${string}`;
    await fake.setAttestation(
      easAttestation(
        sub.address,
        aggregateUid,
        aggregateData({
          contentHash: HASH,
          verifiers: [verifier.address],
          scores: [5000],
        }),
      ),
    );

    await ethers.provider.send("evm_increaseTime", [15 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await reg.connect(sub).finalizeWithEASByContributorUid(
      uid,
      aggregateUid,
    );

    const m = await reg.getMedia(1n);
    expect(m.easAttestationUid).to.equal(aggregateUid);
    expect(m.refundedAmount).to.equal(ethers.parseEther("0.009"));
    expect(m.networkFeeAmount).to.equal(ethers.parseEther("0.001"));
    expect(await reg.accruedNetworkFees()).to.equal(ethers.parseEther("0.001"));
    expect(await stake.rewardPoolWei()).to.equal(ethers.parseEther("0.001"));
  });

  it("returns 100% when aggregate has zero scores", async () => {
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
      stakeValue: SUBMITTER_STAKE,
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
          scores: [],
        }),
      ),
    );

    await ethers.provider.send("evm_increaseTime", [15 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await reg.connect(sub).finalizeWithEASByContributorUid(
      uid,
      aggregateUid,
    );
    const m = await reg.getMedia(1n);
    expect(m.refundedAmount).to.equal(SUBMITTER_STAKE);
    expect(m.networkFeeAmount).to.equal(0n);
  });

  it("returns 100% without aggregate UID when no scores were submitted", async () => {
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
      stakeValue: SUBMITTER_STAKE,
    });

    await ethers.provider.send("evm_increaseTime", [15 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await reg.connect(sub).finalizeWithoutEASByContributorUid(uid);

    const m = await reg.getMedia(1n);
    expect(m.easAttestationUid).to.equal(ethers.ZeroHash);
    expect(m.numScoresProvided).to.equal(0);
    expect(m.refundedAmount).to.equal(SUBMITTER_STAKE);
    expect(m.networkFeeAmount).to.equal(0n);
    expect(await reg.accruedNetworkFees()).to.equal(0n);
  });
});
