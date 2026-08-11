use rust_livekit::SharedClient;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::consts::{MICROPHONE_STATE_EVENT, OVERLAY_TOGGLE_EVENT};

/// The three bindings from the Stage 2 spec §1, decoupled from *how* the key was delivered.
///
/// Two independent paths produce these (spec Amendment A): the global-shortcut plugin, which
/// works on Windows/macOS/X11 and silently no-ops on Wayland, and an injected in-page key
/// handler, which is app-focused-only but works everywhere. Both call `dispatch`, and both must
/// be safe to fire for the same physical keypress — see `mute_state_for`'s idempotence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HotkeyAction {
    PushToTalkPressed,
    PushToTalkReleased,
    ToggleMute,
    ToggleOverlay,
}

impl HotkeyAction {
    /// Parses the action name sent by the injected key handler. Returns `None` for anything
    /// unrecognized rather than defaulting, so a typo can't silently unmute the microphone.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "push_to_talk_pressed" => Some(Self::PushToTalkPressed),
            "push_to_talk_released" => Some(Self::PushToTalkReleased),
            "toggle_mute" => Some(Self::ToggleMute),
            "toggle_overlay" => Some(Self::ToggleOverlay),
            _ => None,
        }
    }
}

/// The pure half: given an action and the current mute state, what should the state become?
/// `None` means this action doesn't affect the microphone.
///
/// Push-to-talk is written as an absolute target (`false` on press, `true` on release) rather
/// than a toggle precisely so that both delivery paths firing for one keypress is harmless —
/// two presses in a row still leave the mic open, two releases still leave it muted.
pub fn mute_state_for(action: HotkeyAction, currently_muted: bool) -> Option<bool> {
    match action {
        HotkeyAction::PushToTalkPressed => Some(false),
        HotkeyAction::PushToTalkReleased => Some(true),
        HotkeyAction::ToggleMute => Some(!currently_muted),
        HotkeyAction::ToggleOverlay => None,
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MicrophoneStatePayload {
    muted: bool,
}

/// Applies a mute state directly and emits `livekit:microphone`. The one place that touches the
/// microphone gate — both the hotkey path (`dispatch`, below) and the UI mute button
/// (`commands::set_microphone_muted`) call this, so a click and a keypress can't drift: without
/// this, the emit is exactly the step that would get forgotten in one of the two paths, leaving
/// the overlay showing stale mic state.
pub fn apply_microphone_mute(app: &AppHandle, muted: bool) {
    let state = app.state::<SharedClient>();
    let guard = match state.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("[src-tauri] LiveKit client mutex poisoned; recovering to apply mute");
            poisoned.into_inner()
        }
    };
    let Some(client) = guard.as_ref() else {
        return;
    };

    client.set_microphone_muted(muted);
    let _ = app.emit(MICROPHONE_STATE_EVENT, MicrophoneStatePayload { muted });
}

/// Applies an action. A no-op for microphone actions when not connected — hotkeys are live
/// before any room is joined, and pressing PTT then shouldn't be an error.
pub fn dispatch(app: &AppHandle, action: HotkeyAction) {
    if action == HotkeyAction::ToggleOverlay {
        let _ = app.emit(OVERLAY_TOGGLE_EVENT, ());
        return;
    }

    let currently_muted = {
        let state = app.state::<SharedClient>();
        let guard = match state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("[src-tauri] LiveKit client mutex poisoned; recovering to apply hotkey");
                poisoned.into_inner()
            }
        };
        let Some(client) = guard.as_ref() else {
            return;
        };
        client.is_microphone_muted()
    };

    let Some(muted) = mute_state_for(action, currently_muted) else {
        return;
    };

    apply_microphone_mute(app, muted);
}

fn toggle_mute_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM)
}

fn toggle_overlay_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyO)
}

