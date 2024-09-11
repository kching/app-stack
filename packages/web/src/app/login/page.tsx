import { redirect } from 'next/navigation';
import LoginForm from './LoginForm';
import { getServerSession } from 'next-auth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import React from 'react';
import LoginStatus from '@/app/login/LoginStatus';

type PageProps = {
  searchParams: { [key: string]: string };
};
export default async function LoginPage({ searchParams }: PageProps) {
  const session = await getServerSession();

  if (session) {
    redirect('/main');
  }

  return (
    <section className="h-screen flex flex-col items-center justify-center">
      <div className="w-[600px]">
        <LoginStatus successUrl="/main" loginForm={LoginForm} />
      </div>
    </section>
  );
}
