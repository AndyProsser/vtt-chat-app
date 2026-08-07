// Vite inlines `import.meta.env.VITE_*` at build time — see DEVELOPING.md's "Optional: Dedicated
// Dev VM" section for how to point a build at a non-localhost backend
// (`VITE_BACKEND_SESSION_URL=http://<your-vm-host>:4000/api/session npm run build`).
export const BACKEND_SESSION_URL =
  (import.meta.env.VITE_BACKEND_SESSION_URL as string | undefined) ??
  'http://localhost:4000/api/session';