/// Registers the OS-level shortcuts. Failures are logged and swallowed — a shortcut already
/// claimed by another app degrades the experience but must not block startup.
///
/// Two deliberate absences here, both confirmed by running the app rather than inferred:
///
/// - **Push-to-talk is not registered globally, on any platform.** `global-hotkey` has no
///   scancode mapping for bare modifier keys, so Right Ctrl fails with "Unknown scancode for
///   key: ControlRight" everywhere, not just on Wayland. PTT is therefore app-focused only,
///   delivered by the injected key handler, which reads `event.code === 'ControlRight'` fine.
///   Attempting the registration anyway would only print an error on every launch.
/// - **On Wayland nothing registered here ever fires.** The underlying `global-hotkey`/`tao`
///   shortcut thread is X11-specific and disabled on Wayland (tauri-apps/tao#543), so
///   registration *succeeds* and then silently does nothing. That is why the injected in-page
///   handler exists as a second path; see the Stage 2 spec, Amendment A.
pub fn register_global_shortcuts(app: &AppHandle) {
    if is_wayland() {
        eprintln!(
            "[src-tauri] Wayland session detected: OS-level global shortcuts are unavailable \
             (global-hotkey is X11-only). Mute and overlay toggle will work only while the app \
             window has focus, via the injected key handler."
        );
    }

    // Registered one at a time, not as a batch. `on_shortcuts` is all-or-nothing: one
    // unregisterable binding aborts the whole call, which is how push-to-talk's failure
    // silently cost mute *and* overlay toggle their global paths.
    register_one(app, toggle_mute_shortcut(), |state| {
        // Key-down only; acting on both edges would toggle twice per press.
        (state == ShortcutState::Pressed).then_some(HotkeyAction::ToggleMute)
    });
    register_one(app, toggle_overlay_shortcut(), |state| {
        (state == ShortcutState::Pressed).then_some(HotkeyAction::ToggleOverlay)
    });
}

fn register_one(
    app: &AppHandle,
    shortcut: Shortcut,
    to_action: impl Fn(ShortcutState) -> Option<HotkeyAction> + Send + Sync + 'static,
) {
    let result = app
        .global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if let Some(action) = to_action(event.state()) {
                dispatch(app, action);
            }
        });

    if let Err(err) = result {
        eprintln!(
            "[src-tauri] could not register global shortcut {shortcut:?} ({err}); \
             the injected in-page key handler still covers the app-focused case"
        );
    }
}

fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var("WAYLAND_DISPLAY").is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_to_talk_opens_on_press_and_closes_on_release() {
        assert_eq!(
            mute_state_for(HotkeyAction::PushToTalkPressed, true),
            Some(false)
        );
        assert_eq!(
            mute_state_for(HotkeyAction::PushToTalkReleased, false),
            Some(true)
        );
    }

    /// Both delivery paths can fire for one physical keypress on Windows/X11, so repeats must
    /// converge on the same state rather than flip it.
    #[test]
    fn push_to_talk_is_idempotent() {
        assert_eq!(
            mute_state_for(HotkeyAction::PushToTalkPressed, false),
            Some(false)
        );
        assert_eq!(
            mute_state_for(HotkeyAction::PushToTalkReleased, true),
            Some(true)
        );
    }

    #[test]
    fn toggle_mute_inverts_current_state() {
        assert_eq!(mute_state_for(HotkeyAction::ToggleMute, true), Some(false));
        assert_eq!(mute_state_for(HotkeyAction::ToggleMute, false), Some(true));
    }

    #[test]
    fn overlay_toggle_does_not_touch_the_microphone() {
        assert_eq!(mute_state_for(HotkeyAction::ToggleOverlay, true), None);
        assert_eq!(mute_state_for(HotkeyAction::ToggleOverlay, false), None);
    }

    #[test]
    fn parses_known_action_names() {
        assert_eq!(
            HotkeyAction::from_name("push_to_talk_pressed"),
            Some(HotkeyAction::PushToTalkPressed)
        );
        assert_eq!(
            HotkeyAction::from_name("toggle_overlay"),
            Some(HotkeyAction::ToggleOverlay)
        );
    }

    #[test]
    fn rejects_unknown_action_names() {
        assert_eq!(HotkeyAction::from_name(""), None);
        assert_eq!(HotkeyAction::from_name("unmute"), None);
        assert_eq!(HotkeyAction::from_name("PushToTalkPressed"), None);
    }
}
