import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

const TITLE = "Tastecraft · the taste data team for independent restaurants";
const DESCRIPTION =
  "An AI agent that reads Qloo's taste graph around your restaurant and turns it into menu moves, events, local marketing and a supplier shopping list, with the evidence behind every call.";

export const metadata: Metadata = {
  metadataBase: new URL("https://tastecraft-xi.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  // Link previews (Devpost, Slack, social): the home page's hero, rendered from the app itself.
  openGraph: {
    type: "website",
    siteName: "Tastecraft",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Tastecraft home page: Know what your neighborhood is hungry for." }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
