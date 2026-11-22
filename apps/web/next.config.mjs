/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @relay/types ships TypeScript source (no build step), so Next must compile it.
  transpilePackages: ['@relay/types'],
};

export default nextConfig;
