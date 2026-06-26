// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IReputationRegistry } from "./interfaces/IReputationRegistry.sol";

/// @notice On-chain credit bureau. Only authorized recorders (the CreditManager) may write history.
///         The derived score is intentionally simple and fully transparent: it is the borrower's
///         repayment rate over closed loans, scaled to 0..1000. The AI underwriter consumes the raw
///         profile plus cross-chain signals for the richer off-chain score; this on-chain score backs
///         the safety gate / fallback and the reputation flywheel.
contract ReputationRegistry is IReputationRegistry, Ownable {
    error NotRecorder();

    uint16 internal constant MAX_SCORE = 1000;

    mapping(address borrower => Profile) private _profiles;
    mapping(address account => bool) private _recorders;

    constructor() Ownable(msg.sender) { }

    modifier onlyRecorder() {
        if (!_recorders[msg.sender]) revert NotRecorder();
        _;
    }

    function setRecorder(address recorder, bool allowed) external onlyOwner {
        _recorders[recorder] = allowed;
        emit RecorderSet(recorder, allowed);
    }

    function isRecorder(address account) external view returns (bool) {
        return _recorders[account];
    }

    function recordLoanIssued(address borrower, uint256 principal) external onlyRecorder {
        Profile storage p = _profiles[borrower];
        p.loansIssued += 1;
        p.totalBorrowed += principal;
        emit LoanIssued(borrower, principal);
    }

    function recordRepayment(address borrower, uint256 principalRepaid) external onlyRecorder {
        Profile storage p = _profiles[borrower];
        p.loansRepaid += 1;
        p.totalRepaid += principalRepaid;
        emit Repayment(borrower, principalRepaid);
    }

    function recordDefault(address borrower, uint256 principalDefaulted) external onlyRecorder {
        Profile storage p = _profiles[borrower];
        p.loansDefaulted += 1;
        p.totalDefaulted += principalDefaulted;
        emit Default(borrower, principalDefaulted);
    }

    function getProfile(address borrower) external view returns (Profile memory) {
        return _profiles[borrower];
    }

    function onChainScore(address borrower) external view returns (uint16 score, bool hasHistory) {
        Profile storage p = _profiles[borrower];
        uint256 closed = uint256(p.loansRepaid) + uint256(p.loansDefaulted);
        if (closed == 0) return (0, false);
        // repayment rate over closed loans, scaled to 0..1000
        score = uint16((uint256(p.loansRepaid) * MAX_SCORE) / closed);
        hasHistory = true;
    }
}
