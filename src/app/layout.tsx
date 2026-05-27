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
    url: "https://poe2-market-dashboard.vercel.app",
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
