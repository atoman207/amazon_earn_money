import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright", "playwright-core"],
  images: {
    // 割引一覧のサムネイル。Amazon の画像配信ホストだけを許可する。
    remotePatterns: [
      { protocol: "https", hostname: "**.media-amazon.com" },
      { protocol: "https", hostname: "**.ssl-images-amazon.com" },
    ],
  },
};

export default nextConfig;
