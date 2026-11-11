/** The page header every page shares: the app's logo, its name, and where to go next. */
export function SiteHeader({ current }: { current: 'home' | 'status' | 'other' }) {
  return (
    <header className="site-header">
      <a className="site-brand" href="/">
        <img src="/app-icon-192.png" alt="" width="36" height="36" />
        VTT Chat
      </a>
      <nav className="site-nav" aria-label="Site">
        <a href="/" aria-current={current === 'home' ? 'page' : undefined}>
          Home
        </a>
        <a href="/status" aria-current={current === 'status' ? 'page' : undefined}>
          Status
        </a>
      </nav>
    </header>
  );
}
