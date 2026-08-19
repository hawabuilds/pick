// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISwapRouter} from "../interfaces/ISwapRouter.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Fixed-rate router for tests and testnet, where no DEX has liquidity
///         in these tokens. It mints `tokenOut` rather than sourcing it from a
///         pool, so it must never be pointed at a token with real value.
contract MockSwapRouter is ISwapRouter {
    using SafeERC20 for IERC20;

    uint256 public constant RATE_PRECISION = 1e18;

    /// @dev tokenIn => tokenOut => how many tokenOut per 1e18 tokenIn.
    mapping(address => mapping(address => uint256)) public rate;

    /// @dev Lets a test model a router that does not honour its own floor, so
    ///      the caller's independent check can be exercised.
    bool public ignoreMinOut;

    function setRate(address tokenIn, address tokenOut, uint256 rate_) external {
        rate[tokenIn][tokenOut] = rate_;
    }

    function setIgnoreMinOut(bool ignore) external {
        ignoreMinOut = ignore;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn)
        public
        view
        returns (uint256)
    {
        uint256 r = rate[tokenIn][tokenOut];
        if (r == 0) r = RATE_PRECISION;
        return (amountIn * r) / RATE_PRECISION;
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient
    ) external override returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        amountOut = quote(tokenIn, tokenOut, amountIn);
        if (!ignoreMinOut) {
            require(amountOut >= amountOutMinimum, "MockSwapRouter: insufficient output");
        }

        uint256 held = IERC20(tokenOut).balanceOf(address(this));
        if (held < amountOut) {
            MockERC20(tokenOut).mint(address(this), amountOut - held);
        }
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }
}
