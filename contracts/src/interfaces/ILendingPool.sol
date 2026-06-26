// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Lender liquidity pool (ERC4626 shares over the loan asset). Only the CreditManager
///         may move principal in/out. Interest accrues to share price; defaults are socialised.
interface ILendingPool {
    event Lent(address indexed to, uint256 principal);
    event Repaid(uint256 principal, uint256 interest);
    event LossRecorded(uint256 principalLost);
    event CreditManagerSet(address indexed creditManager);
    event MaxUtilizationSet(uint16 maxUtilizationBps);

    /// @notice Disburse `principal` of the loan asset to `to`. Increases outstanding debt.
    function lend(address to, uint256 principal) external;

    /// @notice Settle a loan: pulls principal+interest from the caller (CreditManager) into the pool
    ///         and reduces outstanding by `principal`. Interest raises the share price.
    function repay(uint256 principal, uint256 interest) external;

    /// @notice Write down `principalLost` as a socialised loss (reduces outstanding and totalAssets).
    function recordLoss(uint256 principalLost) external;

    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function totalOutstanding() external view returns (uint256);
    function idleLiquidity() external view returns (uint256);
    /// @notice Max principal that can be drawn right now (min of idle balance and exposure headroom).
    function availableToLend() external view returns (uint256);
    function maxUtilizationBps() external view returns (uint16);
}
