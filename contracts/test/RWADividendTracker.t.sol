// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {RWADividendTracker} from "../src/RWADividendTracker.sol";

contract RWADividendTrackerTest is Base {
    /// @dev `magnifiedDividendPerShare` truncates, so a holder's share can come
    ///      out a wei or two light. That is the safe direction — the shortfall
    ///      stays in the pot rather than being over-paid — and
    ///      `testFuzz_distributionIsNeverOverPaid` pins the direction down.
    uint256 internal constant DUST = 2 wei;

    function setUp() public override {
        super.setUp();
        // Fee-exempt funding keeps the share maths exact and legible.
        token.transfer(alice, 1_000 ether);
        token.transfer(bob, 3_000 ether);
    }

    function test_accrualIsProportionalToBalance() public {
        _distribute(400 ether);

        assertApproxEqAbs(tracker.withdrawableDividendOf(alice), 100 ether, DUST, "1/4 of the pot");
        assertApproxEqAbs(tracker.withdrawableDividendOf(bob), 300 ether, DUST, "3/4 of the pot");
    }

    function test_claimPaysQuoteAndZeroesTheBalance() public {
        _distribute(400 ether);

        vm.prank(alice);
        uint256 paid = tracker.claim();

        assertApproxEqAbs(paid, 100 ether, DUST);
        assertEq(quote.balanceOf(alice), paid);
        assertEq(tracker.withdrawableDividendOf(alice), 0);
    }

    function test_cannotClaimTwice() public {
        _distribute(400 ether);

        vm.prank(alice);
        tracker.claim();

        vm.prank(alice);
        vm.expectRevert(RWADividendTracker.NothingToClaim.selector);
        tracker.claim();
    }

    function test_claimRevertsWithNothingAccrued() public {
        vm.prank(alice);
        vm.expectRevert(RWADividendTracker.NothingToClaim.selector);
        tracker.claim();
    }

    function test_newHolderDoesNotEarnPastDistributions() public {
        _distribute(400 ether);

        address carol = makeAddr("carol");
        token.transfer(carol, 4_000 ether);

        assertEq(tracker.withdrawableDividendOf(carol), 0, "no retroactive dividends");
        assertApproxEqAbs(
            tracker.withdrawableDividendOf(alice), 100 ether, DUST, "existing holders unaffected"
        );
    }

    function test_sellingKeepsAlreadyEarnedDividends() public {
        _distribute(400 ether);

        vm.prank(alice);
        token.transfer(bob, 1_000 ether);

        assertEq(tracker.sharesOf(alice), 0);
        assertApproxEqAbs(
            tracker.withdrawableDividendOf(alice), 100 ether, DUST, "earned before the sale"
        );
        assertApproxEqAbs(
            tracker.withdrawableDividendOf(bob), 300 ether, DUST, "no windfall for the buyer"
        );
    }

    function test_secondDistributionUsesUpdatedBalances() public {
        _distribute(400 ether);

        // Alice doubles up; the pot is now split 2:3.
        token.transfer(alice, 1_000 ether);
        _distribute(500 ether);

        assertApproxEqAbs(tracker.withdrawableDividendOf(alice), 300 ether, DUST);
        assertApproxEqAbs(tracker.withdrawableDividendOf(bob), 600 ether, DUST);
    }

    function test_claimAsRWASwapsIntoTheChosenStock() public {
        _distribute(400 ether);
        router.setRate(address(quote), address(tsla), 0.5e18); // 1 USDC -> 0.5 TSLA

        vm.prank(alice);
        uint256 out = tracker.claimAsRWA(address(tsla), 49 ether);

        assertApproxEqAbs(out, 50 ether, DUST);
        assertEq(tsla.balanceOf(alice), out);
        assertEq(quote.balanceOf(alice), 0, "paid in stock, not quote");
        assertEq(tracker.withdrawableDividendOf(alice), 0);
    }

    function test_claimAsRWARespectsSlippageFloor() public {
        _distribute(400 ether);
        router.setRate(address(quote), address(tsla), 0.5e18);

        vm.prank(alice);
        vm.expectRevert("MockSwapRouter: insufficient output");
        tracker.claimAsRWA(address(tsla), 100 ether);
    }

    function test_claimAsRWARejectsUnknownToken() public {
        _distribute(400 ether);

        vm.prank(alice);
        vm.expectRevert(RWADividendTracker.TokenNotAllowlisted.selector);
        tracker.claimAsRWA(address(quote), 0);
    }

    function test_onlyShareTokenCanDistribute() public {
        quote.mint(address(tracker), 100 ether);

        vm.prank(alice);
        vm.expectRevert(RWADividendTracker.NotShareToken.selector);
        tracker.distributeDividends(100 ether);
    }

    function test_onlyShareTokenCanMoveShares() public {
        vm.prank(alice);
        vm.expectRevert(RWADividendTracker.NotShareToken.selector);
        tracker.setBalance(alice, 1_000_000 ether);
    }

    function test_shareTokenCannotBeRepointed() public {
        vm.expectRevert(RWADividendTracker.ShareTokenAlreadySet.selector);
        tracker.setShareToken(alice);
    }

    function test_exclusionZeroesSharesButKeepsUnclaimedDividends() public {
        _distribute(400 ether);
        tracker.setExcluded(alice, true);

        assertEq(tracker.sharesOf(alice), 0);
        assertApproxEqAbs(tracker.withdrawableDividendOf(alice), 100 ether, DUST);

        vm.prank(alice);
        assertApproxEqAbs(tracker.claim(), 100 ether, DUST);
    }

    /// @dev The pot must never pay out more than was put in.
    function testFuzz_distributionIsNeverOverPaid(uint96 amount, uint96 aliceExtra) public {
        uint256 pot = bound(uint256(amount), 1 ether, 1_000_000 ether);
        token.transfer(alice, bound(uint256(aliceExtra), 0, 10_000 ether));

        _distribute(pot);

        uint256 owed = tracker.withdrawableDividendOf(alice) + tracker.withdrawableDividendOf(bob);
        assertLe(owed, pot, "cannot owe more than distributed");
    }
}
