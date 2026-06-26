// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ClientShell from "@/app/components/ClientShell";
import OfflineOverlay from "@/app/components/OfflineOverlay";
import { Providers } from "@/app/components/Providers";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  // Use environment variables only, no server-side fetch during build
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "Prime Study";
  const ownerName = process.env.NEXT_PUBLIC_OWNER_USERNAME || "Owner";
  const ownerUrl = `https://t.me/${(process.env.NEXT_PUBLIC_OWNER_USERNAME || "VS_ONHUNT").replace('@', '')}`;

  return {
    title: appName,
    description: `${appName} ~ Learn, Code, Grow`,
    manifest: "/manifest.json",
    authors: [
      { name: ownerName, url: ownerUrl },
    ],
    creator: appName,
    icons: {
      icon: "/favicon.ico",
      apple: "/logo.png",
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Don't fetch server info on the server - let client handle it
  // This avoids server-side MongoDB connection issues during initial render
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`}>
        <Providers>
          <OfflineOverlay />
          <ClientShell>{children}</ClientShell>
        </Providers>
      </body>
    </html>
  );
}
