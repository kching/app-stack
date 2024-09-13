'use client';

import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="mx-2 my-4">
      <div className="flex justify-between">
        <h1 className="text-lg ml-4">Sample App</h1>
        <div>
          <Button asChild>
            <Link href="/main">Login</Link>
          </Button>
        </div>
      </div>
      <div className="m-4">
        <p>Hello world! This is a public landing page to a sample application.</p>
        <p>
          Click
          <Button asChild variant="link" className="ml-1 p-0">
            <Link href="/main"> here</Link>
          </Button>{' '}
          to proceed.
        </p>
      </div>
    </div>
  );
}
