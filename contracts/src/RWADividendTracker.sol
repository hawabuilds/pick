// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ISwapRouter} from "./interfaces/ISwapRouter.sol";

/// @title RWADividendTracker
/// @notice Accrues quote-denominated dividends to holders of SplitTaxToken in
///         proportion to their balance, and lets them take payment either in the
///         quote asset or in an allowlisted tokenized stock.
///
/// @dev UNAUDITED. Do not deploy to mainnet without a professional audit.
///
///      The accounting is the established magnified-dividend pattern (Roger Wu's
///      Dividend-Paying Token, EIP-1726 draft), which is what every audited
///      reflection token uses. The invariant it relies on:
///
///          accumulative(a) = (magnifiedDividendPerShare * shares(a)
///                             + corrections(a)) / MAGNITUDE
///
///      When shares change, a correction is applied equal and opposite to the
///      dividends the new shares would retroactively have earned, so a holder
///      can never be credited for distributions made before they held. The
///      corrections are signed, which is why they are int256 and why the casts
///      below are deliberate rather than sloppy.
contract RWADividendTracker is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev 2**128 keeps the per-share rounding error negligible while leaving
    ///      headroom against overflow for any realistic supply.
    uint256 internal constant MAGNITUDE = 2 ** 128;

    IERC20 public immutable quoteToken;

    /// @notice The SplitTaxToken. Only it may move shares or fund dividends.
    address public shareToken;

    ISwapRouter public swapRouter;

    uint256 public magnifiedDividendPerShare;
    uint256 public totalShares;
    uint256 public totalDividendsDistributed;
    /// @notice Quote tokens held for holders but not yet withdrawn.
    uint256 public totalDividendsWithdrawn;

    mapping(address => uint256) public sharesOf;
    mapping(address => int256) internal _corrections;
    mapping(address => uint256) public withdrawnDividendOf;

    /// @notice Pairs, vaults and the token itself hold shares but earn nothing.
    mapping(address => bool) public isExcluded;
    mapping(address => bool) public isRewardToken;

    event DividendsDistributed(uint256 amount);
    event DividendClaimed(address indexed account, uint256 quoteAmount);
    event DividendClaimedAsRWA(
        address indexed account, address indexed token, uint256 quoteAmount, uint256 amountOut
    );
    event ExclusionSet(address indexed account, bool excluded);
    event RewardTokenSet(address indexed token, bool allowed);
    event SwapRouterSet(address indexed router);
    event ShareTokenSet(address indexed token);

    error NotShareToken();
    error ShareTokenAlreadySet();
    error NoShares();
    error NothingToClaim();
    error TokenNotAllowlisted();
    error ZeroAddress();

    modifier onlyShareToken() {
        if (msg.sender != shareToken) revert NotShareToken();
        _;
    }

    constructor(address owner_, IERC20 quoteToken_, ISwapRouter swapRouter_) Ownable(owner_) {
        if (address(quoteToken_) == address(0)) revert ZeroAddress();
        quoteToken = quoteToken_;
        swapRouter = swapRouter_;
    }

    // ------------------------------------------------------------------ admin

    /// @dev One-shot: the share token is the only address that can mint shares,
    ///      so letting the owner repoint it later would let them rewrite the
    ///      holder set.
    function setShareToken(address token) external onlyOwner {
        if (shareToken != address(0)) revert ShareTokenAlreadySet();
        if (token == address(0)) revert ZeroAddress();
        shareToken = token;
        isExcluded[token] = true;
        emit ShareTokenSet(token);
    }

    function setSwapRouter(ISwapRouter router) external onlyOwner {
        swapRouter = router;
        emit SwapRouterSet(address(router));
    }

    function setRewardToken(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        isRewardToken[token] = allowed;
        emit RewardTokenSet(token, allowed);
    }

    /// @notice Excluding an account zeroes its shares and redistributes nothing;
    ///         its unclaimed dividends stay claimable.
    function setExcluded(address account, bool excluded) external onlyOwner {
        if (isExcluded[account] == excluded) return;
        isExcluded[account] = excluded;
        emit ExclusionSet(account, excluded);

        if (excluded) {
            _setShares(account, 0);
        } else if (shareToken != address(0)) {
            _setShares(account, IERC20(shareToken).balanceOf(account));
        }
    }

    // ------------------------------------------------------------------ shares

    /// @notice Called by the token on every transfer to keep shares in step.
    function setBalance(address account, uint256 newBalance) external onlyShareToken {
        if (isExcluded[account]) return;
        _setShares(account, newBalance);
    }

    function _setShares(address account, uint256 newShares) internal {
        uint256 current = sharesOf[account];
        if (newShares == current) return;

        if (newShares > current) {
            uint256 added = newShares - current;
            sharesOf[account] = newShares;
            totalShares += added;
            // Cancel out the dividends these new shares would otherwise claim
            // from distributions that happened before they existed.
            // forge-lint: disable-next-line(unsafe-typecast)
            _corrections[account] -= int256(magnifiedDividendPerShare * added);
        } else {
            uint256 removed = current - newShares;
            sharesOf[account] = newShares;
            totalShares -= removed;
            // Preserve what the departing shares already earned.
            // forge-lint: disable-next-line(unsafe-typecast)
            _corrections[account] += int256(magnifiedDividendPerShare * removed);
        }
    }

    // -------------------------------------------------------------- dividends

    /// @notice Funds a distribution. Quote tokens must already have been sent here.
    function distributeDividends(uint256 amount) external onlyShareToken {
        if (totalShares == 0) revert NoShares();
        if (amount == 0) return;

        magnifiedDividendPerShare += (amount * MAGNITUDE) / totalShares;
        totalDividendsDistributed += amount;
        emit DividendsDistributed(amount);
    }

    function accumulativeDividendOf(address account) public view returns (uint256) {
        // Casting to 'int256' is safe: magnifiedDividendPerShare only ever grows
        // by amount*MAGNITUDE/totalShares, so the product stays far below
        // 2**255 for any supply this token can reach.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 magnified = int256(magnifiedDividendPerShare * sharesOf[account]);
        magnified += _corrections[account];
        if (magnified < 0) return 0;
        // Casting to 'uint256' is safe: the branch above rules out negatives.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(magnified) / MAGNITUDE;
    }

    function withdrawableDividendOf(address account) public view returns (uint256) {
        return accumulativeDividendOf(account) - withdrawnDividendOf[account];
    }

    /// @notice Take the accrued dividend in the quote asset.
    function claim() external nonReentrant returns (uint256 amount) {
        amount = _consume(msg.sender);
        quoteToken.safeTransfer(msg.sender, amount);
        emit DividendClaimed(msg.sender, amount);
    }

    /// @notice Take the accrued dividend as a tokenized stock instead.
    /// @param token An allowlisted RWA token.
    /// @param minOut Slippage floor. See the note on ISwapRouter: before mainnet
    ///        this must come from an oracle rather than the caller.
    function claimAsRWA(address token, uint256 minOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (!isRewardToken[token]) revert TokenNotAllowlisted();

        uint256 amount = _consume(msg.sender);
        quoteToken.forceApprove(address(swapRouter), amount);
        amountOut =
            swapRouter.swapExactInput(address(quoteToken), token, amount, minOut, msg.sender);
        quoteToken.forceApprove(address(swapRouter), 0);

        emit DividendClaimedAsRWA(msg.sender, token, amount, amountOut);
    }

    /// @dev Marks the dividend withdrawn before any external call, so a
    ///      re-entering token or router sees a zero balance.
    function _consume(address account) internal returns (uint256 amount) {
        amount = withdrawableDividendOf(account);
        if (amount == 0) revert NothingToClaim();
        withdrawnDividendOf[account] += amount;
        totalDividendsWithdrawn += amount;
    }
}
