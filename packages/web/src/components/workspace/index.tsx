import React, { PropsWithChildren } from 'react';
import { NavGroupAttributes } from '@/components/workspace/NavGroup';
import Navigator, { MobileNav } from '@/components/workspace/Navigator';
import HeaderBar from '@/components/workspace/HeaderBar';
import PageStateProvider from '@/components/workspace/PageStateProvider';
import { SessionProvider } from 'next-auth/react';

type WorkspaceProps = PropsWithChildren<{
  navGroups: NavGroupAttributes[];
}>;

const Workspace = ({ navGroups, children }: WorkspaceProps) => {
  return (
    <div className="flex h-full">
      <div>
        <div className="flex items-center h-10 m-2">
          <MobileNav navGroups={navGroups} />
        </div>
        <div className="overflow-y-auto">
          <Navigator className="hidden md:block px-2 min-w-[160px]" navGroups={navGroups} />
        </div>
      </div>
      <PageStateProvider>
        <div className="flex-grow">
          <HeaderBar />
          <div className="overflow-y-auto">{children}</div>
        </div>
      </PageStateProvider>
    </div>
  );
};

export default Workspace;
