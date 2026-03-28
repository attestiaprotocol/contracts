/**
 * Deploy AttestiaAggregateResolver (authorized attester = deployer EOA).
 *
 *   npx hardhat run scripts/deployAggregateResolver.ts --network baseSepolia
 *
 * Requires `ATTESTIA_STAKE` (deployed AttestiaStake address).
 *
 * Then register the on-chain aggregate schema with this resolver address, or set
 * ATTESTIA_AGGREGATE_RESOLVER before running registerEasOnchainSchema.ts.
 */
import { ethers } from "hardhat";

const EAS_BY_CHAIN: Record<number, string> = {
  84532: "0x4200000000000000000000000000000000000021",
  8453: "0x4200000000000000000000000000000000000021",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const eas = EAS_BY_CHAIN[chainId];
  if (!eas) {
    throw new Error(`No EAS address configured for chainId ${chainId}`);
  }

  const stakeRaw = process.env.ATTESTIA_STAKE?.trim();
  if (!stakeRaw || !ethers.isAddress(stakeRaw)) {
    throw new Error("ATTESTIA_STAKE must be set to a valid contract address");
  }
  const stake = ethers.getAddress(stakeRaw);

  console.log("Chain", chainId);
  console.log("EAS", eas);
  console.log("Stake", stake);
  console.log("Deployer (authorized attester)", deployer.address);

  const Resolver = await ethers.getContractFactory("AttestiaAggregateResolver");
  const resolver = await Resolver.deploy(eas, stake);
  await resolver.waitForDeployment();
  const addr = await resolver.getAddress();

  console.log("\nATTESTIA_AGGREGATE_RESOLVER=" + addr);
  console.log("authorizedAttester", await resolver.authorizedAttester());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
