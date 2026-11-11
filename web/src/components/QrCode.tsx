import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** The QR is the library's own SVG output; colours come from CSS so it follows light/dark. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let current = true;
    QRCode.toString(text, { type: 'svg', margin: 1 }).then(
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
      className="qr-code"
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
