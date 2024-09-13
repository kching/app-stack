import NavItem from './NavItem';
import React, { PropsWithChildren, useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { NavItemAttributes } from './NavItem';

export type NavGroupAttributes = {
  label?: string;
  items: NavItemAttributes[];
  selectedItem?: string;
};

type NavGroupProps = NavGroupAttributes & {
  onSelection: (item: NavItemAttributes) => void;
};

type CollapsibleDecoratorProps = PropsWithChildren<{ label: string; expanded?: boolean }>;
const CollapsibleDecorator = ({ children, label, expanded }: CollapsibleDecoratorProps) => {
  const [isOpen, setIsOpen] = useState<boolean>(expanded === true);
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
      <CollapsibleContent>
        <div className="pl-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const NavGroup = ({ label, items, selectedItem, onSelection }: NavGroupProps) => {
  const expandable = useMemo(() => label != null && label.trim().length > 0, [label]);
  const expanded = items.find((item) => item.id === selectedItem) != null;
  const itemList = useMemo(() => {
    return (
      <ul>
        {items.map((item) => (
          <NavItem key={item.id} {...item} selected={item.id === selectedItem} onClick={onSelection} />
        ))}
      </ul>
    );
  }, [items]);

  return (
    <div>
      {expandable && label ? (
        <CollapsibleDecorator label={label} expanded={expanded}>
          {itemList}
        </CollapsibleDecorator>
      ) : (
        <div>{itemList}</div>
      )}
    </div>
  );
};

export default NavGroup;
