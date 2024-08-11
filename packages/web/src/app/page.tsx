import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export default async function Home() {
  const session = await getServerSession(authOptions);
  console.log('session', session);

  if (!session) {
    redirect('/login');
  } else {
    return <main>hello world</main>;
  }
}
