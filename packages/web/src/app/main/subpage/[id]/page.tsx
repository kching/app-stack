'use client';
import { usePageContext } from '@/components/workspace/PageStateProvider';
import { useEffect } from 'react';

export default function Page({ params }: { params: { id: string } }) {
  const { setState } = usePageContext();
  useEffect(() => {
    setState('title', `Sub page ${params.id}`);
  }, []);

  return <p>Some page content</p>;
}
