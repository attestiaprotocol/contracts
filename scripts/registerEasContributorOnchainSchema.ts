/**
 * Register only the contributor media on-chain schema.
 * Same definition as `ATTESTIA_CONTRIBUTOR_MEDIA_ONCHAIN_SCHEMA_RAW` in webapp.
 *
 *   npx hardhat run scripts/registerEasContributorOnchainSchema.ts --network baseSepolia
 */
import { ethers } from "hardhat";
import { ensureSchemaRegistered } from "./easSchemaRegistryUtils";

const SCHEMA =
  "bytes32 contentHash,string mediaUri,string mediaContext,uint64 verificationDeadline";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Caller", deployer.address);
  console.log("Schema: contributor media (on-chain)\n");

  const { uid, alreadyRegistered } = await ensureSchemaRegistered(
    deployer,
    SCHEMA,
    ethers.ZeroAddress,
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
