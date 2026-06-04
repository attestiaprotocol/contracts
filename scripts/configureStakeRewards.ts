/**
 * Set baseRewardPerRound and optionally fund the reward pool on an existing AttestiaStake.
 *
 *   ATTESTIA_STAKE=0x... npx hardhat run scripts/configureStakeRewards.ts --network baseSepolia
 *
 * Optional env:
 *   BASE_REWARD_PER_ROUND_AMOUNT  (default 7 USDC, 6 decimals: 7000000)
 *   REWARD_POOL_FUND_AMOUNT       (if set, approves stakeToken and calls fundRewards)
 */
import { ethers } from "hardhat";

const DEFAULT_BASE_REWARD = 7n * 10n ** 6n;

async function main() {
  const [caller] = await ethers.getSigners();

  const stakeRaw = process.env.ATTESTIA_STAKE?.trim();
  if (!stakeRaw || !ethers.isAddress(stakeRaw)) {
    throw new Error("ATTESTIA_STAKE must be set to a valid contract address");
  }
  const stakeAddr = ethers.getAddress(stakeRaw);

  const baseRewardPerRound = process.env.BASE_REWARD_PER_ROUND_AMOUNT
    ? BigInt(process.env.BASE_REWARD_PER_ROUND_AMOUNT)
    : DEFAULT_BASE_REWARD;

  const fundRaw = process.env.REWARD_POOL_FUND_AMOUNT?.trim();
  const fundAmount = fundRaw ? BigInt(fundRaw) : 0n;

  const stake = await ethers.getContractAt("AttestiaStake", stakeAddr);
  const owner = await stake.owner();
  const previous = await stake.baseRewardPerRound();
  const tokenAddr = await stake.stakeToken();

  console.log("Caller", caller.address);
  console.log("Stake", stakeAddr);
  console.log("Stake token", tokenAddr);
  console.log("Owner", owner);
  console.log("Previous baseRewardPerRound", previous.toString());
  console.log("New baseRewardPerRound", baseRewardPerRound.toString());

  if (caller.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Caller ${caller.address} is not stake owner ${owner}`);
  }

  const setTx = await stake.setBaseRewardPerRound(baseRewardPerRound);
  console.log("setBaseRewardPerRound tx", setTx.hash);
  await setTx.wait();

  if (fundAmount > 0n) {
    const token = await ethers.getContractAt(
      "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
      tokenAddr,
    );
    const approveTx = await token.approve(stakeAddr, fundAmount);
    await approveTx.wait();
    const fundTx = await stake.fundRewards(fundAmount);
    console.log("fundRewards tx", fundTx.hash, "amount", fundAmount.toString());
    await fundTx.wait();
  }

  console.log("baseRewardPerRound", (await stake.baseRewardPerRound()).toString());
  console.log("rewardPoolBalance", (await stake.rewardPoolBalance()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
