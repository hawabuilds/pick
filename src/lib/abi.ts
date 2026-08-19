/**
 * Hand-written ABI fragments for the calls the app actually makes.
 *
 * Kept narrow on purpose: importing the full Foundry artifacts would drag the
 * whole build output into the client bundle, and a mismatch here is caught
 * immediately by a reverted transaction rather than silently.
 *
 * If a signature changes in contracts/src, change it here too.
 */

export const CLAIM_DISTRIBUTOR_ABI = [
  {
    type: "function",
    name: "claimWithSignature",
    stateMutability: "nonpayable",
    inputs: [
      {name: "season", type: "uint256"},
      {name: "kind", type: "uint8"},
      {name: "amount", type: "uint256"},
      {name: "deadline", type: "uint256"},
      {name: "signature", type: "bytes"},
      {name: "rewardToken", type: "address"},
      {name: "minOut", type: "uint256"},
    ],
    outputs: [{name: "amountOut", type: "uint256"}],
  },
  {
    type: "function",
    name: "claimWithProof",
    stateMutability: "nonpayable",
    inputs: [
      {name: "season", type: "uint256"},
      {name: "kind", type: "uint8"},
      {name: "amount", type: "uint256"},
      {name: "proof", type: "bytes32[]"},
      {name: "rewardToken", type: "address"},
      {name: "minOut", type: "uint256"},
    ],
    outputs: [{name: "amountOut", type: "uint256"}],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [{name: "entry", type: "bytes32"}],
    outputs: [{type: "bool"}],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      {name: "account", type: "address", indexed: true},
      {name: "season", type: "uint256", indexed: true},
      {name: "kind", type: "uint8", indexed: true},
      {name: "rewardToken", type: "address", indexed: false},
      {name: "quoteAmount", type: "uint256", indexed: false},
      {name: "amountOut", type: "uint256", indexed: false},
    ],
  },
] as const;

export const DIVIDEND_TRACKER_ABI = [
  {
    type: "function",
    name: "withdrawableDividendOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{name: "amount", type: "uint256"}],
  },
  {
    type: "function",
    name: "claimAsRWA",
    stateMutability: "nonpayable",
    inputs: [
      {name: "token", type: "address"},
      {name: "minOut", type: "uint256"},
    ],
    outputs: [{name: "amountOut", type: "uint256"}],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint8"}],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "string"}],
  },
] as const;

/** Matches `ClaimDistributor.RewardKind`. */
export const REWARD_KIND = {
  leaderboard: 0,
  welcome: 1,
} as const;

export type RewardKindName = keyof typeof REWARD_KIND;
