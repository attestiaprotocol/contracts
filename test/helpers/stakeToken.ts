import { ethers } from "hardhat";

/** USDC-like 6-decimal amounts: rounded ETH equivalents at ~$3.5k/ETH. */
export const TOKEN_DECIMALS = 6;
export const MIN_STAKE = 350n * 10n ** 6n; // 0.1 ETH → 350 USDC
export const MIN_VERIFIER_STAKE = 175n * 10n ** 6n; // 0.05 ETH → 175 USDC
export const MAX_VERIFIER_STAKE = 700n * 10n ** 6n; // 0.2 ETH → 700 USDC
export const BASE_REWARD = 7n * 10n ** 6n; // 0.002 ETH → 7 USDC per round

export async function deployMockStakeToken() {
  const Mock = await ethers.getContractFactory("MockERC20");
  const token = await Mock.deploy("Mock USDC", "mUSDC", TOKEN_DECIMALS);
  await token.waitForDeployment();
  return token;
}

export async function deployAttestiaStake() {
  const token = await deployMockStakeToken();
  const tokenAddr = await token.getAddress();
  const Stake = await ethers.getContractFactory("AttestiaStake");
  const stake = await Stake.deploy(tokenAddr, MIN_STAKE, BASE_REWARD);
  await stake.waitForDeployment();
  const stakeAddr = await stake.getAddress();
  return { token, stake, stakeAddr, tokenAddr };
}

export async function stakeAsAttester(
  token: Awaited<ReturnType<typeof deployMockStakeToken>>,
  stake: { stake(amount: bigint): Promise<unknown>; registerAsAttester(): Promise<unknown> },
  stakeAddr: string,
  signer: { address: string },
  amount = MIN_STAKE,
) {
  await mintAndApprove(token, signer, stakeAddr, amount);
  await (stake as any).connect(signer).stake(amount);
  await (stake as any).connect(signer).registerAsAttester();
}

export async function mintAndApprove(
  token: { getAddress(): Promise<string>; mint(to: string, amount: bigint): Promise<unknown> },
  holder: { address: string },
  spender: string,
  amount: bigint,
) {
  await token.mint(holder.address, amount);
  const erc20 = await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    await token.getAddress(),
  );
  await erc20.connect(holder as any).approve(spender, amount);
}
