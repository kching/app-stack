'use client';
import { usePageContext } from '@/components/workspace/PageStateProvider';
import { useEffect } from 'react';

export default function Page() {
  const { setState } = usePageContext();
  useEffect(() => {
    setState('title', 'Some page title');
  }, []);

  return <p>Some page content</p>;
}
