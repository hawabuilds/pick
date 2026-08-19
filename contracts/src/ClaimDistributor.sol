// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @title ClaimDistributor
/// @notice Pays out leaderboard prizes and the $10 welcome reward. The backend
///         authorises a claim either by publishing a Merkle root for a season or
///         by signing an EIP-712 message; the user claims their entry and picks
///         which allowlisted tokenized stock to receive it in.
///
/// @dev UNAUDITED. Do not deploy to mainnet without a professional audit.
///
///      Both authorisation paths write to the same `claimed` mapping, so a
///      player who appears in a Merkle root cannot also claim the same season
///      and kind with a signature.
contract ClaimDistributor is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    enum RewardKind {
        Leaderboard,
        Welcome
    }

    /// @notice A Chainlink feed plus how old its answer may be before this
    ///         contract stops trusting it.
    /// @dev `maxAge` is deliberately per-feed and generous rather than the
    ///      feed's heartbeat. Robinhood's tokenized equity feeds are 24/5 and
    ///      publish no heartbeat while the underlying market is closed, so a
    ///      heartbeat-tight bound would reject every claim made over a weekend.
    struct Feed {
        AggregatorV3Interface aggregator;
        uint32 maxAge;
    }

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(address account,uint256 season,uint8 kind,uint256 amount,uint256 deadline)"
    );

    uint256 internal constant BPS = 10_000;

    IERC20 public immutable quoteToken;
    uint8 internal immutable quoteDecimals;

    ISwapRouter public swapRouter;
    /// @notice Backend key permitted to sign EIP-712 claims.
    address public trustedSigner;

    mapping(uint256 season => mapping(RewardKind => bytes32)) public merkleRoot;
    mapping(bytes32 entry => bool) public claimed;
    mapping(address token => bool) public isRewardToken;

    /// @notice Price feed per reward token, used to derive the swap floor.
    mapping(address token => Feed) public priceFeed;
    /// @notice Optional feed for the quote asset. Unset means "treat as $1",
    ///         which is the normal case for a USD stablecoin.
    Feed public quoteFeed;
    /// @notice Chainlink L2 sequencer uptime feed. Unset disables the check,
    ///         which is only appropriate locally and on testnet.
    AggregatorV3Interface public sequencerUptimeFeed;
    uint32 public sequencerGracePeriod = 1 hours;
    /// @notice How far below the oracle-implied output a swap may land.
    uint16 public maxSlippageBps = 100;
    /// @notice When true, a reward token with no configured feed cannot be
    ///         claimed. Must be turned on for mainnet.
    bool public oracleRequired;

    event MerkleRootSet(uint256 indexed season, RewardKind indexed kind, bytes32 root);
    event TrustedSignerSet(address indexed signer);
    event SwapRouterSet(address indexed router);
    event RewardTokenSet(address indexed token, bool allowed);
    event PriceFeedSet(address indexed token, address indexed aggregator, uint32 maxAge);
    event QuoteFeedSet(address indexed aggregator, uint32 maxAge);
    event SequencerFeedSet(address indexed aggregator, uint32 gracePeriod);
    event MaxSlippageSet(uint16 bps);
    event OracleRequiredSet(bool required);
    event Claimed(
        address indexed account,
        uint256 indexed season,
        RewardKind indexed kind,
        address rewardToken,
        uint256 quoteAmount,
        uint256 amountOut
    );
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error AlreadyClaimed();
    error InvalidProof();
    error InvalidSignature();
    error SignatureExpired();
    error RootNotSet();
    error TokenNotAllowlisted();
    error ZeroAddress();
    error ZeroAmount();
    error PriceFeedMissing(address token);
    error StalePrice(address aggregator, uint256 updatedAt);
    error InvalidPrice(address aggregator, int256 answer);
    error SequencerDown();
    error SequencerGracePeriod();
    error InvalidMaxAge();
    error InvalidSlippage();
    error SlippageExceeded(uint256 amountOut, uint256 required);

    constructor(address owner_, IERC20 quoteToken_, ISwapRouter swapRouter_, address trustedSigner_)
        Ownable(owner_)
        EIP712("PickClaimDistributor", "1")
    {
        if (address(quoteToken_) == address(0)) revert ZeroAddress();
        quoteToken = quoteToken_;
        quoteDecimals = IERC20Metadata(address(quoteToken_)).decimals();
        swapRouter = swapRouter_;
        trustedSigner = trustedSigner_;
    }

    // ------------------------------------------------------------------ admin

    function setMerkleRoot(uint256 season, RewardKind kind, bytes32 root) external onlyOwner {
        merkleRoot[season][kind] = root;
        emit MerkleRootSet(season, kind, root);
    }

    function setTrustedSigner(address signer) external onlyOwner {
        trustedSigner = signer;
        emit TrustedSignerSet(signer);
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

    /// @notice Point a reward token at its Chainlink feed proxy.
    /// @dev Addresses must come from Chainlink's feed directory for this chain.
    ///      Passing the zero aggregator clears the feed, which only claims can
    ///      tolerate while `oracleRequired` is false.
    function setPriceFeed(address token, AggregatorV3Interface aggregator, uint32 maxAge)
        external
        onlyOwner
    {
        if (token == address(0)) revert ZeroAddress();
        if (address(aggregator) != address(0) && maxAge == 0) revert InvalidMaxAge();
        priceFeed[token] = Feed({aggregator: aggregator, maxAge: maxAge});
        emit PriceFeedSet(token, address(aggregator), maxAge);
    }

    function setQuoteFeed(AggregatorV3Interface aggregator, uint32 maxAge) external onlyOwner {
        if (address(aggregator) != address(0) && maxAge == 0) revert InvalidMaxAge();
        quoteFeed = Feed({aggregator: aggregator, maxAge: maxAge});
        emit QuoteFeedSet(address(aggregator), maxAge);
    }

    function setSequencerUptimeFeed(AggregatorV3Interface aggregator, uint32 gracePeriod)
        external
        onlyOwner
    {
        sequencerUptimeFeed = aggregator;
        sequencerGracePeriod = gracePeriod;
        emit SequencerFeedSet(address(aggregator), gracePeriod);
    }

    /// @param bps How far below the oracle-implied output a swap may land.
    ///        Capped well under 100% so a fat finger cannot disable the guard.
    function setMaxSlippageBps(uint16 bps) external onlyOwner {
        if (bps > 1_000) revert InvalidSlippage();
        maxSlippageBps = bps;
        emit MaxSlippageSet(bps);
    }

    function setOracleRequired(bool required) external onlyOwner {
        oracleRequired = required;
        emit OracleRequiredSet(required);
    }

    /// @notice Recover unclaimed funds once a season is long settled.
    function withdraw(IERC20 token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit Withdrawn(address(token), to, amount);
    }

    // ----------------------------------------------------------------- claims

    function entryKey(address account, uint256 season, RewardKind kind)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(account, season, kind));
    }

    /// @dev Double-hashed to rule out the second-preimage attack where an
    ///      internal node is passed off as a leaf.
    function leaf(address account, uint256 season, RewardKind kind, uint256 amount)
        public
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(account, season, kind, amount))));
    }

    /// @notice Claim an entry that appears in the season's Merkle root.
    /// @param rewardToken Allowlisted stock to receive, or the quote token itself.
    /// @param minOut Optional extra slippage floor. The contract derives its own
    ///        floor from the price feed and takes whichever is higher, so 0 is
    ///        a safe value here.
    function claimWithProof(
        uint256 season,
        RewardKind kind,
        uint256 amount,
        bytes32[] calldata proof,
        address rewardToken,
        uint256 minOut
    ) external nonReentrant returns (uint256 amountOut) {
        bytes32 root = merkleRoot[season][kind];
        if (root == bytes32(0)) revert RootNotSet();
        if (!MerkleProof.verifyCalldata(proof, root, leaf(msg.sender, season, kind, amount))) {
            revert InvalidProof();
        }
        return _settle(msg.sender, season, kind, amount, rewardToken, minOut);
    }

    /// @notice Claim an entry authorised by the backend signer.
    function claimWithSignature(
        uint256 season,
        RewardKind kind,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature,
        address rewardToken,
        uint256 minOut
    ) external nonReentrant returns (uint256 amountOut) {
        // A deadline is exactly what block.timestamp is for; the few seconds of
        // validator leeway do not matter against an hour-scale expiry.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert SignatureExpired();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(CLAIM_TYPEHASH, msg.sender, season, uint8(kind), amount, deadline)
            )
        );
        address signer = ECDSA.recover(digest, signature);
        if (signer == address(0) || signer != trustedSigner) revert InvalidSignature();

        return _settle(msg.sender, season, kind, amount, rewardToken, minOut);
    }

    // ----------------------------------------------------------------- oracle

    function _requireSequencerUp() internal view {
        AggregatorV3Interface feed = sequencerUptimeFeed;
        if (address(feed) == address(0)) return;

        (, int256 status, uint256 startedAt,,) = feed.latestRoundData();
        // The uptime feed answers 0 for up and 1 for down.
        if (status != 0) revert SequencerDown();
        // After a restart, prices need time to catch up before they mean anything.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp - startedAt <= sequencerGracePeriod) revert SequencerGracePeriod();
    }

    function _readPrice(Feed memory feed) internal view returns (uint256 price, uint8 decimals_) {
        (, int256 answer,, uint256 updatedAt,) = feed.aggregator.latestRoundData();
        if (answer <= 0) revert InvalidPrice(address(feed.aggregator), answer);
        // Staleness is the primary guard. A feed frozen by a corporate action
        // keeps answering, so age is what actually catches it.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp - updatedAt > feed.maxAge) {
            revert StalePrice(address(feed.aggregator), updatedAt);
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        price = uint256(answer);
        decimals_ = feed.aggregator.decimals();
    }

    /// @notice How many `rewardToken` the oracles say `amountIn` of quote buys.
    /// @dev Returns 0 when no feed is configured, which leaves the caller's
    ///      `minOut` as the only floor. That is the testnet shape, where the
    ///      router is a fixed-rate mock and there is nothing to sandwich.
    function _expectedOut(address rewardToken, uint256 amountIn)
        internal
        view
        returns (uint256)
    {
        Feed memory tokenFeed = priceFeed[rewardToken];
        if (address(tokenFeed.aggregator) == address(0)) {
            if (oracleRequired) revert PriceFeedMissing(rewardToken);
            return 0;
        }

        _requireSequencerUp();

        (uint256 tokenPrice, uint8 tokenFeedDecimals) = _readPrice(tokenFeed);

        uint256 quotePrice = 1;
        uint8 quoteFeedDecimals = 0;
        Feed memory qf = quoteFeed;
        if (address(qf.aggregator) != address(0)) {
            (quotePrice, quoteFeedDecimals) = _readPrice(qf);
        }

        // amountIn is quote-denominated, so convert to USD via the quote feed
        // and back out through the token feed, rescaling to the token's own
        // decimals. Multiplications lead so the division truncates only once.
        uint256 numerator =
            amountIn * quotePrice * (10 ** tokenFeedDecimals) * (10 ** IERC20Metadata(rewardToken).decimals());
        uint256 denominator = (10 ** quoteDecimals) * (10 ** quoteFeedDecimals) * tokenPrice;
        return numerator / denominator;
    }

    /// @notice The floor a claim swap must clear, given the oracle and the
    ///         caller's own preference. Useful to preview from the client.
    function swapFloor(address rewardToken, uint256 amountIn, uint256 minOut)
        public
        view
        returns (uint256)
    {
        uint256 expected = _expectedOut(rewardToken, amountIn);
        uint256 floor = (expected * (BPS - maxSlippageBps)) / BPS;
        return minOut > floor ? minOut : floor;
    }

    // ---------------------------------------------------------------- settle

    function _settle(
        address account,
        uint256 season,
        RewardKind kind,
        uint256 amount,
        address rewardToken,
        uint256 minOut
    ) internal returns (uint256 amountOut) {
        if (amount == 0) revert ZeroAmount();

        bytes32 key = entryKey(account, season, kind);
        if (claimed[key]) revert AlreadyClaimed();
        claimed[key] = true;

        if (rewardToken == address(quoteToken)) {
            quoteToken.safeTransfer(account, amount);
            amountOut = amount;
        } else {
            if (!isRewardToken[rewardToken]) revert TokenNotAllowlisted();

            // The caller's minOut is only ever allowed to tighten the floor,
            // never to loosen it: a claimer who passes 0 still gets the oracle's
            // protection, which is the whole point of deriving it here.
            uint256 floor = swapFloor(rewardToken, amount, minOut);

            quoteToken.forceApprove(address(swapRouter), amount);
            amountOut = swapRouter.swapExactInput(
                address(quoteToken), rewardToken, amount, floor, account
            );
            quoteToken.forceApprove(address(swapRouter), 0);

            // Belt and braces: a router that ignores its own floor should not
            // be able to short the claimer.
            if (amountOut < floor) revert SlippageExceeded(amountOut, floor);
        }

        emit Claimed(account, season, kind, rewardToken, amount, amountOut);
    }
}
