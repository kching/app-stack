/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXTAUTH_SECRET: '3.141592654',
    NEXTAUTH_URL: 'http://localhost:3030'
  }
};

export default nextConfig;
