import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trao — Interview Prep Kit",
  description: "Research-backed interview preparation, shaped around the role you want.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
