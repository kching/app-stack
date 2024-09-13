'use client';

import React, { useMemo } from 'react';
import { signOut } from 'next-auth/react';
import { usePageContext } from '@/components/workspace/PageStateProvider';
import { Button } from '@/components/ui/button';
import { PowerIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';

const HeaderBar = () => {
  const router = useRouter();
  const theme = useTheme();
  const { resolvedTheme, setTheme } = theme;
  const { state } = usePageContext();
  const title = useMemo(() => state.title, [state]);
  return (
    <div className="m-2 ml-0 flex justify-between items-center flex-grow">
      <h2 className="text-lg font-bold">{title}</h2>
      <span>
        <Button
          variant="ghost"
          className="px-2"
          onClick={() => {
            setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
          }}
        >
          <SunIcon className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <MoonIcon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
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
