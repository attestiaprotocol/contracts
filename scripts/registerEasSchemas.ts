/**
 * Register Attestia EAS schemas on Base (Sepolia or mainnet) SchemaRegistry.
 * Keep schema strings in sync with `web/src/lib/config.ts`.
 *
 * Usage:
 *   npx hardhat run scripts/registerEasSchemas.ts --network baseSepolia
 *
 * Env: same RPC + PRIVATE_KEY as deploy (see contracts/.env).
 */
import { ethers } from "hardhat";

const SCHEMA_REGISTRY = "0x4200000000000000000000000000000000000020";

const SCHEMA_REGISTRY_ABI = [
  "function register(string schema, address resolver, bool revocable) external returns (bytes32)",
] as const;

const SCHEMAS = [
  {
    envOnchain: "NEXT_PUBLIC_EAS_SCHEMA_UID",
    label: "ATTESTIA_ONCHAIN",
    definition:
      "bytes32 contentHash,uint256 aggregateScore,uint32 numVerifiers,uint32 confidenceBps,bytes32 payloadHash",
  },
  {
    envScore: "NEXT_PUBLIC_EAS_SCHEMA_UID_SCORE_OFFCHAIN",
    envScoreServer: "EAS_SCHEMA_UID_SCORE_OFFCHAIN",
    label: "ATTESTIA_SCORE_OFFCHAIN",
    definition:
      "bytes32 contentHash,string assetId,uint256 authenticityScore,uint256 deepfakeRiskBps,uint64 chainTimestamp",
  },
  {
    envAgg: "EAS_SCHEMA_UID_AGGREGATE_OFFCHAIN",
    label: "ATTESTIA_AGGREGATE_OFFCHAIN",
    definition:
      "bytes32 contentHash,string assetId,uint256 avgAuthenticityFP,uint256 verifierCount,bytes32 scoresPayloadHash,bytes32 sqlProofCommitment",
  },
] as const;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("SchemaRegistry", SCHEMA_REGISTRY);
  console.log("Caller", deployer.address);

  const sr = new ethers.Contract(SCHEMA_REGISTRY, SCHEMA_REGISTRY_ABI, deployer);

  console.log("\n--- web/.env.local (and server vars) ---\n");

  for (const row of SCHEMAS) {
    const uid: string = await sr.register.staticCall(
      row.definition,
      ethers.ZeroAddress,
      true,
    );
    const tx = await sr.register(row.definition, ethers.ZeroAddress, true);
    await tx.wait();
    console.log(`# ${row.label}`);
    console.log(`${row.label}_UID=${uid}`);
    if ("envOnchain" in row) {
      console.log(`${row.envOnchain}=${uid}`);
    }
    if ("envScore" in row) {
      console.log(`${row.envScore}=${uid}`);
      console.log(`${row.envScoreServer}=${uid}`);
    }
    if ("envAgg" in row) {
      console.log(`${row.envAgg}=${uid}`);
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
