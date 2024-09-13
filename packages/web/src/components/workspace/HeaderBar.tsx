'use client';

import React, { useMemo } from 'react';
import { signOut } from 'next-auth/react';
import { usePageContext } from '@/components/workspace/PageStateProvider';
import { Button } from '@/components/ui/button';
import { PowerIcon, SettingsIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';

const HeaderBar = () => {
  const router = useRouter();
  const { state } = usePageContext();
  const title = useMemo(() => state.title, [state]);
  return (
    <div className="m-2 ml-0 flex justify-between items-center flex-grow">
      <h2 className="text-lg font-bold">{title}</h2>
      <span>
        <Button variant="ghost" className="px-2">
          <SettingsIcon className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            const data = await signOut({ redirect: false, callbackUrl: '/' });
            router.push(data.url);
            router.refresh();
          }}
          className="text-primary px-2"
        >
          <PowerIcon className="h-5 w-5" />
        </Button>
      </span>
    </div>
  );
};

export default HeaderBar;
