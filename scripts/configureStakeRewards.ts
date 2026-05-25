/**
 * Set baseRewardPerRound and optionally fund the reward pool on an existing AttestiaStake.
 *
 *   ATTESTIA_STAKE=0x... npx hardhat run scripts/configureStakeRewards.ts --network baseSepolia
 *
 * Optional env:
 *   BASE_REWARD_PER_ROUND_WEI  (default 0.002 ether)
 *   REWARD_POOL_FUND_WEI       (if set, calls fundRewards with this amount)
 */
import { ethers } from "hardhat";

async function main() {
  const [caller] = await ethers.getSigners();

  const stakeRaw = process.env.ATTESTIA_STAKE?.trim();
  if (!stakeRaw || !ethers.isAddress(stakeRaw)) {
    throw new Error("ATTESTIA_STAKE must be set to a valid contract address");
  }
  const stakeAddr = ethers.getAddress(stakeRaw);

  const baseRewardPerRoundWei = process.env.BASE_REWARD_PER_ROUND_WEI
    ? BigInt(process.env.BASE_REWARD_PER_ROUND_WEI)
    : ethers.parseEther("0.002");

  const fundRaw = process.env.REWARD_POOL_FUND_WEI?.trim();
  const fundWei = fundRaw ? BigInt(fundRaw) : 0n;

  const stake = await ethers.getContractAt("AttestiaStake", stakeAddr);
  const owner = await stake.owner();
  const previous = await stake.baseRewardPerRound();

  console.log("Caller", caller.address);
  console.log("Stake", stakeAddr);
  console.log("Owner", owner);
  console.log("Previous baseRewardPerRound", previous.toString());
  console.log("New baseRewardPerRound", baseRewardPerRoundWei.toString());

  if (caller.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Caller ${caller.address} is not stake owner ${owner}`);
  }

  const setTx = await stake.setBaseRewardPerRound(baseRewardPerRoundWei);
  console.log("setBaseRewardPerRound tx", setTx.hash);
  await setTx.wait();

  if (fundWei > 0n) {
    const fundTx = await stake.fundRewards({ value: fundWei });
    console.log("fundRewards tx", fundTx.hash, "value", fundWei.toString());
    await fundTx.wait();
  }

  console.log("baseRewardPerRound", (await stake.baseRewardPerRound()).toString());
  console.log("rewardPoolWei", (await stake.rewardPoolWei()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
