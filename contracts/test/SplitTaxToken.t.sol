// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {SplitTaxToken} from "../src/SplitTaxToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract SplitTaxTokenTest is Base {
    function test_supplyIsFixedAtDeploy() public view {
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_supplyDoesNotChangeThroughTrading() public {
        _buy(alice, 10_000 ether);
        _sell(alice, 5_000 ether);
        _buy(bob, 20_000 ether);
        assertEq(token.totalSupply(), SUPPLY, "trading must not change supply");
    }

    function test_buyTakesThreePercent() public {
        _buy(alice, 1_000 ether);

        assertEq(token.balanceOf(alice), 970 ether);
        assertEq(token.balanceOf(address(token)), 30 ether);
    }

    function test_sellTakesThreePercent() public {
        // Fee-exempt funding so alice starts with a round number.
        token.transfer(alice, 1_000 ether);
        uint256 pairBefore = token.balanceOf(pair);

        _sell(alice, 1_000 ether);

        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(pair) - pairBefore, 970 ether);
        assertEq(token.balanceOf(address(token)), 30 ether);
    }

    function test_walletToWalletIsUntaxed() public {
        token.transfer(alice, 1_000 ether);

        vm.prank(alice);
        token.transfer(bob, 400 ether);

        assertEq(token.balanceOf(bob), 400 ether);
        assertEq(token.balanceOf(address(token)), 0);
    }

    function test_feeExemptAccountPaysNothing() public {
        token.setFeeExempt(alice, true);
        _buy(alice, 1_000 ether);

        assertEq(token.balanceOf(alice), 1_000 ether);
        assertEq(token.balanceOf(address(token)), 0);
    }

    // ------------------------------------------------------------- fee cap

    function test_setFeesWithinCap() public {
        token.setFees(500, 500);
        assertEq(token.buyFeeBps(), 500);
        assertEq(token.sellFeeBps(), 500);
    }

    function test_setFeesRevertsAboveCap() public {
        vm.expectRevert(SplitTaxToken.FeeTooHigh.selector);
        token.setFees(600, 500);
    }

    function test_setFeesRevertsOnHoneypotAttempt() public {
        vm.expectRevert(SplitTaxToken.FeeTooHigh.selector);
        token.setFees(0, 10_000);
    }

    function testFuzz_feesCanNeverExceedCap(uint256 buyBps, uint256 sellBps) public {
        buyBps = bound(buyBps, 0, 20_000);
        sellBps = bound(sellBps, 0, 20_000);

        if (buyBps + sellBps > token.MAX_TOTAL_FEE_BPS()) {
            vm.expectRevert(SplitTaxToken.FeeTooHigh.selector);
            token.setFees(buyBps, sellBps);
        } else {
            token.setFees(buyBps, sellBps);
        }

        assertLe(token.buyFeeBps() + token.sellFeeBps(), token.MAX_TOTAL_FEE_BPS());
    }

    function test_onlyOwnerCanSetFees() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.setFees(100, 100);
    }

    // ------------------------------------------------------- swapback split

    function test_swapbackSplitsFortyFortyTwenty() public {
        // Collect fees without tripping the threshold mid-test.
        token.setSwapSettings(type(uint256).max, true);
        _buy(alice, 10_000 ether);
        _buy(bob, 10_000 ether);

        uint256 collected = token.balanceOf(address(token));
        assertEq(collected, 600 ether, "3% of 20,000");

        token.setSwapSettings(1, true);
        token.swapAndSplit();

        // 1:1 rate, so 600 PICK became 600 USDC.
        assertEq(quote.balanceOf(leaderboardVault), 240 ether, "40% leaderboard");
        assertEq(quote.balanceOf(learnerVault), 120 ether, "20% learner");
        assertEq(quote.balanceOf(address(tracker)), 240 ether, "40% dividends");
        assertEq(tracker.totalDividendsDistributed(), 240 ether);
        assertEq(token.balanceOf(address(token)), 0, "fees fully settled");
    }

    function test_swapbackTriggersAutomaticallyOnSell() public {
        token.setSwapSettings(10 ether, true);

        _buy(alice, 10_000 ether); // 300 PICK of fees, over the threshold
        assertEq(token.balanceOf(address(token)), 300 ether);

        _sell(alice, 1_000 ether);

        assertGt(quote.balanceOf(leaderboardVault), 0, "settled on the sell");
    }

    function test_dividendsHeldWhenNobodyHoldsShares() public {
        // Every holder is excluded, so there is nothing to distribute against.
        token.setSwapSettings(type(uint256).max, true);
        _buy(alice, 10_000 ether);
        tracker.setExcluded(alice, true);

        token.setSwapSettings(1, true);
        token.swapAndSplit();

        assertEq(tracker.totalShares(), 0);
        assertEq(token.pendingDividends(), 120 ether, "carried, not stranded");
        assertEq(quote.balanceOf(leaderboardVault), 120 ether);
    }

    function test_pendingDividendsRollIntoNextSettlement() public {
        token.setSwapSettings(type(uint256).max, true);
        _buy(alice, 10_000 ether);
        tracker.setExcluded(alice, true);
        token.setSwapSettings(1, true);
        token.swapAndSplit();

        // A real holder appears, then more fees settle.
        tracker.setExcluded(alice, false);
        token.setSwapSettings(type(uint256).max, true);
        _buy(bob, 10_000 ether);
        token.setSwapSettings(1, true);
        token.swapAndSplit();

        assertEq(token.pendingDividends(), 0);
        assertEq(tracker.totalDividendsDistributed(), 240 ether, "120 carried + 120 new");
    }

    function test_trackerSharesFollowBalances() public {
        _buy(alice, 10_000 ether);
        assertEq(tracker.sharesOf(alice), token.balanceOf(alice));

        vm.prank(alice);
        token.transfer(bob, 1_000 ether);

        assertEq(tracker.sharesOf(alice), token.balanceOf(alice));
        assertEq(tracker.sharesOf(bob), token.balanceOf(bob));
        assertEq(tracker.totalShares(), token.balanceOf(alice) + token.balanceOf(bob));
    }

    function test_excludedAccountsHoldNoShares() public {
        _buy(alice, 10_000 ether);
        assertEq(tracker.sharesOf(pair), 0);
        assertEq(tracker.sharesOf(address(this)), 0);
    }
}
