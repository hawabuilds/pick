// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {SplitTaxToken} from "../src/SplitTaxToken.sol";
import {RWADividendTracker} from "../src/RWADividendTracker.sol";
import {ClaimDistributor} from "../src/ClaimDistributor.sol";
import {ISwapRouter} from "../src/interfaces/ISwapRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

/// @dev The test contract itself is the owner of every deployed contract, so
///      admin calls need no pranking and the intent of each test stays visible.
abstract contract Base is Test {
    uint256 internal constant SUPPLY = 1_000_000 ether;

    MockERC20 internal quote;
    MockERC20 internal tsla;
    MockSwapRouter internal router;
    RWADividendTracker internal tracker;
    SplitTaxToken internal token;

    address internal pair = makeAddr("ammPair");
    address internal leaderboardVault = makeAddr("leaderboardVault");
    address internal learnerVault = makeAddr("learnerVault");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public virtual {
        quote = new MockERC20("USD Coin", "USDC", 18);
        tsla = new MockERC20("Tesla", "TSLA", 18);
        router = new MockSwapRouter();

        tracker = new RWADividendTracker(address(this), quote, ISwapRouter(address(router)));

        token = new SplitTaxToken(
            "Pick",
            "PICK",
            SUPPLY,
            address(this),
            quote,
            ISwapRouter(address(router)),
            tracker,
            leaderboardVault,
            learnerVault
        );

        tracker.setShareToken(address(token));
        tracker.setRewardToken(address(tsla), true);

        token.setAmmPair(pair, true);

        // The pair, the router, the vaults and the deployer hold balances but
        // are not players, so they must not dilute holder dividends. The router
        // matters as much as the pair: it holds the fee tokens mid-swap, and an
        // unexcluded router quietly accrues dividends on them.
        tracker.setExcluded(pair, true);
        tracker.setExcluded(address(router), true);
        tracker.setExcluded(leaderboardVault, true);
        tracker.setExcluded(learnerVault, true);
        tracker.setExcluded(address(this), true);

        // 1 PICK -> 1 USDC, 1 USDC -> 1 TSLA. Enough to make split maths legible.
        router.setRate(address(token), address(quote), 1e18);
        router.setRate(address(quote), address(tsla), 1e18);

        // Seed the pair so it can sell into buyers.
        token.transfer(pair, 500_000 ether);
    }

    /// @dev A buy is the pair sending tokens to a player.
    function _buy(address who, uint256 amount) internal {
        vm.prank(pair);
        token.transfer(who, amount);
    }

    /// @dev A sell is a player sending tokens to the pair.
    function _sell(address who, uint256 amount) internal {
        vm.prank(who);
        token.transfer(pair, amount);
    }

    /// @dev Funds and books a dividend the way the token would.
    function _distribute(uint256 amount) internal {
        quote.mint(address(tracker), amount);
        vm.prank(address(token));
        tracker.distributeDividends(amount);
    }
}
