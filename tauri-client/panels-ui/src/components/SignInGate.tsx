import { AccountSection } from './settings/AccountSection.js';

/**
 * What the main window shows until the player is signed in to a campaign: the sign-in form, the
 * campaign picker, or the "nothing to join yet" note — the same account section Settings has.
 */
export function SignInGate() {
  return (
    <div className="vtt-main">
      <header className="vtt-top">
        <b className="vtt-head">VTT Chat</b>
      </header>
      <div className="vtt-gate">
        <AccountSection />
      </div>
    </div>
  );
}
