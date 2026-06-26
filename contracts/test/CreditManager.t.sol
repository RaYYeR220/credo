// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { CreditManager } from "../src/CreditManager.sol";
import { LendingPool } from "../src/LendingPool.sol";
import { ReputationRegistry } from "../src/ReputationRegistry.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MockPriceOracle } from "../src/mocks/MockPriceOracle.sol";
import { IReputationRegistry } from "../src/interfaces/IReputationRegistry.sol";

contract CreditManagerTest is Test {
    CreditManager cm;
    LendingPool pool;
    ReputationRegistry reputation;
    MockPriceOracle oracle;
    MockERC20 usd; // loan asset, $1
    MockERC20 weth; // collateral, $2000

    address underwriter;
    uint256 underwriterPk;
    address borrower = makeAddr("borrower");
    address lender = makeAddr("lender");
    address treasury = makeAddr("treasury");

    uint256 constant POOL_SEED = 100_000e18;

    function setUp() public {
        (underwriter, underwriterPk) = makeAddrAndKey("underwriter");

        usd = new MockERC20("Mock USD", "mUSD", 18);
        weth = new MockERC20("Mock ETH", "mETH", 18);

        oracle = new MockPriceOracle();
        oracle.setPrice(address(usd), 1e8); // $1
        oracle.setPrice(address(weth), 2000e8); // $2000

        reputation = new ReputationRegistry();
        pool = new LendingPool(usd, "Credo LP", "cLP", 8000);

        cm = new CreditManager(pool, reputation, oracle, weth, underwriter);

        pool.setCreditManager(address(cm));
        reputation.setRecorder(address(cm), true);
        cm.setCaps({
            perLoanCap_: 50_000e18,
            protocolMaxLtvBps_: 30_000, // collateral as low as ~33%
            maxInterestRateBps_: 10_000, // 100% APR ceiling
            maxTermSeconds_: 90 days,
            grace_: 1 days
        });
        cm.setTreasury(treasury);

        // Seed the pool.
        usd.mint(lender, POOL_SEED);
        vm.startPrank(lender);
        usd.approve(address(pool), POOL_SEED);
        pool.deposit(POOL_SEED, lender);
        vm.stopPrank();

        // Borrower has collateral.
        weth.mint(borrower, 10e18);
    }

    // --- helpers -----------------------------------------------------------

    function _terms(uint256 maxPrincipal, uint16 maxLtvBps, uint16 rateBps)
        internal
        view
        returns (CreditManager.LoanTerms memory t)
    {
        t = CreditManager.LoanTerms({
            borrower: borrower,
            maxPrincipal: maxPrincipal,
            maxLtvBps: maxLtvBps,
            interestRateBps: rateBps,
            termSeconds: 30 days,
            scoreId: 1,
            nonce: cm.nonces(borrower),
            expiry: uint64(block.timestamp + 1 hours)
        });
    }

    function _sign(CreditManager.LoanTerms memory t, uint256 pk) internal view returns (bytes memory) {
        bytes32 digest = cm.hashLoanTerms(t);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Opens the canonical under-collateralized loan: $10k borrowed against $5k collateral.
    function _openUnderCollateralizedLoan() internal returns (uint256 loanId) {
        CreditManager.LoanTerms memory t = _terms(10_000e18, 20_000, 1000); // 200% LTV, 10% APR
        bytes memory sig = _sign(t, underwriterPk);
        vm.startPrank(borrower);
        weth.approve(address(cm), 2.5e18);
        loanId = cm.borrow(t, sig, 10_000e18, 2.5e18); // collateral worth $5,000
        vm.stopPrank();
    }

    // --- borrow: happy path ------------------------------------------------

    function test_Borrow_UnderCollateralized_Succeeds() public {
        uint256 loanId = _openUnderCollateralizedLoan();

        // Borrower got $10k while posting only $5k collateral — genuinely under-collateralized.
        assertEq(usd.balanceOf(borrower), 10_000e18);
        assertEq(weth.balanceOf(address(cm)), 2.5e18);

        CreditManager.Loan memory loan = cm.getLoan(loanId);
        assertEq(loan.principal, 10_000e18);
        assertEq(loan.collateralAmount, 2.5e18);
        assertEq(uint8(loan.status), uint8(CreditManager.LoanStatus.Active));
        assertEq(loan.interestRateBps, 1000);

        assertEq(cm.ltvBps(10_000e18, 2.5e18), 20_000);
        assertEq(cm.nonces(borrower), 1);
        assertEq(pool.totalOutstanding(), 10_000e18);

        IReputationRegistry.Profile memory p = reputation.getProfile(borrower);
        assertEq(p.loansIssued, 1);
    }

    // --- borrow: signature / replay / sender / expiry ----------------------

    function test_Borrow_RevertsOnBadSignature() public {
        (, uint256 wrongPk) = makeAddrAndKey("attacker");
        CreditManager.LoanTerms memory t = _terms(10_000e18, 20_000, 1000);
        bytes memory sig = _sign(t, wrongPk);
        vm.startPrank(borrower);
        weth.approve(address(cm), 2.5e18);
        vm.expectRevert(CreditManager.BadSignature.selector);
        cm.borrow(t, sig, 10_000e18, 2.5e18);
        vm.stopPrank();
    }

    function test_Borrow_RevertsWhenExpired() public {
        CreditManager.LoanTerms memory t = _terms(10_000e18, 20_000, 1000);
        bytes memory sig = _sign(t, underwriterPk);
        vm.warp(block.timestamp + 2 hours); // past expiry
        vm.startPrank(borrower);
        weth.approve(address(cm), 2.5e18);
        vm.expectRevert(CreditManager.Expired.selector);
        cm.borrow(t, sig, 10_000e18, 2.5e18);
        vm.stopPrank();
    }

    function test_Borrow_RevertsWrongBorrower() public {
        CreditManager.LoanTerms memory t = _terms(10_000e18, 20_000, 1000);
        bytes memory sig = _sign(t, underwriterPk);
        vm.prank(lender); // not the attested borrower
        vm.expectRevert(CreditManager.WrongBorrower.selector);
        cm.borrow(t, sig, 10_000e18, 2.5e18);
    }

    function test_Borrow_ReplayProtection() public {
        CreditManager.LoanTerms memory t = _terms(10_000e18, 20_000, 1000);
        bytes memory sig = _sign(t, underwriterPk);
        vm.startPrank(borrower);
        weth.approve(address(cm), type(uint256).max);
        cm.borrow(t, sig, 10_000e18, 2.5e18);
        // same attestation (nonce 0) reused -> rejected
        vm.expectRevert(CreditManager.BadNonce.selector);
        cm.borrow(t, sig, 10_000e18, 2.5e18);
        vm.stopPrank();
    }

    // --- borrow: hard caps (bounded AI authority) --------------------------

    function test_Borrow_RevertsPrincipalOverAttestedMax() public {
        CreditManager.LoanTerms memory t = _terms(10_000e18, 20_000, 1000);
        bytes memory sig = _sign(t, underwriterPk);
        vm.startPrank(borrower);
        weth.approve(address(cm), type(uint256).max);
        vm.expectRevert(CreditManager.PrincipalTooHigh.selector);
        cm.borrow(t, sig, 10_001e18, 5e18); // over attested maxPrincipal
        vm.stopPrank();
    }

    function test_Borrow_RevertsPrincipalOverProtocolCap() public {
        cm.setCaps(5_000e18, 30_000, 10_000, 90 days, 1 days); // perLoanCap 5k
        CreditManager.LoanTerms memory t = _terms(10_000e18, 20_000, 1000);
        bytes memory sig = _sign(t, underwriterPk);
        vm.startPrank(borrower);
        weth.approve(address(cm), type(uint256).max);
        vm.expectRevert(CreditManager.PrincipalTooHigh.selector);
        cm.borrow(t, sig, 6_000e18, 3e18); // within attestation but over protocol cap
        vm.stopPrank();
    }

    function test_Borrow_RevertsActualLtvOverAttested() public {
        CreditManager.LoanTerms memory t = _terms(10_000e18, 20_000, 1000);
        bytes memory sig = _sign(t, underwriterPk);
        vm.startPrank(borrower);
        weth.approve(address(cm), type(uint256).max);
        // only $3k collateral for $10k loan -> LTV ~333% > attested 200%
        vm.expectRevert(CreditManager.LtvTooHigh.selector);
        cm.borrow(t, sig, 10_000e18, 1.5e18);
        vm.stopPrank();
    }

    function test_Borrow_RevertsAttestationLtvOverProtocolCeiling() public {
        // Even a validly-signed attestation cannot exceed the protocol LTV ceiling.
        CreditManager.LoanTerms memory t = _terms(10_000e18, 40_000, 1000); // 400% > protocol 300%
        bytes memory sig = _sign(t, underwriterPk);
        vm.startPrank(borrower);
        weth.approve(address(cm), type(uint256).max);
        vm.expectRevert(CreditManager.LtvTooHigh.selector);
        cm.borrow(t, sig, 10_000e18, 5e18);
        vm.stopPrank();
    }

    function test_Borrow_RevertsInterestOverProtocolCeiling() public {
        CreditManager.LoanTerms memory t = _terms(10_000e18, 20_000, 20_000); // 200% APR > 100% ceiling
        bytes memory sig = _sign(t, underwriterPk);
        vm.startPrank(borrower);
        weth.approve(address(cm), type(uint256).max);
        vm.expectRevert(CreditManager.InterestTooHigh.selector);
        cm.borrow(t, sig, 10_000e18, 5e18);
        vm.stopPrank();
    }

    function test_Borrow_RevertsTermTooLong() public {
        // Even a validly-signed attestation cannot exceed the protocol's max term (bounded AI).
        CreditManager.LoanTerms memory t = CreditManager.LoanTerms({
            borrower: borrower,
            maxPrincipal: 10_000e18,
            maxLtvBps: 20_000,
            interestRateBps: 1000,
            termSeconds: 91 days, // > maxTermSeconds (90 days)
            scoreId: 1,
            nonce: cm.nonces(borrower),
            expiry: uint64(block.timestamp + 1 hours)
        });
        bytes memory sig = _sign(t, underwriterPk);
        vm.startPrank(borrower);
        weth.approve(address(cm), type(uint256).max);
        vm.expectRevert(CreditManager.TermTooLong.selector);
        cm.borrow(t, sig, 10_000e18, 5e18);
        vm.stopPrank();
    }

    function test_LtvBps_NoTruncationOnSmallLoan() public view {
        // A tiny loan against 1 wei of collateral must read as maxed-out LTV, NOT 0% (the old
        // premature-division truncation let small loans bypass the LTV cap entirely).
        assertEq(cm.ltvBps(1e9, 1), type(uint16).max);
        // The normal case is unchanged: $10k loan / $5k collateral = 200% LTV.
        assertEq(cm.ltvBps(10_000e18, 2.5e18), 20_000);
    }

    // --- repay -------------------------------------------------------------

    function test_Repay_ReturnsCollateral_AccruesInterest_BumpsReputation() public {
        uint256 loanId = _openUnderCollateralizedLoan();

        vm.warp(block.timestamp + 30 days);
        uint256 owed = cm.amountOwed(loanId);
        uint256 interest = owed - 10_000e18;
        assertGt(interest, 0);

        usd.mint(borrower, interest); // borrower funds the interest
        vm.startPrank(borrower);
        usd.approve(address(cm), owed);
        cm.repay(loanId);
        vm.stopPrank();

        CreditManager.Loan memory loan = cm.getLoan(loanId);
        assertEq(uint8(loan.status), uint8(CreditManager.LoanStatus.Repaid));
        assertEq(weth.balanceOf(borrower), 10e18); // collateral fully returned
        assertEq(pool.totalOutstanding(), 0);
        assertApproxEqAbs(pool.totalAssets(), POOL_SEED + interest, 1);

        IReputationRegistry.Profile memory p = reputation.getProfile(borrower);
        assertEq(p.loansRepaid, 1);
        assertEq(p.totalRepaid, 10_000e18);
    }

    // --- default / liquidation --------------------------------------------

    function test_Liquidate_RevertsBeforeDuePlusGrace() public {
        uint256 loanId = _openUnderCollateralizedLoan();
        vm.warp(block.timestamp + 30 days); // due but still within grace
        vm.expectRevert(CreditManager.NotDueYet.selector);
        cm.liquidate(loanId);
    }

    function test_Liquidate_SeizesCollateral_SocialisesLoss_DropsReputation() public {
        uint256 loanId = _openUnderCollateralizedLoan();
        vm.warp(block.timestamp + 30 days + 1 days + 1); // past due + grace

        cm.liquidate(loanId); // callable by anyone

        CreditManager.Loan memory loan = cm.getLoan(loanId);
        assertEq(uint8(loan.status), uint8(CreditManager.LoanStatus.Defaulted));
        assertEq(weth.balanceOf(treasury), 2.5e18); // collateral seized
        assertEq(pool.totalOutstanding(), 0);
        assertEq(pool.totalAssets(), POOL_SEED - 10_000e18); // lenders bear the loss

        IReputationRegistry.Profile memory p = reputation.getProfile(borrower);
        assertEq(p.loansDefaulted, 1);
        assertEq(p.totalDefaulted, 10_000e18);
    }
}
