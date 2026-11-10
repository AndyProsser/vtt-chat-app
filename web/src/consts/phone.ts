export const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'handouts', label: 'Handouts' },
  { id: 'history', label: 'History' },
] as const;

export const SIGN_IN_MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password don’t match.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  invalid_token: 'That code isn’t valid. Ask for a new one.',
};
