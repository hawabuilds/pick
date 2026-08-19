// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @notice Controllable Chainlink feed for tests and testnet.
/// @dev Doubles as a sequencer uptime feed, where `answer` is 0 for up and 1
///      for down and `startedAt` is when that status began.
contract MockAggregator is AggregatorV3Interface {
    uint8 public immutable override decimals;

    int256 public answer;
    uint256 public updatedAt;
    uint256 public startedAt;
    uint80 public roundId;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        answer = answer_;
        updatedAt = block.timestamp;
        startedAt = block.timestamp;
        roundId = 1;
    }

    function setAnswer(int256 answer_) external {
        answer = answer_;
        updatedAt = block.timestamp;
        roundId += 1;
    }

    /// @notice Age the feed without changing its answer, to test staleness.
    function setUpdatedAt(uint256 updatedAt_) external {
        updatedAt = updatedAt_;
    }

    function setStartedAt(uint256 startedAt_) external {
        startedAt = startedAt_;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, answer, startedAt, updatedAt, roundId);
    }
}
