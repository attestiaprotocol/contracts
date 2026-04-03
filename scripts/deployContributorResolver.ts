/**
 * Deploy AttestiaContributorResolver.
 *
 *   npx hardhat run scripts/deployContributorResolver.ts --network baseSepolia
 *
 * Requires `ATTESTIA_REGISTRY` (deployed AttestiaRegistry address).
 *
 * Then set `ATTESTIA_CONTRIBUTOR_RESOLVER` in `.env` and run
 * `registerEasContributorOnchainSchema.ts` (or `eas:register-all`).
 */
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
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const eas = EAS_BY_CHAIN[chainId];
  if (!eas) {
    throw new Error(`No EAS address configured for chainId ${chainId}`);
  }

  const registryRaw = process.env.ATTESTIA_REGISTRY?.trim();
  if (!registryRaw || !ethers.isAddress(registryRaw)) {
    throw new Error("ATTESTIA_REGISTRY must be set to a valid contract address");
  }
  const registryAddress = ethers.getAddress(registryRaw);

  console.log("Chain", chainId);
  console.log("EAS", eas);
  console.log("Registry", registryAddress);
  console.log("Deployer", deployer.address);

  const Resolver = await ethers.getContractFactory("AttestiaContributorResolver");
  const resolver = await Resolver.deploy(eas, registryAddress);
  await resolver.waitForDeployment();
  const resolverAddress = await resolver.getAddress();
  await verifyContract(resolverAddress, [eas, registryAddress]);

  const registry = await ethers.getContractAt("AttestiaRegistry", registryAddress);
  const governance = await registry.governance();
  if (governance.toLowerCase() === deployer.address.toLowerCase()) {
    const tx = await registry.setContributorResolver(resolverAddress);
    await tx.wait();
    console.log("Registry contributorResolver ->", resolverAddress);
  } else {
    console.log("WARNING: deployer is not AttestiaRegistry governance.");
    console.log("Run this as governance:");
    console.log(`  setContributorResolver(${resolverAddress})`);
  }

  console.log("\nATTESTIA_CONTRIBUTOR_RESOLVER=" + resolverAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
