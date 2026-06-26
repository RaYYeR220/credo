// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ReputationRegistry } from "../src/ReputationRegistry.sol";
import { IReputationRegistry } from "../src/interfaces/IReputationRegistry.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract ReputationRegistryTest is Test {
    ReputationRegistry registry;

    address owner = makeAddr("owner");
    address manager = makeAddr("manager"); // the recorder (CreditManager)
    address stranger = makeAddr("stranger");
    address borrower = makeAddr("borrower");

    function setUp() public {
        vm.prank(owner);
        registry = new ReputationRegistry();
        vm.prank(owner);
        registry.setRecorder(manager, true);
    }

    function test_OwnerCanSetRecorder() public {
        assertTrue(registry.isRecorder(manager));
        vm.prank(owner);
        registry.setRecorder(manager, false);
        assertFalse(registry.isRecorder(manager));
    }

    function test_NonOwnerCannotSetRecorder() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        registry.setRecorder(stranger, true);
    }

    function test_OnlyRecorderCanRecord() public {
        vm.prank(stranger);
        vm.expectRevert(ReputationRegistry.NotRecorder.selector);
        registry.recordLoanIssued(borrower, 1000e18);
    }

    function test_RecordLoanIssued() public {
        vm.expectEmit(true, false, false, true);
        emit IReputationRegistry.LoanIssued(borrower, 1000e18);
        vm.prank(manager);
        registry.recordLoanIssued(borrower, 1000e18);

        IReputationRegistry.Profile memory p = registry.getProfile(borrower);
        assertEq(p.loansIssued, 1);
        assertEq(p.totalBorrowed, 1000e18);
    }

    function test_RecordRepayment() public {
        vm.startPrank(manager);
        registry.recordLoanIssued(borrower, 1000e18);
        registry.recordRepayment(borrower, 1000e18);
        vm.stopPrank();

        IReputationRegistry.Profile memory p = registry.getProfile(borrower);
        assertEq(p.loansRepaid, 1);
        assertEq(p.totalRepaid, 1000e18);
    }

    function test_RecordDefault() public {
        vm.startPrank(manager);
        registry.recordLoanIssued(borrower, 1000e18);
        registry.recordDefault(borrower, 400e18);
        vm.stopPrank();

        IReputationRegistry.Profile memory p = registry.getProfile(borrower);
        assertEq(p.loansDefaulted, 1);
        assertEq(p.totalDefaulted, 400e18);
    }

    function test_OnChainScore_NoHistory() public view {
        (uint16 score, bool hasHistory) = registry.onChainScore(borrower);
        assertEq(score, 0);
        assertFalse(hasHistory);
    }

    function test_OnChainScore_AllRepaid() public {
        vm.startPrank(manager);
        for (uint256 i = 0; i < 3; i++) {
            registry.recordLoanIssued(borrower, 1000e18);
            registry.recordRepayment(borrower, 1000e18);
        }
        vm.stopPrank();

        (uint16 score, bool hasHistory) = registry.onChainScore(borrower);
        assertTrue(hasHistory);
        assertEq(score, 1000); // 3/3 repaid → perfect
    }

    function test_OnChainScore_HalfDefault() public {
        vm.startPrank(manager);
        registry.recordLoanIssued(borrower, 1000e18);
        registry.recordRepayment(borrower, 1000e18);
        registry.recordLoanIssued(borrower, 1000e18);
        registry.recordDefault(borrower, 1000e18);
        vm.stopPrank();

        (uint16 score, bool hasHistory) = registry.onChainScore(borrower);
        assertTrue(hasHistory);
        assertEq(score, 500); // 1 repaid / 2 closed → 50%
    }
}
