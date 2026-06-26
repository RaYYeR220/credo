// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MockPriceOracle } from "../src/mocks/MockPriceOracle.sol";
import { ReputationRegistry } from "../src/ReputationRegistry.sol";
import { LendingPool } from "../src/LendingPool.sol";
import { CreditManager } from "../src/CreditManager.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys the full Credo stack and wires roles + caps + demo liquidity.
///
/// Env:
///   PRIVATE_KEY          deployer key (also pool owner / admin)
///   UNDERWRITER_ADDRESS  AI underwriter signer (defaults to deployer if unset)
///   TREASURY_ADDRESS     where seized collateral goes (defaults to deployer)
///
/// Run (testnet):
///   forge script script/Deploy.s.sol --rpc-url hsk_testnet --broadcast
contract Deploy is Script {
    // Demo parameters
    uint16 internal constant MAX_UTILIZATION_BPS = 8000; // pool lends <=80% of assets
    uint256 internal constant PER_LOAN_CAP = 50_000e18; // max single loan (mUSD)
    uint16 internal constant PROTOCOL_MAX_LTV_BPS = 30_000; // loan up to 300% of collateral
    uint16 internal constant MAX_INTEREST_BPS = 10_000; // 100% APR ceiling
    uint64 internal constant MAX_TERM_SECONDS = 90 days; // bounded-AI: max loan term
    uint64 internal constant GRACE_PERIOD = 3 days;

    uint256 internal constant USD_PRICE = 1e8; // $1
    uint256 internal constant ETH_PRICE = 2000e8; // $2000

    uint256 internal constant POOL_SEED = 1_000_000e18; // demo lender liquidity
    uint256 internal constant DEMO_COLLATERAL = 1000e18; // mETH minted to deployer for demos

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address underwriter = vm.envOr("UNDERWRITER_ADDRESS", deployer);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);

        vm.startBroadcast(pk);

        // 1. Tokens + oracle (demo fixtures; mintable mocks)
        MockERC20 usd = new MockERC20("Credo Mock USD", "mUSD", 18);
        MockERC20 weth = new MockERC20("Credo Mock ETH", "mETH", 18);
        MockPriceOracle oracle = new MockPriceOracle();
        oracle.setPrice(address(usd), USD_PRICE);
        oracle.setPrice(address(weth), ETH_PRICE);

        // 2. Core protocol
        ReputationRegistry reputation = new ReputationRegistry();
        LendingPool pool = new LendingPool(IERC20(address(usd)), "Credo LP Share", "cLP", MAX_UTILIZATION_BPS);
        CreditManager cm =
            new CreditManager(pool, reputation, oracle, IERC20(address(weth)), underwriter);

        // 3. Wiring + bounded-AI caps
        pool.setCreditManager(address(cm));
        reputation.setRecorder(address(cm), true);
        cm.setCaps(PER_LOAN_CAP, PROTOCOL_MAX_LTV_BPS, MAX_INTEREST_BPS, MAX_TERM_SECONDS, GRACE_PERIOD);
        cm.setTreasury(treasury);

        // 4. Seed demo liquidity + collateral (mocks, no real capital)
        usd.mint(deployer, POOL_SEED);
        usd.approve(address(pool), POOL_SEED);
        pool.deposit(POOL_SEED, deployer);
        weth.mint(deployer, DEMO_COLLATERAL);

        vm.stopBroadcast();

        _report(deployer, underwriter, treasury, usd, weth, oracle, reputation, pool, cm);
    }

    function _report(
        address deployer,
        address underwriter,
        address treasury,
        MockERC20 usd,
        MockERC20 weth,
        MockPriceOracle oracle,
        ReputationRegistry reputation,
        LendingPool pool,
        CreditManager cm
    ) internal {
        console2.log("=== Credo deployment (chainid %s) ===", block.chainid);
        console2.log("deployer        ", deployer);
        console2.log("underwriter     ", underwriter);
        console2.log("treasury        ", treasury);
        console2.log("mUSD (loan)     ", address(usd));
        console2.log("mETH (collat.)  ", address(weth));
        console2.log("PriceOracle     ", address(oracle));
        console2.log("ReputationReg   ", address(reputation));
        console2.log("LendingPool     ", address(pool));
        console2.log("CreditManager   ", address(cm));

        string memory key = "credo";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "underwriter", underwriter);
        vm.serializeAddress(key, "treasury", treasury);
        vm.serializeAddress(key, "mUSD", address(usd));
        vm.serializeAddress(key, "mETH", address(weth));
        vm.serializeAddress(key, "priceOracle", address(oracle));
        vm.serializeAddress(key, "reputationRegistry", address(reputation));
        vm.serializeAddress(key, "lendingPool", address(pool));
        string memory json = vm.serializeAddress(key, "creditManager", address(cm));

        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
