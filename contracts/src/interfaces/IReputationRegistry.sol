// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice On-chain credit bureau for Credo borrowers. Stores raw repayment history and
///         exposes a transparent derived score used by the safety gate and the reputation flywheel.
interface IReputationRegistry {
    struct Profile {
        uint64 loansIssued;
        uint64 loansRepaid;
        uint64 loansDefaulted;
        uint256 totalBorrowed; // cumulative principal, loan-asset units
        uint256 totalRepaid; // cumulative principal repaid
        uint256 totalDefaulted; // cumulative principal lost to defaults
    }

    event LoanIssued(address indexed borrower, uint256 principal);
    event Repayment(address indexed borrower, uint256 principalRepaid);
    event Default(address indexed borrower, uint256 principalDefaulted);
    event RecorderSet(address indexed recorder, bool allowed);

    function recordLoanIssued(address borrower, uint256 principal) external;
    function recordRepayment(address borrower, uint256 principalRepaid) external;
    function recordDefault(address borrower, uint256 principalDefaulted) external;

    function getProfile(address borrower) external view returns (Profile memory);

    /// @return score 0..1000 transparent on-chain repayment score.
    /// @return hasHistory false when the borrower has no closed (repaid/defaulted) loans yet.
    function onChainScore(address borrower) external view returns (uint16 score, bool hasHistory);
}
