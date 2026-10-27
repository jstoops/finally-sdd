import type { Metadata } from "next";
import "./globals.css";

// System font stacks only: a Google-hosted font loader would download fonts during
// `next build`, a network dependency inside Docker.
export const metadata: Metadata = {
  title: "FinAlly — AI Trading Workstation",
  description: "Streaming prices, a simulated portfolio and an AI trading copilot.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="bg-bg text-text font-sans antialiased">{children}</body>
    </html>
  );
}
