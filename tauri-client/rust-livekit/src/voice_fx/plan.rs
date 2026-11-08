//! Which microphone path is live. Pure, so the rules that matter (a muted mic opens nothing; an
//! effect voice never has both paths open) are tested rather than hoped for.

use super::Voice;

/// What should be running for a given mute state and voice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    /// WebRTC's own capture (echo cancellation, noise suppression) and its "microphone" track.
    pub platform_mic: bool,
    /// Our capture + effect and the "voice-fx" track.
    pub fx_mic: bool,
}

pub fn plan(muted: bool, voice: Voice) -> Plan {
    if muted {
        // Mute releases the capture device, whichever path was in use (CLAUDE.md §8.1).
        return Plan {
            platform_mic: false,
            fx_mic: false,
        };
    }
    match voice {
        Voice::Normal => Plan {
            platform_mic: true,
            fx_mic: false,
        },
        _ => Plan {
            platform_mic: false,
            fx_mic: true,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn muted_opens_nothing_for_every_voice() {
        for v in Voice::ALL {
            assert_eq!(
                plan(true, v),
                Plan {
                    platform_mic: false,
                    fx_mic: false
                },
                "{v:?}"
            );
        }
    }

    #[test]
    fn normal_uses_the_platform_path_and_effects_use_ours_never_both() {
        assert_eq!(
            plan(false, Voice::Normal),
            Plan {
                platform_mic: true,
                fx_mic: false
            }
        );
        for v in [Voice::Giant, Voice::Imp, Voice::Robot, Voice::Demon] {
            let p = plan(false, v);
            assert!(p.fx_mic && !p.platform_mic, "{v:?}");
        }
    }
}
