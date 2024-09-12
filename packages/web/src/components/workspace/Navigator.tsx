'use client';

import React, { HTMLAttributes, useMemo } from 'react';
import NavGroup, { NavGroupProps } from './NavGroup';
import { usePathname } from 'next/navigation';
import { NavItemProps } from './NavItem';

type NavigatorProps = HTMLAttributes<HTMLElement> & {
  navGroups: NavGroupProps[];
  selectedItem?: string;
};
const Navigator = ({ selectedItem, navGroups }: NavigatorProps) => {
  const pathName = usePathname();
  const selectedItemId = useMemo(() => {
    if (selectedItem) {
      return selectedItem;
    } else {
      const items = navGroups.reduce((items, group) => items.concat(group.items), [] as NavItemProps[]);
      return items.find((item) => item.url === pathName)?.id;
    }
  }, [pathName, selectedItem, navGroups]);
  return (
    <nav className="space-y-4">
      {navGroups.map((group, index) => (
        <NavGroup key={index} {...group} selectedItem={selectedItemId} />
      ))}
    </nav>
  );
};

export default Navigator;
