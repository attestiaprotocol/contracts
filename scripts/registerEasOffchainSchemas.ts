/**
 * Register the **attester score** off-chain EAS schema only (one of the three core schemas).
 * Matches `ATTESTIA_SCORE_OFFCHAIN_SCHEMA_RAW` in webapp/src/lib/eas/attestiaSchemas.ts.
 *
 * For the on-chain aggregate schema use `registerEasOnchainSchema.ts` or `eas:register-all`.
 *
 *   npx hardhat run scripts/registerEasOffchainSchemas.ts --network baseSepolia
 */
import { ethers } from "hardhat";
import { ensureSchemaRegistered } from "./easSchemaRegistryUtils";

const SCHEMA =
  "bytes32 contentHash,string assetId,uint16 deepfakeRiskScore,string algorithm,uint64 chainTimestamp,string evaluationScoreReason";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Caller", deployer.address);
  console.log("Schema: attester score (off-chain)\n");

  const { uid, alreadyRegistered } = await ensureSchemaRegistered(
    deployer,
    SCHEMA,
    ethers.ZeroAddress,
    true,
  );
  console.log(
    `# ATTESTIA_SCORE_OFFCHAIN${alreadyRegistered ? " (already registered — skipped)" : ""}`,
  );
  console.log(`NEXT_PUBLIC_EAS_SCHEMA_UID_SCORE_OFFCHAIN=${uid}`);
  console.log(`EAS_SCHEMA_UID_SCORE_OFFCHAIN=${uid}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
