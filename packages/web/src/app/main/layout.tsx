import React from 'react';
import { getServerSession } from 'next-auth';
import authOptions from '@/app/api/auth/[...nextauth]/authOptions';
import { redirect } from 'next/navigation';
import Workspace from '@/components/workspace';
import { NavGroupAttributes } from '@/components/workspace/NavGroup';
import pages from './pages.json';

const navGroups: NavGroupAttributes[] = (pages as NavGroupAttributes[]).map((group) => ({
  ...group,
  items: group.items.map((item) => ({ ...item, id: item.id ?? item.url })),
}));

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

  return <Workspace navGroups={navGroups}>{children}</Workspace>;
}
