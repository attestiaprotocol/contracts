# Attestia contracts

Solidity for `AttestiaStake` and `AttestiaRegistry`, compiled and tested with [Hardhat](https://hardhat.org/).

## Prerequisites

- Node.js 20+
- An [Alchemy](https://www.alchemy.com/) (or other) HTTPS RPC URL for Base Sepolia
- **Base Sepolia ETH** on the deployer account ([faucet](https://www.alchemy.com/faucets/base-sepolia))

## Setup

```bash
cd contracts
npm install
cp .env.example .env
```

Edit `.env`:

- `PRIVATE_KEY` — deployer key (`0x…`, 64 hex chars after prefix)
- `BASE_SEPOLIA_RPC_URL` — e.g. `https://base-sepolia.g.alchemy.com/v2/<API_KEY>`

## Compile & test

```bash
npx hardhat compile
npx hardhat test
```

## Deploy (Base Sepolia)

```bash
npx hardhat run scripts/deploy.ts --network baseSepolia
```

Or use the npm script:

```bash
npm run deploy:base-sepolia
```

Defaults: `MIN_STAKE_WEI` = `0.0001` ether if `MIN_STAKE_WEI` is not set in `.env`.

Copy the printed addresses into the web app:

- `NEXT_PUBLIC_STAKING_CONTRACT_ADDRESS` → `AttestiaStake`
- `NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS` → `AttestiaRegistry` (optional)

## Verify on Basescan (optional)

Set `BASESCAN_API_KEY` in `.env` (from [Basescan](https://basescan.org/apis)), then:

```bash
npx hardhat verify --network baseSepolia <STAKE_ADDRESS> "<MIN_STAKE_WEI>"
npx hardhat verify --network baseSepolia <REGISTRY_ADDRESS> "<STAKE_ADDRESS>"
```

Use quoted constructor arguments as strings (wei for stake; registry takes the stake address).

## Layout

- `src/` — Solidity sources
- `test/` — Hardhat + Mocha + Chai tests
- `scripts/deploy.ts` — deployment entrypoint

