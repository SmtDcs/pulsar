import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulsar — instant moves, on-chain settle",
  description:
    "Millisecond game moves off-chain, final result settled on Stellar Testnet. Trusted-sequencer prototype.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
