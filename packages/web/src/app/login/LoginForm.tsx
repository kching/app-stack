'use client';

import { signIn } from 'next-auth/react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { SignInResponse } from 'next-auth/react';

const FormSchema = z.object({
  username: z.string().trim().min(1, {
    message: 'Please enter your username',
  }),
  password: z.string().min(1, {
    message: 'PLease enter your password',
  }),
});

type FormData = z.infer<typeof FormSchema>;

export type LoginFormProps = {
  onLoginSuccess: () => void;
  onLoginFailed: (response: SignInResponse | Error) => void;
};

export default function LoginForm({ onLoginSuccess, onLoginFailed }: LoginFormProps) {
  const form = useForm({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  });

  const onSubmit = async (data: FormData) => {
    const { username, password } = data;

    try {
      const response = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });
      if (response?.ok && !response?.error) {
        onLoginSuccess();
      } else {
        onLoginFailed(response!);
      }
    } catch (error: any) {
      onLoginFailed(error as unknown as Error);
    }
  };

  return (
    <div className="w-full space-y-6">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="p-4 md:p-8 flex flex-col items-center justify-center gap-y-6"
        >
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem className="w-full">
                <FormLabel>Username</FormLabel>
                <FormControl>
                  <Input className="text-black" {...field} type="text" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="w-full">
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input className="text-black" {...field} type="password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex flex-row-reverse justify-center">
            <Button type="submit" className="hover:scale-110 hover:bg-cyan-700" disabled={form.formState.isSubmitting}>
              Login
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
