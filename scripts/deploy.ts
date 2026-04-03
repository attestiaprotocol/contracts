import { ethers, network, run } from "hardhat";

const EAS_BY_CHAIN: Record<number, string> = {
  84532: "0x4200000000000000000000000000000000000021",
  8453: "0x4200000000000000000000000000000000000021",
};

async function verifyContract(address: string, constructorArguments: unknown[]) {
  if (network.name === "hardhat" || network.name === "localhost") {
    console.log(`Skipping verification on ${network.name}`);
    return;
  }

  // Let the explorer index bytecode before submitting verification.
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
  const minStakeWei = process.env.MIN_STAKE_WEI
    ? BigInt(process.env.MIN_STAKE_WEI)
    : ethers.parseEther("0.1");

  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const eas = EAS_BY_CHAIN[chainId];
  if (!eas) {
    throw new Error(`No EAS address configured for chainId ${chainId}`);
  }
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("EAS:", eas);

  const Stake = await ethers.getContractFactory("AttestiaStake");
  const stake = await Stake.deploy(minStakeWei);
  await stake.waitForDeployment();
  const stakeAddr = await stake.getAddress();
  console.log("AttestiaStake", stakeAddr);
  await verifyContract(stakeAddr, [minStakeWei]);

  const Registry = await ethers.getContractFactory("AttestiaRegistry");
  const registry = await Registry.deploy(stakeAddr, eas);
  await registry.waitForDeployment();
  const regAddr = await registry.getAddress();
  await verifyContract(regAddr, [stakeAddr, eas]);
  await stake.setRegistry(regAddr);
  console.log("AttestiaRegistry", regAddr);
  console.log("Registry linked in AttestiaStake");
  console.log("minStakeWei", minStakeWei.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
