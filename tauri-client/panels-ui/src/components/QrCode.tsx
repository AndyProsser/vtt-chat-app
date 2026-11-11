import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/**
 * A QR code from the library's own SVG output (nothing else is ever injected). The CSS keeps it
 * black on white in both themes: a recoloured or inverted code will not scan.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let current = true;
    QRCode.toString(text, {
      type: 'svg',
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(
      (out) => {
        if (current) setSvg(out);
      },
      () => {
        if (current) setSvg('');
      },
    );
    return () => {
      current = false;
    };
  }, [text]);

  return (
    <div
      className="vtt-qr"
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
