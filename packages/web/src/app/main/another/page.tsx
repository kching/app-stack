'use client';
import { usePageContext } from '@/components/workspace/PageStateProvider';
import { useEffect } from 'react';

export default function Component() {
  const { setState } = usePageContext();
  useEffect(() => {
    setState('title', 'Another Page');
  }, []);

  return <p>Another page content</p>;
}
