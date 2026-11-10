//! The player's status: Online, Away or Offline. It is a single switch for voice and the microphone:
//! Offline leaves voice, Online joins it, Away keeps the player in the room with the microphone closed
//! (and opens it again on return if it was open before). Chat and the live session are not affected.
//!
//! This file is the pure decision logic, so every rule is testable without a window or a sound card;
//! `status_commands.rs` carries the effects out.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Online,
    Away,
    /// Where every launch starts: the app never joins voice by itself.
    #[default]
    Offline,
}

/// What the caller must do to make the world match a status change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    ConnectVoice,
    DisconnectVoice,
    SetMuted(bool),
}

/// What the machine needs to know about the player right now.
#[derive(Debug, Clone, Copy)]
pub struct Context {
    pub user_muted: bool,
    pub in_voice: bool,
}

#[derive(Debug, Default)]
pub struct StatusModel {
    status: Status,
    /// Away was set by the idle timer or the screen lock, so coming back may undo it by itself.
    automatic_away: bool,
    /// The microphone was open when Away began; it is reopened when the player returns.
    reopen_on_return: bool,
}

impl Status {
    /// The word sent to the server and the panels.
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Online => "online",
            Status::Away => "away",
            Status::Offline => "offline",
        }
    }
}

impl StatusModel {
    pub fn status(&self) -> Status {
        self.status
    }

    /// Moves to `target`. `automatic` marks Away chosen by the idle timer or screen lock.
    pub fn set(&mut self, target: Status, ctx: Context, automatic: bool) -> Vec<Effect> {
        let from = self.status;
        if from == target {
            return Vec::new();
        }
        self.status = target;
        self.automatic_away = automatic && target == Status::Away;
        let mut effects = Vec::new();
        match target {
            Status::Offline => {
                self.reopen_on_return = false;
                if ctx.in_voice {
                    effects.push(Effect::DisconnectVoice);
                }
            }
            Status::Online => {
                if !ctx.in_voice {
                    effects.push(Effect::ConnectVoice);
                }
                if from == Status::Away && self.reopen_on_return {
                    effects.push(Effect::SetMuted(false));
                }
                self.reopen_on_return = false;
            }
            Status::Away => {
                if !ctx.in_voice {
                    effects.push(Effect::ConnectVoice);
                }
                if from == Status::Online {
                    self.reopen_on_return = !ctx.user_muted;
                }
                if !ctx.user_muted {
                    effects.push(Effect::SetMuted(true));
                }
            }
        }
        effects
    }

    /// The player is active again (input after idle, screen unlocked): ends an automatic Away only.
    pub fn activity(&mut self, ctx: Context) -> Vec<Effect> {
        if self.status == Status::Away && self.automatic_away {
            self.set(Status::Online, ctx, false)
        } else {
            Vec::new()
        }
    }

    /// The player unmutes by hand. While Away that means they are back; the status becomes Online and the
    /// microphone opens. Returns `None` when the mute should simply be applied as usual.
    pub fn unmute(&mut self) -> Option<Effect> {
        if self.status == Status::Away {
            self.status = Status::Online;
            self.automatic_away = false;
            self.reopen_on_return = false;
            Some(Effect::SetMuted(false))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIVE: Context = Context {
        user_muted: false,
        in_voice: true,
    };
    const MUTED: Context = Context {
        user_muted: true,
        in_voice: true,
    };
    const NOT_IN_VOICE: Context = Context {
        user_muted: true,
        in_voice: false,
    };

    #[test]
    fn every_launch_starts_offline_and_does_not_join_voice() {
        assert_eq!(StatusModel::default().status(), Status::Offline);
    }

    #[test]
    fn online_joins_voice_and_offline_leaves_it() {
        let mut m = StatusModel::default();
        assert_eq!(
            m.set(Status::Online, NOT_IN_VOICE, false),
            vec![Effect::ConnectVoice]
        );
        assert_eq!(
            m.set(Status::Offline, MUTED, false),
            vec![Effect::DisconnectVoice]
        );
        assert!(m.set(Status::Offline, NOT_IN_VOICE, false).is_empty());
    }

    #[test]
    fn away_closes_an_open_microphone_and_online_reopens_it() {
        let mut m = StatusModel::default();
        m.set(Status::Online, NOT_IN_VOICE, false);
        assert_eq!(
            m.set(Status::Away, LIVE, false),
            vec![Effect::SetMuted(true)]
        );
        assert_eq!(
            m.set(Status::Online, MUTED, false),
            vec![Effect::SetMuted(false)]
        );
    }

    #[test]
    fn a_microphone_that_was_already_muted_stays_muted_through_away() {
        let mut m = StatusModel::default();
        m.set(Status::Online, NOT_IN_VOICE, false);
        assert!(m.set(Status::Away, MUTED, false).is_empty());
        assert!(m.set(Status::Online, MUTED, false).is_empty());
    }

    #[test]
    fn going_offline_from_away_forgets_the_old_microphone_state() {
        let mut m = StatusModel::default();
        m.set(Status::Online, NOT_IN_VOICE, false);
        m.set(Status::Away, LIVE, false);
        m.set(Status::Offline, MUTED, false);
        let join = m.set(Status::Online, NOT_IN_VOICE, false);
        assert_eq!(join, vec![Effect::ConnectVoice], "no surprise unmute");
    }

    #[test]
    fn away_from_offline_joins_voice_muted() {
        let mut m = StatusModel::default();
        assert_eq!(
            m.set(Status::Away, NOT_IN_VOICE, false),
            vec![Effect::ConnectVoice]
        );
    }

    #[test]
    fn activity_ends_an_automatic_away_but_never_a_chosen_one() {
        let mut auto = StatusModel::default();
        auto.set(Status::Online, NOT_IN_VOICE, false);
        auto.set(Status::Away, LIVE, true);
        assert_eq!(auto.activity(MUTED), vec![Effect::SetMuted(false)]);
        assert_eq!(auto.status(), Status::Online);

        let mut chosen = StatusModel::default();
        chosen.set(Status::Online, NOT_IN_VOICE, false);
        chosen.set(Status::Away, LIVE, false);
        assert!(chosen.activity(MUTED).is_empty());
        assert_eq!(chosen.status(), Status::Away);
    }

    #[test]
    fn unmuting_while_away_means_back_online() {
        let mut m = StatusModel::default();
        m.set(Status::Online, NOT_IN_VOICE, false);
        m.set(Status::Away, LIVE, false);
        assert_eq!(m.unmute(), Some(Effect::SetMuted(false)));
        assert_eq!(m.status(), Status::Online);
        assert_eq!(m.unmute(), None, "an ordinary unmute is left to the caller");
    }

    #[test]
    fn the_status_serialises_in_lowercase() {
        for s in [Status::Online, Status::Away, Status::Offline] {
            assert_eq!(
                serde_json::to_string(&s).unwrap(),
                format!("\"{}\"", s.as_str())
            );
        }
        assert_eq!(serde_json::to_string(&Status::Away).unwrap(), "\"away\"");
        assert_eq!(
            serde_json::from_str::<Status>("\"offline\"").unwrap(),
            Status::Offline
        );
    }
}
