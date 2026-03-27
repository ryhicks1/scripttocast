import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Script To Cast — AI-Powered Casting Setup",
  description: "Upload your casting documents. Get roles, self-tape instructions, job forms, and more in seconds. Built for Casting Networks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} antialiased`}>
      <body className="min-h-screen">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
