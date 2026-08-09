import type { Metadata, Viewport } from "next";
import "./globals.css";
import TabBar from "@/components/TabBar";

export const metadata: Metadata = {
  title: "Coach",
  description: "Personal AI health & fitness coach",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Coach" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0f14",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <div className="mx-auto max-w-md min-h-dvh pb-24">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
