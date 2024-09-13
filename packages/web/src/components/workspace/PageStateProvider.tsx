'use client';
import { createContext, PropsWithChildren, useContext, useState } from 'react';
import { produce } from 'immer';

type PageState = {
  title: string;
};
const PageStateContext = createContext({
  state: { title: '' },
  setState: (attribute: keyof PageState, value: any) => {},
});

const defaultState: PageState = {
  title: '',
};

const PageStateProvider = ({ children }: PropsWithChildren<{}>) => {
  const [state, updatePageState] = useState<PageState>(defaultState);
  const value = {
    state,
    setState: (attribute: keyof PageState, value: any) => {
      updatePageState(
        produce(state, (draft) => {
          draft[attribute] = value;
        })
      );
    },
  };

  return <PageStateContext.Provider value={value}>{children}</PageStateContext.Provider>;
};

export const usePageContext = () => useContext(PageStateContext);

export default PageStateProvider;
