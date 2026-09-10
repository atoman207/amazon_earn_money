/**
 * "server-only" は Next.js がビルド時に解決する仮想モジュールで、node_modules には無い。
 * スキャンは tsx（素の Node）で走るため、そのままだと
 * `Cannot find module 'server-only'` で起動直後に落ちる。
 *
 * scripts/tsconfig.scan.json の paths でこの空モジュールへ差し替える。
 * アプリ本体（next build）は従来どおり本物のガードを使う。
 * テストでは vitest.config.mts が同じ役割のスタブを当てている。
 */
export {};
