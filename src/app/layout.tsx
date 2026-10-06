import type { Metadata } from "next";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import "./workspace.css";
import "./application.css";

export const metadata: Metadata = { title: { default: "Lattice — Good answers have good roots.", template: "%s · Lattice" }, description: "Customer support grounded in your knowledge. Understand the source, improve the answer, and publish with confidence." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-scroll-behavior="smooth"><body><a href="#main-content" className="skip-link">Skip to content</a>{children}</body></html>;
}
