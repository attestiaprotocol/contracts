/**
 * Mint TestUSDC to a wallet (owner only). Optionally transfer from caller after mint.
 *
 * Mint directly to a wallet:
 *   TEST_USDC=0x... MINT_TO=0x... MINT_AMOUNT=350000000 \
 *     npx hardhat run scripts/mintTestUsdc.ts --network baseSepolia
 *
 * Mint to yourself, then transfer:
 *   TEST_USDC=0x... MINT_TO=<your address> MINT_AMOUNT=1000000000 \
 *     TRANSFER_TO=0x... TRANSFER_AMOUNT=350000000 \
 *     npx hardhat run scripts/mintTestUsdc.ts --network baseSepolia
 */
import { ethers } from "hardhat";

async function main() {
  const [caller] = await ethers.getSigners();

  const tokenRaw = process.env.TEST_USDC?.trim() ?? process.env.STAKE_TOKEN_ADDRESS?.trim();
  if (!tokenRaw || !ethers.isAddress(tokenRaw)) {
    throw new Error("TEST_USDC or STAKE_TOKEN_ADDRESS must be set to a valid contract address");
  }
  const tokenAddr = ethers.getAddress(tokenRaw);

  const mintToRaw = process.env.MINT_TO?.trim();
  if (!mintToRaw || !ethers.isAddress(mintToRaw)) {
    throw new Error("MINT_TO must be set to a valid wallet address");
  }
  const mintTo = ethers.getAddress(mintToRaw);

  const mintRaw = process.env.MINT_AMOUNT?.trim();
  if (!mintRaw) {
    throw new Error("MINT_AMOUNT must be set (smallest units, 6 decimals)");
  }
  const mintAmount = BigInt(mintRaw);

  const token = await ethers.getContractAt("TestUSDC", tokenAddr);
  const owner = await token.owner();

  console.log("Caller", caller.address);
  console.log("TestUSDC", tokenAddr);
  console.log("Owner", owner);

  if (caller.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Caller ${caller.address} is not token owner ${owner}`);
  }

  const mintTx = await token.mint(mintTo, mintAmount);
  console.log("mint tx", mintTx.hash);
  await mintTx.wait();
  console.log("Minted", mintAmount.toString(), "to", mintTo);
  console.log("Balance", mintTo, (await token.balanceOf(mintTo)).toString());

  const transferToRaw = process.env.TRANSFER_TO?.trim();
  const transferRaw = process.env.TRANSFER_AMOUNT?.trim();
  if (!transferToRaw && !transferRaw) return;

  if (!transferToRaw || !ethers.isAddress(transferToRaw)) {
    throw new Error("TRANSFER_TO must be a valid address when transferring");
  }
  if (!transferRaw) {
    throw new Error("TRANSFER_AMOUNT must be set when TRANSFER_TO is set");
  }
  if (mintTo.toLowerCase() !== caller.address.toLowerCase()) {
    throw new Error("TRANSFER requires MINT_TO to be the caller (mint to yourself, then transfer)");
  }

  const transferTo = ethers.getAddress(transferToRaw);
  const transferAmount = BigInt(transferRaw);

  const transferTx = await token.transfer(transferTo, transferAmount);
  console.log("transfer tx", transferTx.hash);
  await transferTx.wait();
  console.log("Transferred", transferAmount.toString(), "to", transferTo);
  console.log("Balance", transferTo, (await token.balanceOf(transferTo)).toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
