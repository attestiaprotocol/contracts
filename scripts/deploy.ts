import { ethers, network } from "hardhat";

async function main() {
  const minStakeWei = process.env.MIN_STAKE_WEI
    ? BigInt(process.env.MIN_STAKE_WEI)
    : ethers.parseEther("0.0001");

  const [deployer] = await ethers.getSigners();
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);

  const Stake = await ethers.getContractFactory("AttestiaStake");
  const stake = await Stake.deploy(minStakeWei);
  await stake.waitForDeployment();
  const stakeAddr = await stake.getAddress();
  console.log("AttestiaStake", stakeAddr);

  const Registry = await ethers.getContractFactory("AttestiaRegistry");
  const registry = await Registry.deploy(stakeAddr);
  await registry.waitForDeployment();
  const regAddr = await registry.getAddress();
  console.log("AttestiaRegistry", regAddr);
  console.log("minStakeWei", minStakeWei.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
