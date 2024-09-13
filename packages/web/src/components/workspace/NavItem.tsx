import React, { useCallback } from 'react';
import { Button } from '@/components/ui/button';

export type NavItemAttributes = {
  id: string;
  label: string;
  url: string;
};
type NavItemProps = NavItemAttributes & {
  onClick: (item: NavItemAttributes) => void;
  selected?: boolean;
};
const NavItem = ({ id, label, url, selected, onClick }: NavItemProps) => {
  const clickHandler = () => {
    if (typeof onClick === 'function') {
      onClick({ id, label, url });
    }
  };

  return (
    <li>
      <Button className="w-full justify-start" variant="ghost" onClick={clickHandler}>
        <span className={selected ? 'font-bold' : ''}>{label}</span>
      </Button>
    </li>
  );
};

export default NavItem;
