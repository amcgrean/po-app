/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Permissions-Policy',
            value: 'camera=*, microphone=()',
          },
        ],
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: ['@aws-sdk/client-s3'],
    serverActions: {
      bodySizeLimit: '12mb',
    },
  },
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === 'edge') {
      // Exclude Node.js-only packages that use __dirname or native bindings,
      // which are unavailable in the Edge runtime.
      config.resolve.alias = {
        ...config.resolve.alias,
        ws: false,
        bufferutil: false,
        'utf-8-validate': false,
      }
    }
    return config
  },
}

export default nextConfig
