import NavItem from './NavItem';
import React, { PropsWithChildren, useCallback, useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { NavItemAttributes } from './NavItem';
import { omit } from 'lodash';

export type NavGroupAttributes = {
  label?: string;
  items: NavItemAttributes[];
  selectedItem?: string;
};

type NavGroupProps = NavGroupAttributes & {
  onItemSelection: (item: NavItemAttributes) => void;
  onGroupSelection?: (group: NavGroupAttributes) => void;
};

type CollapsibleDecoratorProps = PropsWithChildren<{
  label: string;
  expanded?: boolean;
  onChange?: (open: boolean) => void;
}>;
const CollapsibleDecorator = ({ children, label, expanded, onChange }: CollapsibleDecoratorProps) => {
  const [isOpen, setIsOpen] = useState<boolean>(expanded === true);
  const handleOpenChange = useCallback(
    () => (open: boolean) => {
      setIsOpen(open);
      if (open && typeof onChange === 'function') {
        onChange(open);
      }
    },
    [setIsOpen, onChange]
  );

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange()} className="space-y-2">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="px-4 py-2 h-9 w-full justify-start">
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

const NavGroup = (props: NavGroupProps) => {
  const { label, items, selectedItem, onItemSelection, onGroupSelection } = props;
  const expandable = useMemo(() => label != null && label.trim().length > 0, [label]);
  const expanded = items.find((item) => item.id === selectedItem) != null;
  const itemList = useMemo(() => {
    return (
      <ul>
        {items.map((item) => (
          <NavItem key={item.id} {...item} selected={item.id === selectedItem} onClick={onItemSelection} />
        ))}
      </ul>
    );
  }, [items]);

  const navGroupAttributes = omit(props, 'onItemSelection', 'onGroupSelection');
  const changeHandler = onGroupSelection
    ? (open: boolean) => {
        if (open) {
          onGroupSelection(navGroupAttributes);
        }
      }
    : undefined;
  return (
    <div>
      {expandable && label ? (
        <CollapsibleDecorator label={label} expanded={expanded} onChange={changeHandler}>
          {itemList}
        </CollapsibleDecorator>
      ) : (
        <div>{itemList}</div>
      )}
    </div>
  );
};

export default NavGroup;
