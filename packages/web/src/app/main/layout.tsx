import React from 'react';
import { getServerSession } from 'next-auth';
import authOptions from '@/app/api/auth/[...nextauth]/authOptions';
import { redirect } from 'next/navigation';

export default async function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession<typeof authOptions>(authOptions);
  if (session) {
    console.log('Auth session', session);
  } else {
    redirect('/login');
  }

  return children;
}
