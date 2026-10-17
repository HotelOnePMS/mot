import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { VoiceDock } from "@/components/voice/VoiceDock";
import { PRODUCT_NAME, PRODUCT_DESCRIPTION } from "@/config/product";
import { BRAND_HEX } from "@/components/brand/colors";
import { siteUrl } from "@/components/brand/site-url";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Display serif for headlines (marketing, booking sites, confirmations) and the wordmark.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["opsz", "SOFT"],
});

const DEFAULT_TITLE = `${PRODUCT_NAME} — Direct booking and an AI front desk for hotels`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: DEFAULT_TITLE,
    template: `%s · ${PRODUCT_NAME}`,
  },
  description: PRODUCT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  keywords: ["hotel booking website", "direct booking", "AI front desk", "hotel voice agent", "channel manager", "independent hotels"],
  creator: PRODUCT_NAME,
  publisher: PRODUCT_NAME,
  // Title and description are left out on purpose: Next fills og:/twitter:
  // title and description from each page's own metadata.
  openGraph: {
    type: "website",
    siteName: PRODUCT_NAME,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
  appleWebApp: {
    title: PRODUCT_NAME,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // Public pages always render light (only the console follows the theme), so one colour.
  themeColor: BRAND_HEX.background,
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${display.variable} bg-background font-sans text-foreground antialiased`}>
        {/* Pages put id="main" on their <main> landmark. */}
        <a
          href="#main"
          className="sr-only z-[100] rounded-lg bg-primary text-sm font-medium text-primary-foreground shadow-lifted focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:px-4 focus:py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Skip to content
        </a>
        <Providers>
          {/* One voice for the whole guest site: mounted here so a call survives page changes (hotel → checkout → booking). */}
          <VoiceDock>{children}</VoiceDock>
        </Providers>
      </body>
    </html>
  );
}
