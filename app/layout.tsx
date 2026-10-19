import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veenix",
  description: "Renovation project management — leads to final payment, one system.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
