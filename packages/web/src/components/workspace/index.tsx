import React, { PropsWithChildren } from 'react';
import { NavGroupProps } from '@/components/workspace/NavGroup';
import Navigator from '@/components/workspace/Navigator';

type WorkspaceProps = PropsWithChildren<{
  navGroups: NavGroupProps[];
}>;

const Workspace = ({ navGroups, children }: WorkspaceProps) => {
  return (
    <div className="flex h-full">
      <div>
        <Navigator className="p-2 min-w-[160px]" navGroups={navGroups} />
      </div>
      <div className="flex-grow">{children}</div>
    </div>
  );
};

export default Workspace;
