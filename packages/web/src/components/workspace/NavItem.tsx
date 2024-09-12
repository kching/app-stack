import React, { useCallback, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export type NavItemProps = {
  id: string;
  label: string;
  url: string;
  selected?: boolean;
};
const NavItem = ({ label, url, selected }: NavItemProps) => {
  const router = useRouter();
  const pathName = usePathname();
  const clickHandler = useCallback(() => {
    router.push(url);
    router.refresh();
  }, [router, url]);

  return (
    <li>
      <Button className="w-full justify-start" variant="ghost" onClick={clickHandler}>
        <span className={selected ? 'font-bold' : ''}>{label}</span>
      </Button>
    </li>
  );
};

export default NavItem;
