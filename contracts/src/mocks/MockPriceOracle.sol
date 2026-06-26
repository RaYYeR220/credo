// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IPriceOracle } from "../interfaces/IPriceOracle.sol";

/// @notice Demo price oracle. Prices are USD with 8 decimals (1e8 == $1), Chainlink-style.
///         A production deployment would swap this for Chainlink/Pyth feeds behind IPriceOracle.
contract MockPriceOracle is IPriceOracle, Ownable {
    uint8 public constant PRICE_DECIMALS = 8;

    mapping(address token => uint256 priceUsd) private _prices;

    constructor() Ownable(msg.sender) { }

    function setPrice(address token, uint256 newPriceUsd) external onlyOwner {
        _prices[token] = newPriceUsd;
        emit PriceSet(token, newPriceUsd);
    }

    /// @inheritdoc IPriceOracle
    function priceUsd(address token) external view returns (uint256) {
        uint256 p = _prices[token];
        require(p != 0, "oracle: price unset");
        return p;
    }
}
