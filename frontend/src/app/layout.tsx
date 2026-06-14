import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "N.E.R.D. Workspace",
  description: "Ncademi Edtech Research & Data Migration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
