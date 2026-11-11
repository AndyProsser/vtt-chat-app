import type { ReactNode } from 'react';

/**
 * A picture across the top of a card, darkened toward the bottom so the caption stays readable in both
 * light and dark mode. Decorative: the picture has no alt text and the caption carries the meaning.
 */
export function Banner({
  children,
  size = 'small',
  src,
  srcSet,
  video,
}: {
  src: string;
  srcSet?: string;
  /** A muted looping clip drawn over the picture; the picture shows until it plays, or always if absent. */
  video?: string | undefined;
  size?: 'small' | 'hero';
  children?: ReactNode;
}) {
  return (
    <div className={`banner banner-${size}`}>
      <img src={src} srcSet={srcSet} sizes="(min-width: 560px) 520px, 100vw" alt="" />
      {video && <video src={video} poster={src} autoPlay muted loop playsInline aria-hidden />}
      {children && <div className="banner-caption">{children}</div>}
    </div>
  );
}
