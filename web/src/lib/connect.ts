import { APP_SCHEME } from '../consts/index.js';

/**
 * `vtt-chat://connect?server=<origin>&code=<secret>` — opens the app and redeems the secret: the long link
 * token, or (older servers) the short code. Nobody types a deep link, so it carries the unguessable one.
 */
export function connectLink(server: string, secret: string): string {
  return `${APP_SCHEME}://connect?server=${encodeURIComponent(server)}&code=${encodeURIComponent(secret)}`;
}
