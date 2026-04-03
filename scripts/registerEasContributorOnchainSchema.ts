/**
 * Register only the contributor media on-chain schema.
 * Same definition as `ATTESTIA_CONTRIBUTOR_MEDIA_ONCHAIN_SCHEMA_RAW` in webapp.
 *
 *   npx hardhat run scripts/registerEasContributorOnchainSchema.ts --network baseSepolia
 *
 * Set `ATTESTIA_CONTRIBUTOR_RESOLVER` to bind this schema to the deployed
 * `AttestiaContributorResolver`. If unset, zero resolver is used.
 */
import { ethers } from "hardhat";
import { ensureSchemaRegistered } from "./easSchemaRegistryUtils";

const SCHEMA =
  "bytes32 contentHash,string mediaUri,string mediaContext,uint64 verificationDeadline";

function contributorResolverFromEnv(): string {
  const raw = process.env.ATTESTIA_CONTRIBUTOR_RESOLVER?.trim();
  if (!raw) return ethers.ZeroAddress;
  if (!ethers.isAddress(raw)) {
    throw new Error("ATTESTIA_CONTRIBUTOR_RESOLVER must be a valid address");
  }
  return ethers.getAddress(raw);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const resolver = contributorResolverFromEnv();
  console.log("Caller", deployer.address);
  console.log("Schema: contributor media (on-chain)\n");
  if (resolver === ethers.ZeroAddress) {
    console.warn("ATTESTIA_CONTRIBUTOR_RESOLVER unset — registering with zero resolver.");
  } else {
    console.log("Resolver", resolver);
  }

  const { uid, alreadyRegistered } = await ensureSchemaRegistered(
    deployer,
    SCHEMA,
    resolver,
    true,
  );
  if (alreadyRegistered) {
    console.log("(schema already registered — same UID as below)");
  }
  console.log(`NEXT_PUBLIC_EAS_SCHEMA_UID_CONTRIBUTOR_MEDIA=${uid}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
