import React, { PropsWithChildren } from 'react';
import { NavGroupProps } from '@/components/workspace/NavGroup';
import Navigator from '@/components/workspace/Navigator';

type WorkspaceProps = PropsWithChildren<{
  navGroups: NavGroupProps[];
}>;

const Workspace = ({ navGroups, children }: WorkspaceProps) => {
  return (
    <div className="flex h-full">
      <div className="p-1 min-w-[225px]">
        <Navigator navGroups={navGroups} />
      </div>
      <div className="flex-grow">{children}</div>
    </div>
  );
};

export default Workspace;
