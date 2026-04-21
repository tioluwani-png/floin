import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/layout/ServiceWorker";
import { StoreHydration } from "@/components/layout/StoreHydration";
import { AuthProvider } from "@/components/layout/AuthProvider";
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
  title: "Floin — Know your numbers. Keep moving.",
  description:
    "The financial tracker built for African business owners. Log sales, track expenses, generate reports automatically.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Floin",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#10b981",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <StoreHydration>
          <AuthProvider>
            {children}
          </AuthProvider>
        </StoreHydration>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
