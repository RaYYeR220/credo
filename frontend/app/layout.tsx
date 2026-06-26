import type { Metadata } from "next";
import { Zilla_Slab, Spectral, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const zilla = Zilla_Slab({
  variable: "--font-zilla",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Credo — AI Credit Underwriting on HashKey Chain",
  description:
    "AI credit underwriting for under-collateralized lending on HashKey Chain. Transparent on-chain scoring; the smart contract enforces every cap.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${zilla.variable} ${spectral.variable} ${plexMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
