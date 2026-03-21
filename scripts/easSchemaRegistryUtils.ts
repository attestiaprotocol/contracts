/**
 * Helpers for EAS SchemaRegistry on Base / Base Sepolia (canonical predeploy).
 * UID = keccak256(abi.encodePacked(schema, resolver, revocable)) per EAS.
 */
import { ethers } from "ethers";

export const EAS_SCHEMA_REGISTRY =
  "0x4200000000000000000000000000000000000020";

const REGISTRY_ABI = [
  "function register(string schema, address resolver, bool revocable) external returns (bytes32)",
  "function getSchema(bytes32 uid) view returns (tuple(bytes32 uid, address resolver, bool revocable, string schema))",
] as const;

export function computeSchemaUid(
  schema: string,
  resolver: string,
  revocable: boolean,
): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["string", "address", "bool"],
      [schema, resolver, revocable],
    ),
  );
}

export type EnsureSchemaResult = { uid: string; alreadyRegistered: boolean };

/** Registers the schema if missing; otherwise returns the existing UID. */
export async function ensureSchemaRegistered(
  signer: ethers.Signer,
  schema: string,
  resolver: string,
  revocable: boolean,
): Promise<EnsureSchemaResult> {
  const sr = new ethers.Contract(EAS_SCHEMA_REGISTRY, REGISTRY_ABI, signer);
  const uid = computeSchemaUid(schema, resolver, revocable);
  const rec = await sr.getSchema(uid);
  const stored = ethers.hexlify(rec.uid as `0x${string}`).toLowerCase();
  if (stored === uid.toLowerCase()) {
    return { uid, alreadyRegistered: true };
  }
  await (await sr.register(schema, resolver, revocable)).wait();
  return { uid, alreadyRegistered: false };
}
