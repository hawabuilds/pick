/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "pbs.twimg.com" }],
  },
  webpack: (config) => {
    // Privy, WalletConnect and wagmi's connector barrel reference integrations
    // we do not ship (Farcaster mini-apps, Solana, React Native storage,
    // MetaMask's SDK connector, wagmi's Tempo connectors). They are optional
    // peers, so resolving them to false keeps the bundle honest instead of
    // pulling in unused SDKs.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
      "@react-native-async-storage/async-storage": false,
      "@metamask/connect-evm": false,
      accounts: false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // ox (via viem's chain list, via Privy) builds a dynamic import expression
    // for its Tempo worker pool. Nothing we call reaches it.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /ox[\\/]_esm[\\/]tempo/ },
    ];
    return config;
  },
};

export default nextConfig;
