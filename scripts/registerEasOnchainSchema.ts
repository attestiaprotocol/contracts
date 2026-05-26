/**
 * Register only the **on-chain aggregate** schema (one of the three core Attestia schemas).
 * Same definition as `ATTESTIA_ONCHAIN_AGGREGATE_SCHEMA_RAW` in webapp/src/lib/eas/attestiaSchemas.ts.
 *
 * For the contributor media on-chain schema use `registerEasContributorOnchainSchema.ts`.
 * For the attester off-chain score schema use `registerEasOffchainSchemas.ts` or `eas:register-all`.
 *
 *   npx hardhat run scripts/registerEasOnchainSchema.ts --network baseSepolia
 *
 * Set ATTESTIA_AGGREGATE_RESOLVER to your deployed AttestiaAggregateResolver (see
 * scripts/deployAggregateResolver.ts). If unset, registers with the zero address (no resolver).
 */
import { ethers } from "hardhat";
import { ensureSchemaRegistered } from "./easSchemaRegistryUtils";

/** Percent fields use uint16 with 2 decimal places: 89.83% → 8983 (value × 100, max 10000). */
const SCHEMA =
  "bytes32 contentHash,uint16 aggregateDeepFakeRiskScore,uint32 numIndependentVerifiers,bytes32 payloadHash,bytes32 proofCommitment,address[] verifiersWalletIds,uint16[] deepfakeRiskScores";

function resolverFromEnv(): string {
  const raw = process.env.ATTESTIA_AGGREGATE_RESOLVER?.trim();
  if (!raw) return ethers.ZeroAddress;
  if (!ethers.isAddress(raw)) {
    throw new Error("ATTESTIA_AGGREGATE_RESOLVER must be a valid address");
  }
  return ethers.getAddress(raw);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const resolver = resolverFromEnv();
  if (resolver === ethers.ZeroAddress) {
    console.warn("ATTESTIA_AGGREGATE_RESOLVER unset — registering with zero resolver.");
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
  console.log("NEXT_PUBLIC_EAS_SCHEMA_UID=" + uid);
  console.log("EAS_SCHEMA_UID_AGGREGATE_ONCHAIN=" + uid);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
