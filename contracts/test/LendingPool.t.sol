// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { LendingPool } from "../src/LendingPool.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";

contract LendingPoolTest is Test {
    LendingPool pool;
    MockERC20 usd;

    address manager = makeAddr("creditManager");
    address lp = makeAddr("lender");
    address borrower = makeAddr("borrower");
    address stranger = makeAddr("stranger");

    uint16 constant MAX_UTIL = 8000; // 80%

    function setUp() public {
        usd = new MockERC20("Mock USD", "mUSD", 18);
        pool = new LendingPool(usd, "Credo LP Share", "cLP", MAX_UTIL); // test contract = owner
        pool.setCreditManager(manager);

        // Lender seeds 1000 mUSD.
        usd.mint(lp, 1000e18);
        vm.startPrank(lp);
        usd.approve(address(pool), type(uint256).max);
        pool.deposit(1000e18, lp);
        vm.stopPrank();
    }

    function test_DepositPreservesValue() public view {
        // With the inflation-attack virtual-share offset, shares are not 1:1 with assets, but the
        // redeemable value is preserved.
        uint256 shares = pool.balanceOf(lp);
        assertGt(shares, 0);
        assertApproxEqAbs(pool.convertToAssets(shares), 1000e18, 1);
        assertEq(pool.totalAssets(), 1000e18);
        assertEq(pool.idleLiquidity(), 1000e18);
        assertEq(pool.totalOutstanding(), 0);
    }

    function test_OnlyCreditManagerCanLend() public {
        vm.prank(stranger);
        vm.expectRevert(LendingPool.NotCreditManager.selector);
        pool.lend(borrower, 1e18);
    }

    function test_LendDisbursesAndTracksOutstanding() public {
        vm.prank(manager);
        pool.lend(borrower, 500e18);

        assertEq(usd.balanceOf(borrower), 500e18);
        assertEq(pool.totalOutstanding(), 500e18);
        assertEq(pool.idleLiquidity(), 500e18);
        assertEq(pool.totalAssets(), 1000e18); // unchanged: idle down, debt up
    }

    function test_LendRespectsExposureCap() public {
        assertEq(pool.availableToLend(), 800e18); // 80% of 1000

        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.ExceedsAvailable.selector, 801e18, 800e18));
        pool.lend(borrower, 801e18);

        vm.prank(manager);
        pool.lend(borrower, 800e18);
        assertEq(pool.availableToLend(), 0);
    }

    function test_RepayAccruesInterestToSharePrice() public {
        vm.prank(manager);
        pool.lend(borrower, 500e18);

        // Manager forwards principal + interest back to the pool.
        usd.mint(manager, 550e18);
        vm.startPrank(manager);
        usd.approve(address(pool), 550e18);
        pool.repay(500e18, 50e18);
        vm.stopPrank();

        assertEq(pool.totalOutstanding(), 0);
        assertEq(pool.totalAssets(), 1050e18);

        // Lender redeems and earns the interest.
        uint256 shares = pool.balanceOf(lp);
        vm.prank(lp);
        pool.redeem(shares, lp, lp);
        assertApproxEqAbs(usd.balanceOf(lp), 1050e18, 1); // ERC4626 rounds 1 wei to the vault
    }

    function test_RecordLossSocialisedToLenders() public {
        vm.prank(manager);
        pool.lend(borrower, 500e18);

        vm.prank(manager);
        pool.recordLoss(500e18);

        assertEq(pool.totalOutstanding(), 0);
        assertEq(pool.totalAssets(), 500e18); // lenders bear the loss

        uint256 shares = pool.balanceOf(lp);
        vm.prank(lp);
        pool.redeem(shares, lp, lp);
        assertEq(usd.balanceOf(lp), 500e18);
    }
}
