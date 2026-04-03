/**
 * Register the three Attestia EAS schemas on Base (Sepolia or mainnet):
 *
 * 1. **Contributor media attestation (on-chain)** — media hash + URI + context + verification deadline.
 * 2. **Attester scores (off-chain)** — each attester signs a score; no resolver.
 * 3. **Aggregate (on-chain)** — submitter publishes the rollup on-chain; optional
 *    `AttestiaAggregateResolver` via `ATTESTIA_AGGREGATE_RESOLVER` in `.env`.
 * Contributor media schema can be bound to `AttestiaContributorResolver` via
 * `ATTESTIA_CONTRIBUTOR_RESOLVER` in `.env`.
 *
 * Keep schema strings in sync with `webapp/src/lib/eas/attestiaSchemas.ts`.
 *
 *   npm run eas:register-all
 */
import { ethers } from "hardhat";
import {
  EAS_SCHEMA_REGISTRY,
  ensureSchemaRegistered,
} from "./easSchemaRegistryUtils";

const SCHEMAS = [
  {
    envContributorOnchain: "NEXT_PUBLIC_EAS_SCHEMA_UID_CONTRIBUTOR_MEDIA",
    label: "ATTESTIA_CONTRIBUTOR_MEDIA_ONCHAIN",
    definition:
      "bytes32 contentHash,string mediaUri,string mediaContext,uint64 verificationDeadline",
  },
  {
    envScore: "NEXT_PUBLIC_EAS_SCHEMA_UID_SCORE_OFFCHAIN",
    envScoreServer: "EAS_SCHEMA_UID_SCORE_OFFCHAIN",
    label: "ATTESTIA_SCORE_OFFCHAIN",
    definition:
      "bytes32 contentHash,string assetId,uint256 authenticityScore,uint256 deepfakeRiskBps,string algorithm,uint64 chainTimestamp",
  },
  {
    envOnchain: "NEXT_PUBLIC_EAS_SCHEMA_UID",
    envOnchainServer: "EAS_SCHEMA_UID_AGGREGATE_ONCHAIN",
    label: "ATTESTIA_ONCHAIN_AGGREGATE",
    definition:
      "bytes32 contentHash,uint256 aggregateScore,uint32 numVerifiers,uint32 confidenceBps,bytes32 payloadHash,bytes32 proofCommitment,address[] verifiers,uint16[] scores",
  },
] as const;

function aggregateResolverFromEnv(): string {
  const raw = process.env.ATTESTIA_AGGREGATE_RESOLVER?.trim();
  if (!raw) return ethers.ZeroAddress;
  if (!ethers.isAddress(raw)) {
    throw new Error("ATTESTIA_AGGREGATE_RESOLVER must be a valid address");
  }
  return ethers.getAddress(raw);
}

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
  console.log("SchemaRegistry", EAS_SCHEMA_REGISTRY);
  console.log("Caller", deployer.address);
  console.log(
    "\nRegistering 3 core schemas: (1) contributor media on-chain, (2) attester score off-chain, (3) aggregate on-chain.\n",
  );

  const aggregateResolver = aggregateResolverFromEnv();
  const contributorResolver = contributorResolverFromEnv();
  if (contributorResolver === ethers.ZeroAddress) {
    console.warn("ATTESTIA_CONTRIBUTOR_RESOLVER unset — contributor schema uses zero resolver.");
  } else {
    console.log("Contributor media resolver", contributorResolver);
  }
  if (aggregateResolver === ethers.ZeroAddress) {
    console.warn("ATTESTIA_AGGREGATE_RESOLVER unset — on-chain schema uses zero resolver.");
  } else {
    console.log("On-chain aggregate resolver", aggregateResolver);
  }

  console.log("\n--- webapp/.env.local (and server vars) ---\n");

  for (const row of SCHEMAS) {
    const resolver = "envContributorOnchain" in row
      ? contributorResolver
      : "envOnchain" in row
        ? aggregateResolver
        : ethers.ZeroAddress;
    const { uid, alreadyRegistered } = await ensureSchemaRegistered(
      deployer,
      row.definition,
      resolver,
      true,
    );
    console.log(`# ${row.label}${alreadyRegistered ? " (already registered — skipped)" : ""}`);
    console.log(`${row.label}_UID=${uid}`);
    if ("envOnchain" in row) {
      console.log(`${row.envOnchain}=${uid}`);
      console.log(`${row.envOnchainServer}=${uid}`);
    }
    if ("envContributorOnchain" in row) {
      console.log(`${row.envContributorOnchain}=${uid}`);
    }
    if ("envScore" in row) {
      console.log(`${row.envScore}=${uid}`);
      console.log(`${row.envScoreServer}=${uid}`);
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
