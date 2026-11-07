//! Whether the microphone is open: the player's own mute **and** the consent gate.
//!
//! Two independent things can close the mic. The player's mute is theirs to flip any time. The
//! consent gate is the app's: while a start cue is playing for a recording in progress, this
//! player's audio must not be captured (CLAUDE.md §8.4), whatever their mute button says. Audio
//! flows only if neither holds it closed, and releasing one must never open the other.

use std::sync::atomic::{AtomicBool, Ordering};

/// The one rule: closed if either side wants it closed.
pub fn effective_mute(user_muted: bool, gate_held: bool) -> bool {
    user_muted || gate_held
}

/// Both inputs, shared between the hotkey/button path and the consent coordinator.
#[derive(Debug)]
pub struct MicGate {
    user_muted: AtomicBool,
    gate_held: AtomicBool,
}

impl Default for MicGate {
    /// The app starts muted (CLAUDE.md §8.1: capture device released) with the gate open.
    fn default() -> Self {
        Self {
            user_muted: AtomicBool::new(true),
            gate_held: AtomicBool::new(false),
        }
    }
}

impl MicGate {
    /// Records the player's mute choice and returns whether the mic should now be closed.
    pub fn set_user_muted(&self, muted: bool) -> bool {
        self.user_muted.store(muted, Ordering::SeqCst);
        self.effective()
    }

    /// Records the consent gate and returns whether the mic should now be closed.
    pub fn set_gate(&self, held: bool) -> bool {
        self.gate_held.store(held, Ordering::SeqCst);
        self.effective()
    }

    pub fn user_muted(&self) -> bool {
        self.user_muted.load(Ordering::SeqCst)
    }

    pub fn gate_held(&self) -> bool {
        self.gate_held.load(Ordering::SeqCst)
    }

    pub fn effective(&self) -> bool {
        effective_mute(self.user_muted(), self.gate_held())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closed_if_either_side_closes_it() {
        assert!(effective_mute(true, false));
        assert!(effective_mute(false, true));
        assert!(effective_mute(true, true));
        assert!(!effective_mute(false, false));
    }

    #[test]
    fn starts_muted_with_the_gate_open() {
        let gate = MicGate::default();
        assert!(gate.user_muted());
        assert!(!gate.gate_held());
        assert!(gate.effective());
    }

    #[test]
    fn unmuting_cannot_open_a_held_gate() {
        let gate = MicGate::default();
        gate.set_gate(true);
        assert!(
            gate.set_user_muted(false),
            "the consent gate still holds the mic closed"
        );
    }

    #[test]
    fn releasing_the_gate_cannot_unmute_a_muted_player() {
        let gate = MicGate::default();
        gate.set_user_muted(true);
        gate.set_gate(true);
        assert!(gate.set_gate(false), "the player is still muted");
    }

    #[test]
    fn open_only_when_unmuted_and_gate_released() {
        let gate = MicGate::default();
        gate.set_user_muted(false);
        gate.set_gate(true);
        assert!(!gate.set_gate(false));
    }
}
