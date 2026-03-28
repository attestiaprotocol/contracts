/**
 * Update AttestiaRegistry verification window (governance only).
 *
 * Usage:
 *   ATTESTIA_REGISTRY=0x... VERIFICATION_WINDOW_SECONDS=600 \
 *   npx hardhat run scripts/setRegistryVerificationWindow.ts --network baseSepolia
 */
import { ethers } from "hardhat";

async function main() {
  const [caller] = await ethers.getSigners();

  const registryRaw = process.env.ATTESTIA_REGISTRY?.trim();
  if (!registryRaw || !ethers.isAddress(registryRaw)) {
    throw new Error("ATTESTIA_REGISTRY must be set to a valid contract address");
  }
  const registryAddr = ethers.getAddress(registryRaw);

  const windowRaw = process.env.VERIFICATION_WINDOW_SECONDS?.trim();
  if (!windowRaw) {
    throw new Error("VERIFICATION_WINDOW_SECONDS must be set");
  }
  const newWindow = BigInt(windowRaw);
  if (newWindow <= 0n || newWindow > BigInt(2 ** 64 - 1)) {
    throw new Error("VERIFICATION_WINDOW_SECONDS must be in uint64 range and > 0");
  }

  const registry = await ethers.getContractAt("AttestiaRegistry", registryAddr);
  const governance = await registry.governance();
  const previousWindow = await registry.verificationWindow();

  console.log("Caller", caller.address);
  console.log("Registry", registryAddr);
  console.log("Governance", governance);
  console.log("Previous verificationWindow", previousWindow.toString(), "seconds");
  console.log("New verificationWindow", newWindow.toString(), "seconds");

  const tx = await registry.setVerificationWindow(newWindow);
  console.log("tx", tx.hash);
  await tx.wait();

  const updated = await registry.verificationWindow();
  console.log("Updated verificationWindow", updated.toString(), "seconds");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
