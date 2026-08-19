// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {SplitTaxToken} from "../src/SplitTaxToken.sol";
import {RWADividendTracker} from "../src/RWADividendTracker.sol";
import {ClaimDistributor} from "../src/ClaimDistributor.sol";
import {ISwapRouter} from "../src/interfaces/ISwapRouter.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

/// @notice Deploys the full system to Robinhood Chain testnet and writes the
///         addresses to `deployments/<chainid>.json` so the app can pick them up.
///
/// @dev Testnet only. Every stock token and the quote token are mocks that
///      anyone can mint, and the router prints its own output. None of this is
///      safe anywhere real value exists.
///
///      Usage:
///        forge script script/Deploy.s.sol:Deploy \
///          --rpc-url rh_testnet --broadcast \
///          --verify --verifier blockscout \
///          --verifier-url https://explorer.testnet.chain.robinhood.com/api
contract Deploy is Script {
    string[5] internal STOCK_SYMBOLS = ["TSLA", "AMZN", "PLTR", "NFLX", "AMD"];

    struct Deployment {
        address token;
        address tracker;
        address distributor;
        address quote;
        address router;
        address leaderboardVault;
        address learnerVault;
        address[5] stocks;
    }

    /// @dev Held in storage rather than passed around: the writer needs every
    ///      address at once and the stack cannot carry them all.
    Deployment internal d;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address leaderboardVault = vm.envOr("LEADERBOARD_VAULT", deployer);
        address learnerVault = vm.envOr("LEARNER_VAULT", deployer);
        address trustedSigner = vm.envOr("TRUSTED_SIGNER", deployer);
        uint256 supply = vm.envOr("TOKEN_SUPPLY", uint256(1_000_000 ether));

        vm.startBroadcast(pk);

        MockERC20 quote = new MockERC20("Pick USD", "pUSD", 18);
        MockSwapRouter router = new MockSwapRouter();

        RWADividendTracker tracker =
            new RWADividendTracker(deployer, quote, ISwapRouter(address(router)));

        SplitTaxToken token = new SplitTaxToken(
            "Pick",
            "PICK",
            supply,
            deployer,
            quote,
            ISwapRouter(address(router)),
            tracker,
            leaderboardVault,
            learnerVault
        );

        ClaimDistributor distributor =
            new ClaimDistributor(deployer, quote, ISwapRouter(address(router)), trustedSigner);

        tracker.setShareToken(address(token));

        // Non-players must not dilute holder dividends. The router belongs on
        // this list as much as the vaults: it holds fee tokens mid-swap.
        tracker.setExcluded(address(router), true);
        tracker.setExcluded(address(distributor), true);
        tracker.setExcluded(leaderboardVault, true);
        tracker.setExcluded(learnerVault, true);
        tracker.setExcluded(deployer, true);

        for (uint256 i = 0; i < STOCK_SYMBOLS.length; i++) {
            MockERC20 stock = new MockERC20(STOCK_SYMBOLS[i], STOCK_SYMBOLS[i], 18);
            d.stocks[i] = address(stock);

            tracker.setRewardToken(address(stock), true);
            distributor.setRewardToken(address(stock), true);
            // Placeholder 1:1 pricing. Reset per ticker once quotes are wired.
            router.setRate(address(quote), address(stock), 1e18);

            _configureFeed(distributor, STOCK_SYMBOLS[i], address(stock));
        }
        router.setRate(address(token), address(quote), 1e18);

        _configureOracleGuards(distributor);

        // Seed the distributor so a manual test claim can actually pay out.
        quote.mint(address(distributor), 100_000 ether);

        vm.stopBroadcast();

        d.token = address(token);
        d.tracker = address(tracker);
        d.distributor = address(distributor);
        d.quote = address(quote);
        d.router = address(router);
        d.leaderboardVault = leaderboardVault;
        d.learnerVault = learnerVault;

        _write();
    }

    /// @dev Feed proxies are read from the environment, never hardcoded, because
    ///      Chainlink's directory is the source of truth for which feeds exist on
    ///      a given chain. An unset symbol simply leaves that token without a
    ///      floor, which only `ORACLE_REQUIRED=false` deployments tolerate.
    function _configureFeed(ClaimDistributor distributor, string memory symbol, address stock)
        internal
    {
        address feed = vm.envOr(string.concat("CHAINLINK_FEED_", symbol), address(0));
        if (feed == address(0)) {
            console2.log("No CHAINLINK_FEED_%s set; %s has no oracle floor", symbol, symbol);
            return;
        }
        uint32 maxAge = uint32(vm.envOr("CHAINLINK_MAX_AGE", uint256(4 days)));
        distributor.setPriceFeed(stock, AggregatorV3Interface(feed), maxAge);
    }

    function _configureOracleGuards(ClaimDistributor distributor) internal {
        address quoteFeed = vm.envOr("CHAINLINK_FEED_QUOTE", address(0));
        uint32 maxAge = uint32(vm.envOr("CHAINLINK_MAX_AGE", uint256(4 days)));
        if (quoteFeed != address(0)) {
            distributor.setQuoteFeed(AggregatorV3Interface(quoteFeed), maxAge);
        }

        address sequencer = vm.envOr("SEQUENCER_UPTIME_FEED", address(0));
        if (sequencer != address(0)) {
            uint32 grace = uint32(vm.envOr("SEQUENCER_GRACE_PERIOD", uint256(1 hours)));
            distributor.setSequencerUptimeFeed(AggregatorV3Interface(sequencer), grace);
        }

        uint16 slippage = uint16(vm.envOr("MAX_SLIPPAGE_BPS", uint256(100)));
        distributor.setMaxSlippageBps(slippage);

        if (vm.envOr("ORACLE_REQUIRED", false)) {
            distributor.setOracleRequired(true);
        }
    }

    function _write() internal {
        string memory stockKey = "stocks";
        string memory stockJson;
        for (uint256 i = 0; i < STOCK_SYMBOLS.length; i++) {
            stockJson = vm.serializeAddress(stockKey, STOCK_SYMBOLS[i], d.stocks[i]);
        }

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "splitTaxToken", d.token);
        vm.serializeAddress(key, "dividendTracker", d.tracker);
        vm.serializeAddress(key, "claimDistributor", d.distributor);
        vm.serializeAddress(key, "quoteToken", d.quote);
        vm.serializeAddress(key, "swapRouter", d.router);
        vm.serializeAddress(key, "leaderboardVault", d.leaderboardVault);
        vm.serializeAddress(key, "learnerVault", d.learnerVault);
        string memory json = vm.serializeString(key, "stocks", stockJson);

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console2.log("");
        console2.log("Deployment written to %s", path);
        console2.log("NEXT_PUBLIC_TOKEN_ADDRESS=%s", d.token);
        console2.log("NEXT_PUBLIC_DIVIDEND_TRACKER_ADDRESS=%s", d.tracker);
        console2.log("NEXT_PUBLIC_CLAIM_DISTRIBUTOR_ADDRESS=%s", d.distributor);
        console2.log("NEXT_PUBLIC_QUOTE_TOKEN_ADDRESS=%s", d.quote);
        console2.log("NEXT_PUBLIC_SWAP_ROUTER_ADDRESS=%s", d.router);
    }
}
