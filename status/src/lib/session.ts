/**
 * Whether this browser is signed in, for the one thing the status page needs it for: showing the Download and
 * Chat links. The session is an HttpOnly cookie script cannot read, so the answer comes from the server
 * (`GET /api/auth/me`, same origin, the cookie rides along). That call also slides the cookie's expiry.
 * A network failure or any non-200 counts as "not signed in": the links just stay hidden.
 */
export async function checkSignedIn(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<boolean> {
  try {
    const response = await fetchImpl('/api/auth/me', {
      credentials: 'same-origin',
      headers: { 'X-VTT-Client': 'web' },
    });
    return response.ok;
  } catch {
    return false;
  }
}
