import CredentialsProvider from 'next-auth/providers/credentials';
import { cookies } from 'next/headers';
import { JWT } from 'next-auth/jwt';
import { Session as NextAuthSession, AuthOptions, User } from 'next-auth';

export type Session = NextAuthSession & {
  user?: AuthUser;
};

// interface User extends AdapterOptions.

interface AuthUser extends User {
  accessToken?: string;
}

const authOptions: AuthOptions = {
  pages: {
    signIn: '/login',
  },

  providers: [
    CredentialsProvider({
      // The name to display on the sign in form (e.g. 'Sign in with...')
      name: 'Credentials',
      // The credentials is used to generate a suitable form on the sign in page.
      // You can specify whatever fields you are expecting to be submitted.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        // You need to provide your own logic here that takes the credentials
        // submitted and returns either a object representing a user or value
        // that is false/null if the credentials are invalid.
        // e.g. return { id: 1, name: 'J Smith', email: 'jsmith@example.com' }
        // You can also use the `req` object to obtain additional parameters
        // (i.e., the request IP address)
        try {
          const authResponse = await fetch('http://localhost:3000/api/login', {
            method: 'POST',
            body: JSON.stringify(credentials),
            headers: { 'Content-Type': 'application/json' },
          });
          const user = await authResponse.json();

          // If no error and we have user data, return it
          if (authResponse.ok && user) {
            cookies().set({
              name: 'accessToken',
              value: user.accessToken,
              httpOnly: true,
              maxAge: 3600 * 24,
              path: '/',
              sameSite: 'strict',
              secure: true,
            });
            return {
              id: user.uid,
              name: user.displayName,
              email: user.email,
              accessToken: user.accessToken,
            };
          }
        } catch (error) {}

        // Return null if user data could not be retrieved
        return null;
      },
    }),
  ],

  callbacks: {
    async session({ session, token }: { session: NextAuthSession; token: JWT; user: User }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub!,
          accessToken: token.accessToken,
        },
      };
    },
    async jwt({ token, user }: { token: JWT; user: AuthUser }) {
      if (user) {
        token.sub = user.id;
        token.name = user.name;
        token.email = user.email;
        token.accessToken = user.accessToken;
      }
      return token;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      else if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },
};

export default authOptions;
