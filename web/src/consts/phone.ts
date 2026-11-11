export const TABS = [
  { id: 'chat', icon: 'chat', label: 'Chat' },
  { id: 'sessions', icon: 'sessions', label: 'Sessions' },
  { id: 'handouts', icon: 'handouts', label: 'Handouts' },
  { id: 'history', icon: 'history', label: 'History' },
] as const;

export const SIGN_IN_MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password don’t match.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  invalid_token: 'That code isn’t valid. Ask for a new one.',
};
