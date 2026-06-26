// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ILendingPool } from "./interfaces/ILendingPool.sol";

/// @notice Lender liquidity pool. Shares are ERC4626 over the loan asset. The CreditManager draws
///         principal via lend(), settles via repay() (interest -> share price), and writes down
///         defaults via recordLoss() (socialised across lenders). Exposure is capped so the pool
///         never lends out more than `maxUtilizationBps` of its assets.
contract LendingPool is ERC4626, Ownable, ILendingPool {
    using SafeERC20 for IERC20;

    error NotCreditManager();
    error ExceedsAvailable(uint256 requested, uint256 available);
    error InvalidUtilization();

    uint256 internal constant BPS = 10_000;

    address public creditManager;
    uint16 private _maxUtilizationBps;
    uint256 private _outstanding; // principal currently lent out

    constructor(IERC20 asset_, string memory name_, string memory symbol_, uint16 maxUtilizationBps_)
        ERC4626(asset_)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        if (maxUtilizationBps_ > BPS) revert InvalidUtilization();
        _maxUtilizationBps = maxUtilizationBps_;
    }

    modifier onlyCreditManager() {
        if (msg.sender != creditManager) revert NotCreditManager();
        _;
    }

    /// @dev Virtual-share offset hardens the share price against the ERC4626 first-depositor /
    ///      donation inflation attack (the seeded pool already mitigates it; this is defense in depth).
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // --- views -------------------------------------------------------------

    function asset() public view override(ERC4626, ILendingPool) returns (address) {
        return super.asset();
    }

    /// @dev Total assets = idle balance + outstanding principal owed by borrowers.
    function totalAssets() public view override(ERC4626, ILendingPool) returns (uint256) {
        return super.totalAssets() + _outstanding;
    }

    function idleLiquidity() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function totalOutstanding() external view returns (uint256) {
        return _outstanding;
    }

    function maxUtilizationBps() external view returns (uint16) {
        return _maxUtilizationBps;
    }

    /// @dev Drawable now = min(idle balance, exposure headroom).
    function availableToLend() public view returns (uint256) {
        uint256 maxOutstanding = (totalAssets() * _maxUtilizationBps) / BPS;
        uint256 headroom = maxOutstanding > _outstanding ? maxOutstanding - _outstanding : 0;
        return Math.min(idleLiquidity(), headroom);
    }

    // --- admin -------------------------------------------------------------

    function setCreditManager(address manager) external onlyOwner {
        creditManager = manager;
        emit CreditManagerSet(manager);
    }

    function setMaxUtilizationBps(uint16 bps) external onlyOwner {
        if (bps > BPS) revert InvalidUtilization();
        _maxUtilizationBps = bps;
        emit MaxUtilizationSet(bps);
    }

    // --- credit manager hooks ---------------------------------------------

    function lend(address to, uint256 principal) external onlyCreditManager {
        uint256 available = availableToLend();
        if (principal > available) revert ExceedsAvailable(principal, available);
        _outstanding += principal;
        IERC20(asset()).safeTransfer(to, principal);
        emit Lent(to, principal);
    }

    function repay(uint256 principal, uint256 interest) external onlyCreditManager {
        _outstanding -= principal;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), principal + interest);
        emit Repaid(principal, interest);
    }

    function recordLoss(uint256 principalLost) external onlyCreditManager {
        _outstanding -= principalLost;
        emit LossRecorded(principalLost);
    }
}
