import NavItem from './NavItem';
import React, { PropsWithChildren, useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { NavItemProps } from './NavItem';

export type NavGroupProps = {
  label?: string;
  items: NavItemProps[];
  selectedItem?: string;
};

type CollapsibleDecoratorProps = PropsWithChildren<{ label: string }>;
const CollapsibleDecorator = ({ children, label }: CollapsibleDecoratorProps) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="px-4 w-full justify-start">
          <h4 className="text-sm">
            <span>{label}</span>
          </h4>
          <span className="ml-1">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
};

const NavGroup = ({ label, items, selectedItem }: NavGroupProps) => {
  const expandable = useMemo(() => label != null && label.trim().length > 0, [label]);
  const itemList = useMemo(() => {
    return (
      <ul>
        {items.map((item) => (
          <NavItem key={item.id} {...item} selected={item.id === selectedItem} />
        ))}
      </ul>
    );
  }, [items]);

  return (
    <div>
      {expandable && label ? (
        <CollapsibleDecorator label={label}> {itemList}</CollapsibleDecorator>
      ) : (
        <div>{itemList}</div>
      )}
    </div>
  );
};

export default NavGroup;
