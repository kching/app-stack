'use client';

import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import React, { PropsWithChildren, useCallback, useState } from 'react';
import { LoginFormProps } from '@/app/login/LoginForm';

type LoginStatusProps = {
  successUrl: string;
  loginForm: React.FC<LoginFormProps>;
};
const LoginStatus = ({ successUrl, loginForm }: LoginStatusProps) => {
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  const onLoginSuccess = useCallback(() => {
    router.push(successUrl);
    router.refresh();
  }, [successUrl]);

  const onLoginFailed = useCallback(() => {
    setStatus('failed');
  }, [setStatus]);

  return (
    <div className="w-full flex flex-col justify-center items-center">
      {status === 'failed' && (
        <div className="w-full px-4 md:px-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Login failed</AlertTitle>
            <AlertDescription>Invalid username or password.</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="w-full space-y-2">{loginForm({ onLoginSuccess, onLoginFailed })}</div>
    </div>
  );
};

export default LoginStatus;
