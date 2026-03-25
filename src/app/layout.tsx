import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Script To Cast — AI-Powered Casting Setup",
  description: "Upload your casting documents. Get roles, self-tape instructions, job forms, and more in seconds.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} antialiased`}>
      <body className="min-h-screen bg-[#0A0B0F] text-[#E8E3D8]">{children}</body>
    </html>
  );
}
