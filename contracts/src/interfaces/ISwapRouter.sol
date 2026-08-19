// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal swap surface used by every contract in this system.
/// @dev Deliberately abstract. At the time of writing there is no DEX with real
///      testnet liquidity for these tokens, so `MockSwapRouter` stands in. When
///      a real router exists, write an adapter that implements this interface.
///
///      `amountOutMinimum` must never be whatever the caller passed in, or a
///      sandwich attack can drain the swap. Callers in this repo derive it from
///      a Chainlink feed and treat any caller-supplied value as a tightening
///      preference only — see `ClaimDistributor.swapFloor`.
interface ISwapRouter {
    /// @param tokenIn Token being sold. Must be approved to this router.
    /// @param tokenOut Token to receive.
    /// @param amountIn Exact amount of `tokenIn` to sell.
    /// @param amountOutMinimum Revert if fewer than this many `tokenOut` come back.
    /// @param recipient Who receives `tokenOut`.
    /// @return amountOut Amount of `tokenOut` sent to `recipient`.
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient
    ) external returns (uint256 amountOut);
}
