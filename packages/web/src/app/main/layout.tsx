import React, { PropsWithChildren } from 'react';
import { getServerSession } from 'next-auth';
import authOptions from '@/app/api/auth/[...nextauth]/authOptions';
import { redirect } from 'next/navigation';
import Workspace from '@/components/workspace';
import { NavGroupProps } from '@/components/workspace/NavGroup';

const navGroups: NavGroupProps[] = [
  {
    label: '',
    items: [
      {
        id: '1',
        label: 'Page 1',
        url: '/main',
      },
      {
        id: '2',
        label: 'Page 2',
        url: '/page2',
      },
      {
        id: '3',
        label: 'Page 3',
        url: '/page3',
      },
    ],
  },
  {
    label: 'rawr2',
    items: [
      {
        id: '1',
        label: 'Page 1',
        url: '/main',
      },
      {
        id: '2',
        label: 'Page 2',
        url: '/page2',
      },
      {
        id: '3',
        label: 'Page 3',
        url: '/page3',
      },
    ],
  },
];

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
