// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {ClaimDistributor} from "../src/ClaimDistributor.sol";
import {ISwapRouter} from "../src/interfaces/ISwapRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockAggregator} from "../src/mocks/MockAggregator.sol";

contract ClaimDistributorTest is Base {
    ClaimDistributor internal distributor;

    uint256 internal signerKey = 0xA11CE;
    address internal signer;

    uint256 internal constant SEASON = 7;
    uint256 internal constant ALICE_PRIZE = 250 ether;
    uint256 internal constant BOB_PRIZE = 100 ether;

    bytes32 internal aliceLeaf;
    bytes32 internal bobLeaf;
    bytes32 internal root;

    function setUp() public override {
        super.setUp();

        signer = vm.addr(signerKey);
        distributor =
            new ClaimDistributor(address(this), quote, ISwapRouter(address(router)), signer);
        distributor.setRewardToken(address(tsla), true);

        quote.mint(address(distributor), 10_000 ether);

        aliceLeaf =
            distributor.leaf(alice, SEASON, ClaimDistributor.RewardKind.Leaderboard, ALICE_PRIZE);
        bobLeaf = distributor.leaf(bob, SEASON, ClaimDistributor.RewardKind.Leaderboard, BOB_PRIZE);
        root = _hashPair(aliceLeaf, bobLeaf);

        distributor.setMerkleRoot(SEASON, ClaimDistributor.RewardKind.Leaderboard, root);
    }

    /// @dev OpenZeppelin's verifier hashes siblings in sorted order.
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _aliceProof() internal view returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = bobLeaf;
    }

    // ------------------------------------------------------------ merkle path

    function test_claimWithProofPaysInChosenStock() public {
        router.setRate(address(quote), address(tsla), 0.25e18);

        vm.prank(alice);
        uint256 out = distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            _aliceProof(),
            address(tsla),
            60 ether
        );

        assertEq(out, 62.5 ether);
        assertEq(tsla.balanceOf(alice), 62.5 ether);
    }

    function test_claimWithProofCanPayInQuote() public {
        vm.prank(alice);
        distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            _aliceProof(),
            address(quote),
            0
        );

        assertEq(quote.balanceOf(alice), ALICE_PRIZE);
    }

    function test_cannotClaimTwiceWithProof() public {
        vm.startPrank(alice);
        distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            _aliceProof(),
            address(quote),
            0
        );

        vm.expectRevert(ClaimDistributor.AlreadyClaimed.selector);
        distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            _aliceProof(),
            address(quote),
            0
        );
        vm.stopPrank();
    }

    function test_cannotClaimSomeoneElsesEntry() public {
        vm.prank(bob);
        vm.expectRevert(ClaimDistributor.InvalidProof.selector);
        distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            _aliceProof(),
            address(quote),
            0
        );
    }

    function test_cannotInflateTheAmount() public {
        vm.prank(alice);
        vm.expectRevert(ClaimDistributor.InvalidProof.selector);
        distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE + 1,
            _aliceProof(),
            address(quote),
            0
        );
    }

    function test_claimRevertsWhenRootUnset() public {
        vm.prank(alice);
        vm.expectRevert(ClaimDistributor.RootNotSet.selector);
        distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Welcome,
            ALICE_PRIZE,
            _aliceProof(),
            address(quote),
            0
        );
    }

    function test_claimRejectsUnknownRewardToken() public {
        vm.prank(alice);
        vm.expectRevert(ClaimDistributor.TokenNotAllowlisted.selector);
        distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            _aliceProof(),
            address(token),
            0
        );
    }

    // --------------------------------------------------------- signature path

    function _sign(address account, uint256 season, ClaimDistributor.RewardKind kind, uint256 amount, uint256 deadline, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("PickClaimDistributor")),
                keccak256(bytes("1")),
                block.chainid,
                address(distributor)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                distributor.CLAIM_TYPEHASH(), account, season, uint8(kind), amount, deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_claimWithSignaturePaysWelcomeReward() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig =
            _sign(alice, SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, signerKey);

        vm.prank(alice);
        distributor.claimWithSignature(
            SEASON,
            ClaimDistributor.RewardKind.Welcome,
            10 ether,
            deadline,
            sig,
            address(tsla),
            0
        );

        assertEq(tsla.balanceOf(alice), 10 ether);
    }

    function test_signatureFromWrongKeyIsRejected() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(
            alice, SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, 0xBADBAD
        );

        vm.prank(alice);
        vm.expectRevert(ClaimDistributor.InvalidSignature.selector);
        distributor.claimWithSignature(
            SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, sig, address(tsla), 0
        );
    }

    function test_signatureCannotBeReplayedByAnotherAccount() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig =
            _sign(alice, SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, signerKey);

        vm.prank(bob);
        vm.expectRevert(ClaimDistributor.InvalidSignature.selector);
        distributor.claimWithSignature(
            SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, sig, address(tsla), 0
        );
    }

    function test_expiredSignatureIsRejected() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig =
            _sign(alice, SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, signerKey);

        vm.warp(deadline + 1);

        vm.prank(alice);
        vm.expectRevert(ClaimDistributor.SignatureExpired.selector);
        distributor.claimWithSignature(
            SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, sig, address(tsla), 0
        );
    }

    function test_signatureCannotBeUsedTwice() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig =
            _sign(alice, SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, signerKey);

        vm.startPrank(alice);
        distributor.claimWithSignature(
            SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, sig, address(tsla), 0
        );

        vm.expectRevert(ClaimDistributor.AlreadyClaimed.selector);
        distributor.claimWithSignature(
            SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, sig, address(tsla), 0
        );
        vm.stopPrank();
    }

    /// @dev The two authorisation paths must share one claimed-ledger.
    function test_merkleClaimBlocksTheSignaturePathForTheSameEntry() public {
        vm.prank(alice);
        distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            _aliceProof(),
            address(quote),
            0
        );

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(
            alice, SEASON, ClaimDistributor.RewardKind.Leaderboard, ALICE_PRIZE, deadline, signerKey
        );

        vm.prank(alice);
        vm.expectRevert(ClaimDistributor.AlreadyClaimed.selector);
        distributor.claimWithSignature(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            deadline,
            sig,
            address(quote),
            0
        );
    }

    function test_differentKindsAreClaimedIndependently() public {
        vm.prank(alice);
        distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            _aliceProof(),
            address(quote),
            0
        );

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig =
            _sign(alice, SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, signerKey);

        vm.prank(alice);
        distributor.claimWithSignature(
            SEASON, ClaimDistributor.RewardKind.Welcome, 10 ether, deadline, sig, address(quote), 0
        );

        assertEq(quote.balanceOf(alice), ALICE_PRIZE + 10 ether);
    }

    // ------------------------------------------------------------ oracle floor

    uint32 internal constant MAX_AGE = 4 days;
    /// @dev $250.00 at the 8 decimals Chainlink USD feeds use.
    int256 internal constant TSLA_USD = 250e8;
    /// @dev Rate that makes the mock router agree with a $250 feed: 250 quote
    ///      buys exactly 1 TSLA.
    uint256 internal constant FAIR_RATE = 4e15;

    function _withTslaFeed() internal returns (MockAggregator feed) {
        feed = new MockAggregator(8, TSLA_USD);
        distributor.setPriceFeed(address(tsla), feed, MAX_AGE);
        router.setRate(address(quote), address(tsla), FAIR_RATE);
    }

    function _claimTsla(uint256 minOut) internal returns (uint256) {
        vm.prank(alice);
        return distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            _aliceProof(),
            address(tsla),
            minOut
        );
    }

    function test_oracleFloorMatchesTheFeedPrice() public {
        _withTslaFeed();

        // The prize is 250 quote and the feed says a share costs $250.
        assertEq(distributor.swapFloor(address(tsla), ALICE_PRIZE, 0), 0.99 ether);
        assertEq(_claimTsla(0), 1 ether);
    }

    /// @dev The regression test for the original hole: the client used to pass a
    ///      hardcoded 0 here, which left the swap completely unprotected.
    function test_callerPassingZeroStillGetsTheOracleFloor() public {
        MockAggregator feed = _withTslaFeed();
        feed.setAnswer(TSLA_USD);

        // A sandwich that returns 25% less than the feed implies.
        router.setRate(address(quote), address(tsla), 3e15);

        vm.expectRevert("MockSwapRouter: insufficient output");
        _claimTsla(0);
    }

    function test_callerCanTightenTheFloorButNotLoosenIt() public {
        _withTslaFeed();

        // Above the oracle floor, the caller's own number wins.
        assertEq(distributor.swapFloor(address(tsla), ALICE_PRIZE, 2 ether), 2 ether);
        // Below it, the oracle's does.
        assertEq(distributor.swapFloor(address(tsla), ALICE_PRIZE, 1), 0.99 ether);
    }

    function test_routerIgnoringTheFloorIsCaughtAnyway() public {
        _withTslaFeed();
        router.setRate(address(quote), address(tsla), 3e15);
        router.setIgnoreMinOut(true);

        vm.expectRevert(
            abi.encodeWithSelector(
                ClaimDistributor.SlippageExceeded.selector, 0.75 ether, 0.99 ether
            )
        );
        _claimTsla(0);
    }

    function test_staleFeedIsRejected() public {
        MockAggregator feed = _withTslaFeed();
        vm.warp(block.timestamp + MAX_AGE + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                ClaimDistributor.StalePrice.selector, address(feed), feed.updatedAt()
            )
        );
        _claimTsla(0);
    }

    function test_nonPositivePriceIsRejected() public {
        MockAggregator feed = _withTslaFeed();
        feed.setAnswer(0);

        vm.expectRevert(
            abi.encodeWithSelector(ClaimDistributor.InvalidPrice.selector, address(feed), int256(0))
        );
        _claimTsla(0);
    }

    function test_sequencerDownBlocksClaims() public {
        _withTslaFeed();

        MockAggregator uptime = new MockAggregator(0, 1); // 1 = down
        distributor.setSequencerUptimeFeed(uptime, 1 hours);

        vm.expectRevert(ClaimDistributor.SequencerDown.selector);
        _claimTsla(0);
    }

    function test_sequencerGracePeriodBlocksClaims() public {
        _withTslaFeed();

        MockAggregator uptime = new MockAggregator(0, 0); // up, but only just
        distributor.setSequencerUptimeFeed(uptime, 1 hours);

        vm.expectRevert(ClaimDistributor.SequencerGracePeriod.selector);
        _claimTsla(0);

        // Once the grace period is behind us the same claim goes through.
        vm.warp(block.timestamp + 1 hours + 1);
        assertEq(_claimTsla(0), 1 ether);
    }

    function test_oracleRequiredBlocksTokensWithNoFeed() public {
        distributor.setOracleRequired(true);

        vm.expectRevert(
            abi.encodeWithSelector(ClaimDistributor.PriceFeedMissing.selector, address(tsla))
        );
        _claimTsla(0);
    }

    function test_quotePayoutsDoNotConsultTheOracle() public {
        MockAggregator feed = _withTslaFeed();
        feed.setUpdatedAt(1);
        vm.warp(block.timestamp + MAX_AGE + 1);
        distributor.setOracleRequired(true);

        // Paying in the quote asset is not a swap, so there is nothing to price.
        vm.prank(alice);
        distributor.claimWithProof(
            SEASON,
            ClaimDistributor.RewardKind.Leaderboard,
            ALICE_PRIZE,
            _aliceProof(),
            address(quote),
            0
        );

        assertEq(quote.balanceOf(alice), ALICE_PRIZE);
    }

    function test_quoteFeedDepegTightensTheFloor() public {
        _withTslaFeed();

        // Quote is worth $0.50, so the same prize should only buy half a share.
        MockAggregator quoteAggregator = new MockAggregator(8, 0.5e8);
        distributor.setQuoteFeed(quoteAggregator, MAX_AGE);

        assertEq(distributor.swapFloor(address(tsla), ALICE_PRIZE, 0), 0.495 ether);
    }

    function test_floorScalesAcrossMismatchedDecimals() public {
        // A 6-decimal stablecoin paying out an 18-decimal stock token is the
        // shape most likely to expose a scaling bug.
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        ClaimDistributor sixDecimals =
            new ClaimDistributor(address(this), usdc, ISwapRouter(address(router)), signer);
        sixDecimals.setRewardToken(address(tsla), true);
        sixDecimals.setPriceFeed(address(tsla), new MockAggregator(8, TSLA_USD), MAX_AGE);

        // $500 of a 6-decimal quote buys two shares at $250.
        assertEq(sixDecimals.swapFloor(address(tsla), 500e6, 0), 1.98 ether);
    }

    function test_feedWithoutAMaxAgeIsRejected() public {
        MockAggregator feed = new MockAggregator(8, TSLA_USD);

        vm.expectRevert(ClaimDistributor.InvalidMaxAge.selector);
        distributor.setPriceFeed(address(tsla), feed, 0);

        vm.expectRevert(ClaimDistributor.InvalidMaxAge.selector);
        distributor.setQuoteFeed(feed, 0);
    }

    function test_maxSlippageIsCapped() public {
        vm.expectRevert(ClaimDistributor.InvalidSlippage.selector);
        distributor.setMaxSlippageBps(1_001);

        distributor.setMaxSlippageBps(1_000);
        assertEq(distributor.maxSlippageBps(), 1_000);
    }

    function test_widerSlippageLowersTheFloor() public {
        _withTslaFeed();
        distributor.setMaxSlippageBps(500);

        assertEq(distributor.swapFloor(address(tsla), ALICE_PRIZE, 0), 0.95 ether);
    }
}
