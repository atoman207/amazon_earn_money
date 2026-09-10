import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const STUB_ID = "\0server-only-stub";

/**
 * "server-only" は Next.js がビルド時に解決する仮想モジュールで、
 * node_modules には存在しない。テストでは空モジュールに差し替える。
 */
function serverOnlyStub() {
  return {
    name: "server-only-stub",
    resolveId(source: string) {
      return source === "server-only" ? STUB_ID : null;
    },
    load(id: string) {
      return id === STUB_ID ? "export {};" : null;
    },
  };
}

export default defineConfig({
  plugins: [serverOnlyStub()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
