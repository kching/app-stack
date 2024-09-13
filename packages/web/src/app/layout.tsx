import type { Metadata, Viewport } from 'next';
import Head from 'next/head';
import { Inter } from 'next/font/google';
import './globals.css';
import React from 'react';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/ThemeProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Create Next App',
  description: 'Generated by create next app',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1.0,
  minimumScale: 1.0,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full overflow-hidden" suppressHydrationWarning>
      <body className={`h-full w-full overflow-hidden ${inter.className}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <main className="h-full">{children}</main>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
