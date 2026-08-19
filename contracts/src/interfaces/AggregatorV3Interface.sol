// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The Chainlink read surface, which is what Robinhood Chain publishes
///         prices through for both crypto and Stock Tokens.
/// @dev Declared locally rather than pulled from a Chainlink package: these two
///      methods are the whole dependency, and the feed proxy addresses must come
///      from Chainlink's directory at deploy time rather than from source.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
