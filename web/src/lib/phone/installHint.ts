export type InstallHintKind = 'ios' | 'android';

/**
 * Which "add this to your home screen" hint to show, if any. Only on a phone or tablet in a browser tab: once
 * the web app is running from the home screen (`standalone`) there is nothing to tell. iPadOS can claim to be a
 * Mac, so a Mac with a touch screen counts as an iPad. Desktops get nothing: they have the real app.
 */
export function installHintKind(
  userAgent: string,
  maxTouchPoints: number,
  standalone: boolean,
): InstallHintKind | undefined {
  if (standalone) return undefined;
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/android/i.test(userAgent)) return 'android';
  return undefined;
}

/** What to do, in the words of each system's own menus. */
export const INSTALL_HINT_TEXT: Record<InstallHintKind, string> = {
  ios: 'Keep VTT Chat on your home screen: tap Share, then Add to Home Screen.',
  android: 'Keep VTT Chat on your home screen: open the browser menu, then Add to Home screen.',
};

/** Whether this page is already running as an installed web app. */
export function isStandalone(): boolean {
  try {
    return (
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    );
  } catch {
    return false;
  }
}
