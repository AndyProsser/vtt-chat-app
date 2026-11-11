import { APP_SCHEME } from '../consts/index.js';

/** `vtt-chat://connect?server=<origin>&code=ABCD-2345` — opens the app and redeems the code. */
export function connectLink(server: string, code: string): string {
  return `${APP_SCHEME}://connect?server=${encodeURIComponent(server)}&code=${encodeURIComponent(code)}`;
}
