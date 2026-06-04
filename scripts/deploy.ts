import { ethers, network, run } from "hardhat";

const EAS_BY_CHAIN: Record<number, string> = {
  84532: "0x4200000000000000000000000000000000000021",
  8453: "0x4200000000000000000000000000000000000021",
};

/** Circle USDC on Base (6 decimals). Lowercase; normalized via getAddress at runtime. */
const USDC_BY_CHAIN: Record<number, string> = {
  84532: "0x036cbd53842c542663c208eecbc9e7bd40e6683b",
  8453: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};

/** Rounded from former ETH amounts at ~$3.5k/ETH (6-decimal USDC). */
const DEFAULT_MIN_STAKE = 350n * 10n ** 6n; // 0.1 ETH → 350 USDC
const DEFAULT_BASE_REWARD = 7n * 10n ** 6n; // 0.002 ETH → 7 USDC per round

async function verifyContract(address: string, constructorArguments: unknown[]) {
  if (network.name === "hardhat" || network.name === "localhost") {
    console.log(`Skipping verification on ${network.name}`);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 20_000));

  try {
    await run("verify:verify", { address, constructorArguments });
    console.log("Verified", address);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified", address);
      return;
    }
    throw error;
  }
}

async function main() {
  const minStake = process.env.MIN_STAKE_AMOUNT
    ? BigInt(process.env.MIN_STAKE_AMOUNT)
    : DEFAULT_MIN_STAKE;
  const baseRewardPerRound = process.env.BASE_REWARD_PER_ROUND_AMOUNT
    ? BigInt(process.env.BASE_REWARD_PER_ROUND_AMOUNT)
    : DEFAULT_BASE_REWARD;

  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const eas = EAS_BY_CHAIN[chainId];
  if (!eas) {
    throw new Error(`No EAS address configured for chainId ${chainId}`);
  }

  const stakeTokenRaw = process.env.STAKE_TOKEN_ADDRESS?.trim();
  const stakeTokenCandidate = stakeTokenRaw && ethers.isAddress(stakeTokenRaw)
    ? stakeTokenRaw
    : USDC_BY_CHAIN[chainId];
  if (!stakeTokenCandidate) {
    throw new Error(
      `Set STAKE_TOKEN_ADDRESS or deploy on Base/Base Sepolia (known USDC: ${JSON.stringify(USDC_BY_CHAIN)})`,
    );
  }
  const stakeToken = ethers.getAddress(stakeTokenCandidate.toLowerCase());

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("EAS:", eas);
  console.log("Stake token (ERC-20):", stakeToken);

  const Stake = await ethers.getContractFactory("AttestiaStake");
  const stake = await Stake.deploy(stakeToken, minStake, baseRewardPerRound);
  await stake.waitForDeployment();
  const stakeAddr = await stake.getAddress();
  console.log("AttestiaStake", stakeAddr);
  console.log("minStake", minStake.toString());
  console.log("baseRewardPerRound", baseRewardPerRound.toString());
  await verifyContract(stakeAddr, [stakeToken, minStake, baseRewardPerRound]);

  const Registry = await ethers.getContractFactory("AttestiaRegistry");
  const registry = await Registry.deploy(stakeAddr, eas);
  await registry.waitForDeployment();
  const regAddr = await registry.getAddress();
  await verifyContract(regAddr, [stakeAddr, eas]);
  await stake.setRegistry(regAddr);
  console.log("AttestiaRegistry", regAddr);
  console.log("Registry linked in AttestiaStake");

  const nativeRaw = process.env.ATTESTIA_NATIVE_ATTESTER?.trim();
  if (nativeRaw && ethers.isAddress(nativeRaw)) {
    const native = ethers.getAddress(nativeRaw);
    await stake.setNativeAttester(native);
    console.log("nativeAttester", native);
  } else if (nativeRaw) {
    console.warn("ATTESTIA_NATIVE_ATTESTER is set but not a valid address — skipped");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
