import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ---------------------------------------------------------------------------
// Suppress benign React 19 "script tag" warnings from Next.js route prefetching.
// Next.js 16 injects <script> tags for route prefetching during render, which
// triggers React 19's warning: "Encountered a script tag while rendering
// React component". These are harmless and expected behavior — not a bug.
// See: https://github.com/vercel/next.js/issues/72213
//
// Fix 5.2: Restricted to development mode only. In production, all errors
// should be visible for debugging. Also made the filter more targeted.
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV === 'development' && typeof window !== "undefined") {
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const message = typeof args[0] === "string" ? args[0] : "";
    if (message.includes("Encountered a script tag while rendering React component")) {
      return; // Suppress known benign warning
    }
    if (message.includes("act(")) {
      return; // Suppress React act() warnings in dev
    }
    originalConsoleError.apply(console, args);
  };
}

export const metadata: Metadata = {
  title: {
    default: "PoE2 Market Dashboard — Real-time Prices & Exchange Rates",
    template: "%s | PoE2 Market Dashboard",
  },
  description:
    "Monitor Path of Exile 2 market prices, unique items, currency exchange rates, and arbitrage opportunities in real-time. Track price history, set alerts, and compare items.",
  keywords: [
    "Path of Exile 2",
    "PoE2",
    "market",
    "prices",
    "currency",
    "exchange",
    "arbitrage",
    "trading",
    "unique items",
    "Divine Orb",
    "Chaos Orb",
  ],
  authors: [{ name: "PoE2 Market Dashboard" }],
  creator: "PoE2 Market Dashboard",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://poe2-market-dashboard.vercel.app",
    title: "PoE2 Market Dashboard",
    description:
      "Real-time Path of Exile 2 market tracker. Monitor prices, exchange rates, and find arbitrage opportunities.",
    siteName: "PoE2 Market Dashboard",
  },
  twitter: {
    card: "summary_large_image",
    title: "PoE2 Market Dashboard",
    description:
      "Real-time Path of Exile 2 market tracker with price alerts and arbitrage detection.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PoE2 Market",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#8b5cf6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        {/* Skip-to-content link for a11y (WCAG 2.1 AA) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-semibold"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
