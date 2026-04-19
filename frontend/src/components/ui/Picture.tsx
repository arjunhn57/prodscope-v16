import { forwardRef } from "react";

interface PictureProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
}

function swapExt(src: string, ext: string): string {
  const dot = src.lastIndexOf(".");
  if (dot < 0) return src;
  return src.slice(0, dot) + ext;
}

function isLocalRaster(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("http")) return false;
  const lower = src.toLowerCase();
  return lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg");
}

export const Picture = forwardRef<HTMLImageElement, PictureProps>(
  ({ src, alt, width, height, priority, className, style, loading, decoding, ...rest }, ref) => {
    const supported = isLocalRaster(src);
    const finalLoading = loading ?? (priority ? "eager" : "lazy");
    const finalDecoding = decoding ?? (priority ? "sync" : "async");

    if (!supported) {
      return (
        <img
          ref={ref}
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={finalLoading}
          decoding={finalDecoding}
          className={className}
          style={style}
          {...rest}
        />
      );
    }

    const avif = swapExt(src, ".avif");
    const webp = swapExt(src, ".webp");

    return (
      <picture>
        <source srcSet={avif} type="image/avif" />
        <source srcSet={webp} type="image/webp" />
        <img
          ref={ref}
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={finalLoading}
          decoding={finalDecoding}
          className={className}
          style={style}
          {...rest}
        />
      </picture>
    );
  }
);

Picture.displayName = "Picture";
