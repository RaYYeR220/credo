/**
 * Credo contract addresses per chain. Populated after deploy by copying the address set from
 * contracts/deployments/<chainId>.json. Until then entries are null and the app runs in
 * demo-preview mode (the approved statement renders with sample data).
 */
export interface CredoDeployment {
  chainId: number;
  underwriter: `0x${string}`;
  treasury: `0x${string}`;
  mUSD: `0x${string}`;
  mETH: `0x${string}`;
  priceOracle: `0x${string}`;
  reputationRegistry: `0x${string}`;
  lendingPool: `0x${string}`;
  creditManager: `0x${string}`;
}

export const DEPLOYMENTS: Record<number, CredoDeployment | null> = {
  133: {
    chainId: 133,
    underwriter: "0x6F0C56A19A958CD53279C3Ac91272925Dc651a34",
    treasury: "0x99375054F10Bd5854bFa850E1a422f4d0D540f07",
    mUSD: "0xb41B55D151bbE430b690cdFbf2a0A9D439b22a54",
    mETH: "0xA171845394a84D70907c46A8De89AA6457d0b2b6",
    priceOracle: "0x5109Df34Ee13E0BdF72276D035CfC94A598317A6",
    reputationRegistry: "0xf8D2759A0740f34a67F59d472C3d06a2824D947c",
    lendingPool: "0xE7466dd955329203bcB996bA89Da8882E2cAB263",
    creditManager: "0x0F61C9021B9c9a9bAFe7d2a3792bCCE6e0C78c30",
  },
  177: {
    chainId: 177,
    underwriter: "0x6F0C56A19A958CD53279C3Ac91272925Dc651a34",
    treasury: "0x99375054F10Bd5854bFa850E1a422f4d0D540f07",
    mUSD: "0x154B7BD77477e4C2CE41038109faBdf66BBa25Da",
    mETH: "0xb3E4b67E9D1E2F106A49caEaDe778e3511535789",
    priceOracle: "0x9B38a447FB9cb6B269C65e978f64F5bb20D52f42",
    reputationRegistry: "0x8B748073483920B02c2421943f6a7304cb620eBe",
    lendingPool: "0x4f2A080Cf4bEb800205BA48F532293A55805f73c",
    creditManager: "0x793181d83B9648Ba8A4520E8256D37754FdFadc8",
  },
};

export function getDeployment(chainId: number): CredoDeployment | null {
  return DEPLOYMENTS[chainId] ?? null;
}
