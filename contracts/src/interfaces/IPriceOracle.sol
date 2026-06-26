// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal price oracle: USD price of a token with 8 decimals (1e8 == $1).
interface IPriceOracle {
    event PriceSet(address indexed token, uint256 priceUsd);

    /// @return USD price of `token`, 8 decimals. Reverts if unset.
    function priceUsd(address token) external view returns (uint256);
}
