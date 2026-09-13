/**
 * Stand-in for `next/image` inside server-free fixtures.
 *
 * The real component reads `process.env.__NEXT_IMAGE_OPTS` at module load
 * and wants the image optimiser behind it; neither exists in a file://
 * fixture, and the first import threw `process is not defined` before any
 * fixture code ran. A picture in a fixture only ever needs to be a picture.
 */
export default function Image({
  src,
  alt,
  width,
  height,
  fill,
  style,
  ...rest
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string | { src: string };
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
}) {
  const url = typeof src === "string" ? src : src.src;
  // The optimiser's own props mean nothing to an <img>.
  const attrs: Record<string, unknown> = { ...rest };
  delete attrs.priority;
  delete attrs.unoptimized;
  delete attrs.sizes;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt ?? ""}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      style={
        fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style
      }
      {...attrs}
    />
  );
}
