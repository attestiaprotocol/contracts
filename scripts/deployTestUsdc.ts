/**
 * Deploy TestUSDC (6-decimal, owner-only mint).
 *
 *   npx hardhat run scripts/deployTestUsdc.ts --network baseSepolia
 *
 * Optional env (mint right after deploy):
 *   MINT_TO=0x...              recipient (defaults to deployer)
 *   MINT_AMOUNT=1000000000     amount in smallest units (1000 tUSDC)
 */
import { ethers, network, run } from "hardhat";

async function verifyContract(address: string, constructorArguments: unknown[]) {
  if (network.name === "hardhat" || network.name === "localhost") {
    console.log(`Skipping verification on ${network.name}`);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 20_000));

  try {
    await run("verify:verify", { address, constructorArguments });
    console.log("Verified", address);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified", address);
      return;
    }
    throw error;
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Network:", network.name);
  console.log("Deployer (owner):", deployer.address);

  const TestUSDC = await ethers.getContractFactory("TestUSDC");
  const token = await TestUSDC.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();

  console.log("TestUSDC", tokenAddr);
  console.log("Set STAKE_TOKEN_ADDRESS=" + tokenAddr);

  await verifyContract(tokenAddr, [deployer.address]);

  const mintRaw = process.env.MINT_AMOUNT?.trim();
  if (mintRaw) {
    const amount = BigInt(mintRaw);
    const mintToRaw = process.env.MINT_TO?.trim();
    const mintTo =
      mintToRaw && ethers.isAddress(mintToRaw)
        ? ethers.getAddress(mintToRaw)
        : deployer.address;

    const tx = await token.mint(mintTo, amount);
    await tx.wait();
    console.log("Minted", amount.toString(), "to", mintTo);
    console.log("Balance", (await token.balanceOf(mintTo)).toString());
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
