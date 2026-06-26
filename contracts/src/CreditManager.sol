// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import { ILendingPool } from "./interfaces/ILendingPool.sol";
import { IReputationRegistry } from "./interfaces/IReputationRegistry.sol";
import { IPriceOracle } from "./interfaces/IPriceOracle.sol";

/// @notice Credo core. The AI underwriter signs an off-chain risk assessment (LoanTerms); this
///         contract verifies the signature and enforces hard on-chain caps before issuing an
///         under-collateralized loan from the LendingPool. The AI *advises within bounds* — the
///         contract decides. Handles repayment (interest -> lenders, reputation up) and default
///         (collateral seized, loss socialised, reputation down).
contract CreditManager is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // --- errors ------------------------------------------------------------
    error BadSignature();
    error Expired();
    error WrongBorrower();
    error BadNonce();
    error PrincipalTooHigh();
    error LtvTooHigh();
    error InterestTooHigh();
    error TermTooLong();
    error ZeroAmount();
    error ZeroAddress();
    error NotActive();
    error NotDueYet();

    // --- types -------------------------------------------------------------
    enum LoanStatus {
        None,
        Active,
        Repaid,
        Defaulted
    }

    /// @dev The AI underwriter's signed assessment. `maxLtvBps` = loan/collateral ceiling for this
    ///      borrower (>10000 means under-collateralized). Bounded on-chain by protocol caps.
    struct LoanTerms {
        address borrower;
        uint256 maxPrincipal; // loan-asset units
        uint16 maxLtvBps; // loan value / collateral value, in bps
        uint16 interestRateBps; // APR, bps
        uint64 termSeconds;
        uint256 scoreId; // off-chain score reference (for the rationale)
        uint256 nonce; // anti-replay, must equal nonces[borrower]
        uint64 expiry; // attestation expiry (unix)
    }

    struct Loan {
        address borrower;
        uint256 principal;
        uint256 collateralAmount;
        uint16 interestRateBps;
        uint64 startTime;
        uint64 dueTime;
        LoanStatus status;
    }

    // --- constants ---------------------------------------------------------
    uint256 internal constant BPS = 10_000;
    uint256 internal constant SECONDS_PER_YEAR = 365 days;

    bytes32 public constant LOAN_TERMS_TYPEHASH = keccak256(
        "LoanTerms(address borrower,uint256 maxPrincipal,uint16 maxLtvBps,uint16 interestRateBps,uint64 termSeconds,uint256 scoreId,uint256 nonce,uint64 expiry)"
    );

    // --- immutable wiring --------------------------------------------------
    ILendingPool public immutable pool;
    IReputationRegistry public immutable reputation;
    IPriceOracle public immutable oracle;
    IERC20 public immutable loanAsset;
    IERC20 public immutable collateralToken;
    uint8 internal immutable loanDecimals;
    uint8 internal immutable collateralDecimals;

    // --- config (bounded AI authority) ------------------------------------
    address public underwriter;
    uint256 public perLoanCap;
    uint16 public protocolMaxLtvBps;
    uint16 public maxInterestRateBps;
    uint64 public maxTermSeconds;
    uint64 public gracePeriod;
    address public treasury;

    // --- state -------------------------------------------------------------
    Loan[] internal loans;
    mapping(address borrower => uint256) public nonces;

    // --- events ------------------------------------------------------------
    event LoanOpened(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 collateralAmount,
        uint16 ltvBps,
        uint16 interestRateBps,
        uint64 dueTime
    );
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 interest);
    event LoanDefaulted(
        uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 collateralSeized
    );
    event UnderwriterSet(address indexed underwriter);
    event CapsSet(
        uint256 perLoanCap,
        uint16 protocolMaxLtvBps,
        uint16 maxInterestRateBps,
        uint64 maxTermSeconds,
        uint64 gracePeriod
    );
    event TreasurySet(address indexed treasury);

    constructor(
        ILendingPool pool_,
        IReputationRegistry reputation_,
        IPriceOracle oracle_,
        IERC20 collateralToken_,
        address underwriter_
    ) Ownable(msg.sender) EIP712("Credo", "1") {
        pool = pool_;
        reputation = reputation_;
        oracle = oracle_;
        loanAsset = IERC20(pool_.asset());
        collateralToken = collateralToken_;
        loanDecimals = IERC20Metadata(pool_.asset()).decimals();
        collateralDecimals = IERC20Metadata(address(collateralToken_)).decimals();

        underwriter = underwriter_;
        // caps start at 0 (borrowing disabled) until the owner configures them via setCaps()
        treasury = msg.sender;
    }

    // --- admin -------------------------------------------------------------
    function setUnderwriter(address underwriter_) external onlyOwner {
        if (underwriter_ == address(0)) revert ZeroAddress();
        underwriter = underwriter_;
        emit UnderwriterSet(underwriter_);
    }

    function setCaps(
        uint256 perLoanCap_,
        uint16 protocolMaxLtvBps_,
        uint16 maxInterestRateBps_,
        uint64 maxTermSeconds_,
        uint64 grace_
    ) external onlyOwner {
        perLoanCap = perLoanCap_;
        protocolMaxLtvBps = protocolMaxLtvBps_;
        maxInterestRateBps = maxInterestRateBps_;
        maxTermSeconds = maxTermSeconds_;
        gracePeriod = grace_;
        emit CapsSet(perLoanCap_, protocolMaxLtvBps_, maxInterestRateBps_, maxTermSeconds_, grace_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    // --- core --------------------------------------------------------------

    /// @notice Open an under-collateralized loan using the AI underwriter's signed assessment.
    ///         The signature authorizes the *bounds*; this function enforces every protocol cap
    ///         on top, so the AI can never push the protocol past its hard limits.
    function borrow(LoanTerms calldata terms, bytes calldata signature, uint256 principal, uint256 collateralAmount)
        external
        nonReentrant
        returns (uint256 loanId)
    {
        // 1. authentic assessment from the authorized underwriter
        if (ECDSA.recover(hashLoanTerms(terms), signature) != underwriter) revert BadSignature();
        // 2. not stale
        if (block.timestamp > terms.expiry) revert Expired();
        // 3. only the assessed borrower
        if (msg.sender != terms.borrower) revert WrongBorrower();
        // 4. anti-replay
        if (terms.nonce != nonces[msg.sender]) revert BadNonce();
        // 5-7. bounded AI authority: attested terms must sit within protocol ceilings
        if (terms.interestRateBps > maxInterestRateBps) revert InterestTooHigh();
        if (terms.maxLtvBps > protocolMaxLtvBps) revert LtvTooHigh();
        if (terms.termSeconds == 0 || terms.termSeconds > maxTermSeconds) revert TermTooLong();
        // 8. sane amounts
        if (principal == 0 || collateralAmount == 0) revert ZeroAmount();
        // 8. principal within attested max AND protocol per-loan cap
        if (principal > terms.maxPrincipal || principal > perLoanCap) revert PrincipalTooHigh();
        // 9. realized LTV within what the AI attested
        uint16 realizedLtv = ltvBps(principal, collateralAmount);
        if (realizedLtv > terms.maxLtvBps) revert LtvTooHigh();

        // effects
        nonces[msg.sender] += 1;
        uint64 dueTime = uint64(block.timestamp) + terms.termSeconds;
        loanId = loans.length;
        loans.push(
            Loan({
                borrower: msg.sender,
                principal: principal,
                collateralAmount: collateralAmount,
                interestRateBps: terms.interestRateBps,
                startTime: uint64(block.timestamp),
                dueTime: dueTime,
                status: LoanStatus.Active
            })
        );

        // interactions
        collateralToken.safeTransferFrom(msg.sender, address(this), collateralAmount);
        pool.lend(msg.sender, principal);
        reputation.recordLoanIssued(msg.sender, principal);

        emit LoanOpened(
            loanId, msg.sender, principal, collateralAmount, realizedLtv, terms.interestRateBps, dueTime
        );
    }

    /// @notice Repay principal + accrued interest; collateral is returned and reputation improves.
    function repay(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert NotActive();

        uint256 principal = loan.principal;
        uint256 interest = accruedInterest(loanId);
        address borrower_ = loan.borrower;
        uint256 collateral = loan.collateralAmount;

        loan.status = LoanStatus.Repaid;

        loanAsset.safeTransferFrom(msg.sender, address(this), principal + interest);
        loanAsset.forceApprove(address(pool), principal + interest);
        pool.repay(principal, interest);

        collateralToken.safeTransfer(borrower_, collateral);
        reputation.recordRepayment(borrower_, principal);

        emit LoanRepaid(loanId, borrower_, principal, interest);
    }

    /// @notice After the term + grace elapse without repayment: seize collateral, socialise the
    ///         principal loss to lenders, and record the default against the borrower's reputation.
    function liquidate(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert NotActive();
        if (block.timestamp <= uint256(loan.dueTime) + gracePeriod) revert NotDueYet();

        uint256 principal = loan.principal;
        uint256 collateral = loan.collateralAmount;
        address borrower_ = loan.borrower;

        loan.status = LoanStatus.Defaulted;

        pool.recordLoss(principal);
        collateralToken.safeTransfer(treasury, collateral);
        reputation.recordDefault(borrower_, principal);

        emit LoanDefaulted(loanId, borrower_, principal, collateral);
    }

    // --- views -------------------------------------------------------------

    function hashLoanTerms(LoanTerms calldata terms) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LOAN_TERMS_TYPEHASH,
                    terms.borrower,
                    terms.maxPrincipal,
                    terms.maxLtvBps,
                    terms.interestRateBps,
                    terms.termSeconds,
                    terms.scoreId,
                    terms.nonce,
                    terms.expiry
                )
            )
        );
    }

    /// @return loan value / collateral value in bps (>10000 == under-collateralized). Uint16-capped.
    function ltvBps(uint256 principal, uint256 collateralAmount) public view returns (uint16) {
        if (collateralAmount == 0) return type(uint16).max;
        uint256 loanPrice = oracle.priceUsd(address(loanAsset));
        uint256 collPrice = oracle.priceUsd(address(collateralToken));
        // bps = loanValueUsd * BPS / collateralValueUsd, expanded so we never divide before the
        // ratio (a premature `value / 10**decimals` truncates small loans to 0 and bypasses the cap):
        //   = principal * loanPrice * 10**collDec * BPS / (collateralAmount * collPrice * 10**loanDec)
        uint256 denom = collateralAmount * collPrice * (10 ** loanDecimals);
        if (denom == 0) return type(uint16).max;
        uint256 bps = (principal * loanPrice * (10 ** collateralDecimals) * BPS) / denom;
        return bps > type(uint16).max ? type(uint16).max : uint16(bps);
    }

    function accruedInterest(uint256 loanId) public view returns (uint256) {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) return 0;
        uint256 elapsed = block.timestamp - loan.startTime;
        return (loan.principal * loan.interestRateBps * elapsed) / (uint256(BPS) * SECONDS_PER_YEAR);
    }

    function amountOwed(uint256 loanId) public view returns (uint256) {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) return 0;
        return loan.principal + accruedInterest(loanId);
    }

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    function loansCount() external view returns (uint256) {
        return loans.length;
    }
}
