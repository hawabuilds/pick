// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {RWADividendTracker} from "./RWADividendTracker.sol";

/// @title SplitTaxToken
/// @notice Fixed-supply ERC20 with a buy/sell fee that is periodically swapped
///         into the quote asset and split 40/40/20 between holder dividends, the
///         leaderboard vault and the learner vault.
///
/// @dev UNAUDITED. Do not deploy to mainnet without a professional audit.
///
///      Two properties matter more than anything else here, because getting them
///      wrong is how fee tokens become honeypots:
///
///      1. There is no mint function. The entire supply is created in the
///         constructor and `_update` is never called with a zero `from` again.
///      2. Fees are capped at MAX_TOTAL_FEE_BPS (10%) for buy + sell combined,
///         enforced in `setFees`, which is the only way fees ever change. The
///         owner cannot raise them past the cap even by accident.
contract SplitTaxToken is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @notice Hard ceiling on buy + sell fee. Cannot be raised; there is no setter.
    uint256 public constant MAX_TOTAL_FEE_BPS = 1_000;

    uint256 public constant DIVIDEND_SPLIT_BPS = 4_000;
    uint256 public constant LEADERBOARD_SPLIT_BPS = 4_000;
    uint256 public constant LEARNER_SPLIT_BPS = 2_000;

    IERC20 public immutable quoteToken;
    RWADividendTracker public immutable dividendTracker;

    ISwapRouter public swapRouter;
    address public leaderboardVault;
    address public learnerVault;

    uint256 public buyFeeBps;
    uint256 public sellFeeBps;

    /// @notice Fee tokens are only swapped once this much has accumulated, so
    ///         small trades don't each pay for a swap.
    uint256 public swapThreshold;
    bool public swapEnabled = true;

    /// @dev Quote tokens collected for holders while the tracker had no shares.
    ///      Carried into the next distribution rather than being stranded.
    uint256 public pendingDividends;

    bool private _inSwap;

    mapping(address => bool) public isAmmPair;
    mapping(address => bool) public isFeeExempt;

    event FeesUpdated(uint256 buyFeeBps, uint256 sellFeeBps);
    event AmmPairSet(address indexed pair, bool isPair);
    event FeeExemptSet(address indexed account, bool exempt);
    event VaultsUpdated(address leaderboardVault, address learnerVault);
    event SwapRouterSet(address indexed router);
    event SwapSettingsUpdated(uint256 swapThreshold, bool swapEnabled);
    event FeesSplit(
        uint256 quoteReceived, uint256 toDividends, uint256 toLeaderboard, uint256 toLearner
    );

    error FeeTooHigh();
    error ZeroAddress();

    modifier lockSwap() {
        _inSwap = true;
        _;
        _inSwap = false;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply,
        address owner_,
        IERC20 quoteToken_,
        ISwapRouter swapRouter_,
        RWADividendTracker dividendTracker_,
        address leaderboardVault_,
        address learnerVault_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        if (
            address(quoteToken_) == address(0) || address(dividendTracker_) == address(0)
                || leaderboardVault_ == address(0) || learnerVault_ == address(0)
        ) {
            revert ZeroAddress();
        }

        quoteToken = quoteToken_;
        swapRouter = swapRouter_;
        dividendTracker = dividendTracker_;
        leaderboardVault = leaderboardVault_;
        learnerVault = learnerVault_;

        buyFeeBps = 300;
        sellFeeBps = 300;
        swapThreshold = initialSupply / 10_000;

        isFeeExempt[owner_] = true;
        isFeeExempt[address(this)] = true;
        isFeeExempt[leaderboardVault_] = true;
        isFeeExempt[learnerVault_] = true;

        // The only mint. Supply is fixed from here.
        _mint(owner_, initialSupply);
    }

    // ------------------------------------------------------------------ admin

    function setFees(uint256 buyFeeBps_, uint256 sellFeeBps_) external onlyOwner {
        if (buyFeeBps_ + sellFeeBps_ > MAX_TOTAL_FEE_BPS) revert FeeTooHigh();
        buyFeeBps = buyFeeBps_;
        sellFeeBps = sellFeeBps_;
        emit FeesUpdated(buyFeeBps_, sellFeeBps_);
    }

    function setAmmPair(address pair, bool isPair) external onlyOwner {
        if (pair == address(0)) revert ZeroAddress();
        isAmmPair[pair] = isPair;
        emit AmmPairSet(pair, isPair);
    }

    function setFeeExempt(address account, bool exempt) external onlyOwner {
        isFeeExempt[account] = exempt;
        emit FeeExemptSet(account, exempt);
    }

    function setVaults(address leaderboardVault_, address learnerVault_) external onlyOwner {
        if (leaderboardVault_ == address(0) || learnerVault_ == address(0)) revert ZeroAddress();
        leaderboardVault = leaderboardVault_;
        learnerVault = learnerVault_;
        emit VaultsUpdated(leaderboardVault_, learnerVault_);
    }

    function setSwapRouter(ISwapRouter router) external onlyOwner {
        swapRouter = router;
        emit SwapRouterSet(address(router));
    }

    function setSwapSettings(uint256 swapThreshold_, bool swapEnabled_) external onlyOwner {
        swapThreshold = swapThreshold_;
        swapEnabled = swapEnabled_;
        emit SwapSettingsUpdated(swapThreshold_, swapEnabled_);
    }

    // -------------------------------------------------------------- transfers

    function _update(address from, address to, uint256 value) internal override {
        // Mint/burn, internal swap plumbing, and exempt accounts move at par.
        if (
            from == address(0) || to == address(0) || _inSwap || isFeeExempt[from]
                || isFeeExempt[to]
        ) {
            super._update(from, to, value);
            _syncShares(from, to);
            return;
        }

        uint256 feeBps;
        if (isAmmPair[from]) {
            feeBps = buyFeeBps;
        } else if (isAmmPair[to]) {
            feeBps = sellFeeBps;
        }

        // Settle accumulated fees on sells, before the sell itself, so the
        // swap can't be sandwiched by the very trade that triggered it.
        if (
            isAmmPair[to] && !_inSwap && swapEnabled && balanceOf(address(this)) >= swapThreshold
                && swapThreshold > 0
        ) {
            _swapAndSplit(balanceOf(address(this)));
        }

        if (feeBps > 0) {
            uint256 fee = (value * feeBps) / BPS;
            if (fee > 0) {
                super._update(from, address(this), fee);
                value -= fee;
            }
        }

        super._update(from, to, value);
        _syncShares(from, to);
    }

    /// @dev Tracker failures must never brick a transfer, hence the try/catch.
    function _syncShares(address from, address to) private {
        if (address(dividendTracker) == address(0)) return;

        if (from != address(0)) {
            try dividendTracker.setBalance(from, balanceOf(from)) {} catch {}
        }
        if (to != address(0)) {
            try dividendTracker.setBalance(to, balanceOf(to)) {} catch {}
        }
    }

    // ----------------------------------------------------------------- swapback

    /// @notice Force a settlement of collected fees.
    function swapAndSplit() external nonReentrant {
        uint256 balance = balanceOf(address(this));
        if (balance > 0) _swapAndSplit(balance);
    }

    function _swapAndSplit(uint256 amountIn) private lockSwap {
        if (address(swapRouter) == address(0)) return;

        _approve(address(this), address(swapRouter), amountIn);

        uint256 before = quoteToken.balanceOf(address(this));
        // minOut of 0 is only acceptable because this runs against the mock
        // router on testnet. See ISwapRouter: mainnet needs an oracle bound.
        try swapRouter.swapExactInput(
            address(this), address(quoteToken), amountIn, 0, address(this)
        ) {} catch {
            _approve(address(this), address(swapRouter), 0);
            return;
        }
        _approve(address(this), address(swapRouter), 0);

        uint256 received = quoteToken.balanceOf(address(this)) - before;
        if (received == 0) return;

        uint256 toLeaderboard = (received * LEADERBOARD_SPLIT_BPS) / BPS;
        uint256 toLearner = (received * LEARNER_SPLIT_BPS) / BPS;
        // Dividends take the remainder so rounding dust is never stranded.
        uint256 toDividends = received - toLeaderboard - toLearner;

        quoteToken.safeTransfer(leaderboardVault, toLeaderboard);
        quoteToken.safeTransfer(learnerVault, toLearner);

        uint256 dividendAmount = toDividends + pendingDividends;
        if (dividendTracker.totalShares() == 0) {
            // Nobody to pay yet. Hold it for the next settlement.
            pendingDividends = dividendAmount;
        } else {
            pendingDividends = 0;
            quoteToken.safeTransfer(address(dividendTracker), dividendAmount);
            dividendTracker.distributeDividends(dividendAmount);
        }

        emit FeesSplit(received, toDividends, toLeaderboard, toLearner);
    }
}
