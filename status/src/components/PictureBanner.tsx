import type { ReactNode } from 'react';

/** A picture across the top of the page with a caption over a darkening gradient (decorative). */
export function PictureBanner({ src, children }: { src: string; children?: ReactNode }) {
  return (
    <div className="banner">
      <img src={src} alt="" />
      {children && <div className="banner-caption">{children}</div>}
    </div>
  );
}
