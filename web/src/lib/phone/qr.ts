import QRCode from 'qrcode';

/** A QR code for a link, as a PNG data address (dark on white, so any camera reads it in light or dark mode). */
export const qrDataUrl = (text: string, size = 240): Promise<string> =>
  QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#150f24', light: '#ffffff' },
  });
