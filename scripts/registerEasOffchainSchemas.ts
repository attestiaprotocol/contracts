/**
 * Register score + aggregate off-chain EAS schemas only.
 * Matches `ATTESTIA_SCORE_OFFCHAIN_SCHEMA_RAW` and
 * `ATTESTIA_AGGREGATE_OFFCHAIN_SCHEMA_RAW` in web/src/lib/config.ts.
 *
 *   npx hardhat run scripts/registerEasOffchainSchemas.ts --network baseSepolia
 */
import { ethers } from "hardhat";

const SCHEMA_REGISTRY = "0x4200000000000000000000000000000000000020";
const ABI = [
  "function register(string schema, address resolver, bool revocable) external returns (bytes32)",
] as const;

const PAIRS = [
  {
    label: "SCORE_OFFCHAIN",
    schema:
      "bytes32 contentHash,string assetId,uint256 authenticityScore,uint256 deepfakeRiskBps,uint64 chainTimestamp",
    nextPublic: "NEXT_PUBLIC_EAS_SCHEMA_UID_SCORE_OFFCHAIN",
    server: "EAS_SCHEMA_UID_SCORE_OFFCHAIN",
  },
  {
    label: "AGGREGATE_OFFCHAIN",
    schema:
      "bytes32 contentHash,string assetId,uint256 avgAuthenticityFP,uint256 verifierCount,bytes32 scoresPayloadHash,bytes32 sqlProofCommitment",
    nextPublic: "NEXT_PUBLIC_EAS_SCHEMA_UID_AGGREGATE_OFFCHAIN",
    server: "EAS_SCHEMA_UID_AGGREGATE_OFFCHAIN",
  },
] as const;

async function main() {
  const [deployer] = await ethers.getSigners();
  const sr = new ethers.Contract(SCHEMA_REGISTRY, ABI, deployer);
  console.log("Caller", deployer.address);
  console.log("");
  for (const p of PAIRS) {
    const uid = await sr.register.staticCall(p.schema, ethers.ZeroAddress, true);
    await (await sr.register(p.schema, ethers.ZeroAddress, true)).wait();
    console.log(`# ${p.label}`);
    console.log(`${p.nextPublic}=${uid}`);
    console.log(`${p.server}=${uid}`);
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
