/**
 * Set native attester on an existing AttestiaStake (owner only).
 *
 *   ATTESTIA_STAKE=0x... ATTESTIA_NATIVE_ATTESTER=0x... \
 *     npx hardhat run scripts/setNativeAttester.ts --network baseSepolia
 */
import { ethers } from "hardhat";

async function main() {
  const [caller] = await ethers.getSigners();

  const stakeRaw = process.env.ATTESTIA_STAKE?.trim();
  if (!stakeRaw || !ethers.isAddress(stakeRaw)) {
    throw new Error("ATTESTIA_STAKE must be set to a valid contract address");
  }
  const stakeAddr = ethers.getAddress(stakeRaw);

  const nativeRaw = process.env.ATTESTIA_NATIVE_ATTESTER?.trim();
  if (!nativeRaw || !ethers.isAddress(nativeRaw)) {
    throw new Error("ATTESTIA_NATIVE_ATTESTER must be set to a valid address");
  }
  const native = ethers.getAddress(nativeRaw);

  const stake = await ethers.getContractAt("AttestiaStake", stakeAddr);
  const owner = await stake.owner();
  const current = await stake.nativeAttester();

  console.log("Caller", caller.address);
  console.log("Stake", stakeAddr);
  console.log("Owner", owner);
  console.log("Current nativeAttester", current);

  if (caller.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Caller ${caller.address} is not stake owner ${owner}`);
  }
  if (current.toLowerCase() === native.toLowerCase()) {
    console.log("Already set — nothing to do");
    return;
  }

  const tx = await stake.setNativeAttester(native);
  console.log("setNativeAttester tx", tx.hash);
  await tx.wait();
  console.log("nativeAttester", (await stake.nativeAttester()));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
