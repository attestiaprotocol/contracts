/**
 * Register only the on-chain finalize schema (EAS attest on Base).
 * Same definition as `ATTESTIA_SCHEMA_RAW` in web/src/lib/config.ts.
 *
 *   npx hardhat run scripts/registerEasOnchainSchema.ts --network baseSepolia
 */
import { ethers } from "hardhat";

const SCHEMA_REGISTRY = "0x4200000000000000000000000000000000000020";
const SCHEMA =
  "bytes32 contentHash,uint256 aggregateScore,uint32 numVerifiers,uint32 confidenceBps,bytes32 payloadHash";

const ABI = [
  "function register(string schema, address resolver, bool revocable) external returns (bytes32)",
] as const;

async function main() {
  const [deployer] = await ethers.getSigners();
  const sr = new ethers.Contract(SCHEMA_REGISTRY, ABI, deployer);
  const uid = await sr.register.staticCall(SCHEMA, ethers.ZeroAddress, true);
  await (await sr.register(SCHEMA, ethers.ZeroAddress, true)).wait();
  console.log("NEXT_PUBLIC_EAS_SCHEMA_UID=" + uid);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
