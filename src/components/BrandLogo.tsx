/** サイトのロゴ。文字入りの amazon_logo.png をそのまま出す。 */
export function BrandLogo({
  height = 48,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  return (
    // 静的アセット。横長のロゴなので高さだけ指定し、幅は比率に任せる
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/amazon_logo.png"
      alt="価格差自動検知システム"
      height={height}
      className={`w-auto max-w-full shrink-0 object-contain object-left ${className}`}
      style={{ height }}
    />
  );
}
