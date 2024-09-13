'use client';

import React, { HTMLAttributes, useMemo, useState } from 'react';
import NavGroup, { NavGroupAttributes } from './NavGroup';
import { usePathname, useRouter } from 'next/navigation';
import { NavItemAttributes } from './NavItem';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { MenuIcon } from 'lucide-react';

type NavigatorProps = HTMLAttributes<HTMLElement> & {
  navGroups: NavGroupAttributes[];
  selectedItem?: string;
  onChange?: (selected: NavItemAttributes) => boolean;
};
const Navigator = ({ className, selectedItem, navGroups, onChange }: NavigatorProps) => {
  const router = useRouter();
  const pathName = usePathname();
  const selectedItemId = useMemo(() => {
    if (selectedItem) {
      return selectedItem;
    } else {
      const items = navGroups.reduce((items, group) => items.concat(group.items), [] as NavItemAttributes[]);
      return items.find((item) => item.url === pathName)?.id;
    }
  }, [pathName, selectedItem, navGroups]);
  const handleSelection = (selectedItem: NavItemAttributes) => {
    if (typeof onChange !== 'function' || onChange(selectedItem)) {
      router.push(selectedItem.url);
      router.refresh();
    }
  };
  return (
    <nav className={`${className}`}>
      {navGroups.map((group, index) => (
        <NavGroup key={index} {...group} selectedItem={selectedItemId} onSelection={handleSelection} />
      ))}
    </nav>
  );
};

export const MobileNav = (props: NavigatorProps) => {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="md:hidden px-2" variant="ghost">
          <MenuIcon className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetTitle className="hidden">Navigation</SheetTitle>
        <SheetDescription className="hidden">Navigation</SheetDescription>
        <Navigator
          {...props}
          onChange={() => {
            setOpen(false);
            return true;
          }}
        />
      </SheetContent>
    </Sheet>
  );
};

export default Navigator;
