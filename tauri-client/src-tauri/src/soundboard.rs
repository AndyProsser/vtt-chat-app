//! The DM soundboard, player side: the server says *what* to play (`sound.play`, `sound.stop`,
//! `sound.volume`, `sound.state`, `scene.*`); this module fetches the clip, decodes it and plays it
//! on **this** machine through the Rust mixer — never through the SFU, so it is never in a recording
//! and never touches the webview.
//!
//! The decision of what each frame means ([`plan`]) is pure and tested; fetching and playing are the
//! thin shell around it. Clips are immutable per take, so they are cached on disk by take id.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rust_livekit::sound::{decode_to_mono, SoundEngine, SAMPLE_RATE};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::account::{relay_path, AccountClient};
use crate::account_commands::AccountState;

/// What a server frame asks this client to do.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Play {
        play_id: String,
        take_id: String,
        looping: bool,
        /// The play's own volume times the take's level (the table volume is applied by the mixer).
        gain: f32,
        /// Started by a scene layer (as opposed to a stinger button), so the scene level applies.
        scene: bool,
    },
    Stop(String),
    StopAll,
    /// The DM's table volume, 0–1.
    Master(f32),
    /// The DM's gain for this player, 0–2.
    MyGain(f32),
}

fn number(v: Option<&Value>, default: f32) -> f32 {
    v.and_then(Value::as_f64).map_or(default, |n| n as f32)
}

fn play_action(d: &Value) -> Option<Action> {
    Some(Action::Play {
        play_id: d.get("playId")?.as_str()?.to_string(),
        take_id: d.get("takeId")?.as_str()?.to_string(),
        looping: d.get("mode").and_then(Value::as_str) == Some("loop"),
        gain: number(d.get("volume"), 1.0).clamp(0.0, 1.0)
            * number(d.get("level"), 1.0).clamp(0.0, 1.0),
        scene: d.get("layerId").is_some_and(|v| !v.is_null()),
    })
}

/// The play's gain after the DM's per-kind level: `(stingers, scenes)`.
fn kind_gain(gain: f32, levels: (f32, f32), scene: bool) -> f32 {
    gain * if scene { levels.1 } else { levels.0 }
}

/// Turns one table frame into actions. Unknown frames and malformed payloads give none.
pub fn plan(t: &str, d: &Value, my_user_id: &str) -> Vec<Action> {
    match t {
        "sound.play" => play_action(d).into_iter().collect(),
        "sound.stop" => match d.get("playId").and_then(Value::as_str) {
            Some(id) => vec![Action::Stop(id.to_string())],
            None => vec![Action::StopAll],
        },
        // The scene's loops arrive as ordinary `sound.play`s and stop as a plain `sound.stop`/StopAll
        // from the server; ending the scene ends its loops.
        "scene.stopped" => vec![Action::StopAll],
        "sound.volume" => {
            let mut out = Vec::new();
            if let Some(m) = d.get("master").and_then(Value::as_f64) {
                out.push(Action::Master(m as f32));
            }
            if let Some(p) = d.get("player") {
                if p.get("userId").and_then(Value::as_str) == Some(my_user_id) {
                    out.push(Action::MyGain(number(p.get("gain"), 1.0)));
                }
            }
            out
        }
        // After a (re)connect: forget what was playing and rebuild from the server's truth.
        "sound.state" => {
            let mut out = vec![
                Action::StopAll,
                Action::Master(number(d.get("master"), 1.0)),
                Action::MyGain(number(d.get("gains").and_then(|g| g.get(my_user_id)), 1.0)),
            ];
            if let Some(loops) = d.get("loops").and_then(Value::as_array) {
                out.extend(loops.iter().filter_map(play_action));
            }
            out
        }
        _ => Vec::new(),
    }
}

/// Take ids are server-made UUIDs; anything else is not turned into a path or a URL.
fn plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

const DECODED_CACHE_SLOTS: usize = 8;
/// A clip this big (about 2 minutes at 48 kHz) is played but not kept decoded in memory.
const DECODED_KEEP_MAX: usize = 6_000_000;

pub struct Soundboard {
    engine: SoundEngine,
    /// Only the DM's app plays effects: it mixes them and sends them on the call, so the table hears
    /// one copy (no echo from a second player on every machine). Everyone else ignores the frames.
    is_dm: AtomicBool,
    /// Whether the DM also hears them on their own speakers (turn off if you use speakers: the call
    /// carries them to everyone else anyway).
    monitor: AtomicBool,
    levels: Mutex<(f32, f32)>,
    /// The DM's volume for each kind of sound, 0 to 1: (stingers, scenes). Applied as a sound starts.
    kind_levels: Mutex<(f32, f32)>,
    /// Plays that should still start once their clip arrives (a stop removes them).
    wanted: Mutex<HashSet<String>>,
    decoded: Mutex<HashMap<String, Arc<Vec<f32>>>>,
}

impl Default for Soundboard {
    fn default() -> Self {
        Self {
            engine: SoundEngine::spawn(),
            is_dm: AtomicBool::new(false),
            monitor: AtomicBool::new(true),
            levels: Mutex::new((1.0, 1.0)),
            kind_levels: Mutex::new((1.0, 1.0)),
            wanted: Mutex::new(HashSet::new()),
            decoded: Mutex::new(HashMap::new()),
        }
    }
}

impl Soundboard {
    fn apply_levels(&self, change: impl FnOnce(&mut (f32, f32))) {
        let mut levels = self.levels.lock().unwrap();
        change(&mut levels);
        self.engine.set_master(levels.0 * levels.1);
    }
}

/// Whether `me` is the DM in a snapshot or roster update (`{ members: [{ userId, role }] }`).
pub fn self_is_dm(roster: &Value, me: &str) -> bool {
    roster
        .get("members")
        .and_then(Value::as_array)
        .is_some_and(|members| {
            members.iter().any(|m| {
                m.get("userId").and_then(Value::as_str) == Some(me)
                    && m.get("role").and_then(Value::as_str) == Some("dm")
            })
        })
}

/// Learns whether this player is the DM from the roster (a snapshot or a roster update). When the
/// role changes (a DM swap) anything still playing stops.
pub async fn note_roster(app: &AppHandle, roster: &Value) {
    let me = app
        .state::<AccountState>()
        .user_id()
        .await
        .unwrap_or_default();
    let dm = self_is_dm(roster, &me);
    let board = app.state::<Soundboard>();
    if board.is_dm.swap(dm, Ordering::Relaxed) && !dm {
        board.wanted.lock().unwrap().clear();
        board.engine.stop_all();
    }
}

/// Handles a table frame; the cheap, synchronous actions happen here and clip loading is spawned.
pub async fn on_table(app: &AppHandle, t: &str, data: &Value) {
    if !(t.starts_with("sound.") || t.starts_with("scene.")) {
        return;
    }
    let me = app
        .state::<AccountState>()
        .user_id()
        .await
        .unwrap_or_default();
    let board = app.state::<Soundboard>();
    if !board.is_dm.load(Ordering::Relaxed) {
        return; // the DM's app plays for the whole table
    }
    for action in plan(t, data, &me) {
        match action {
            Action::Master(v) => board.apply_levels(|l| l.0 = v.clamp(0.0, 1.0)),
            Action::MyGain(v) => board.apply_levels(|l| l.1 = v.clamp(0.0, 2.0)),
            Action::Stop(id) => {
                board.wanted.lock().unwrap().remove(&id);
                board.engine.stop(&id);
            }
            Action::StopAll => {
                board.wanted.lock().unwrap().clear();
                board.engine.stop_all();
            }
            Action::Play {
                play_id,
                take_id,
                looping,
                gain,
                scene,
            } => {
                let gain = kind_gain(gain, *board.kind_levels.lock().unwrap(), scene);
                board.wanted.lock().unwrap().insert(play_id.clone());
                attach_call(app, &board).await;
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = load_and_play(&app, &play_id, &take_id, looping, gain).await {
                        eprintln!("[src-tauri] soundboard: could not play {take_id}: {err}");
                    }
                });
            }
        }
    }
}

/// Sends the mix to the call (publishing the soundboard track the first time), or nowhere if the DM
/// is not in voice (then only their own speakers hear it, if the monitor is on).
async fn attach_call(app: &AppHandle, board: &Soundboard) {
    let control = app
        .state::<rust_livekit::SharedClient>()
        .lock()
        .unwrap()
        .as_ref()
        .map(|c| c.voice_control());
    let sink = match control {
        Some(control) => match control.sound_sink().await {
            Ok(sink) => Some(sink),
            Err(err) => {
                eprintln!("[src-tauri] soundboard: could not publish the effects track: {err}");
                None
            }
        },
        None => None,
    };
    board.engine.set_sink(sink);
}

/// Whether the DM hears effects on their own speakers too.
#[tauri::command]
pub fn soundboard_monitor_set(app: AppHandle, on: bool) {
    let board = app.state::<Soundboard>();
    board.monitor.store(on, Ordering::Relaxed);
    board.engine.set_monitor(on);
}

/// The DM's volume for stingers and for scenes (0 to 1 each). A sound already playing keeps the level
/// it started with; the next one uses the new level.
#[tauri::command]
pub fn soundboard_levels_set(app: AppHandle, stingers: f32, scenes: f32) {
    let board = app.state::<Soundboard>();
    *board.kind_levels.lock().unwrap() = (stingers.clamp(0.0, 1.0), scenes.clamp(0.0, 1.0));
}

/// Everything stops when the session ends (sign-out, revoked, switching campaign).
pub fn stop_all(app: &AppHandle) {
    let board = app.state::<Soundboard>();
    board.wanted.lock().unwrap().clear();
    board.engine.stop_all();
}

fn cache_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("sounds"))
}

async fn load_and_play(
    app: &AppHandle,
    play_id: &str,
    take_id: &str,
    looping: bool,
    gain: f32,
) -> Result<(), String> {
    if !plain_id(take_id) {
        return Err("bad take id".into());
    }
    let board = app.state::<Soundboard>();
    let cached = board.decoded.lock().unwrap().get(take_id).cloned();
    let clip = match cached {
        Some(clip) => clip,
        None => {
            let bytes = clip_bytes(app, take_id).await?;
            let samples =
                tauri::async_runtime::spawn_blocking(move || decode_to_mono(bytes, SAMPLE_RATE))
                    .await
                    .map_err(|e| e.to_string())?
                    .map_err(|e| e.to_string())?;
            let clip = Arc::new(samples);
            if clip.len() <= DECODED_KEEP_MAX {
                let mut cache = board.decoded.lock().unwrap();
                if cache.len() >= DECODED_CACHE_SLOTS {
                    cache.clear();
                }
                cache.insert(take_id.to_string(), Arc::clone(&clip));
            }
            clip
        }
    };
    // A stop (or a session ending) while the clip was loading cancels the play.
    if board.wanted.lock().unwrap().contains(play_id) {
        board.engine.play(play_id, clip, looping, gain);
        if !looping {
            // A one-shot needs no further tracking once it has started.
            board.wanted.lock().unwrap().remove(play_id);
        }
    }
    Ok(())
}

async fn clip_bytes(app: &AppHandle, take_id: &str) -> Result<Vec<u8>, String> {
    let file = cache_dir(app).map(|d| d.join(take_id));
    if let Some(path) = &file {
        if let Ok(bytes) = std::fs::read(path) {
            return Ok(bytes);
        }
    }
    let (server, token, campaign) = app
        .state::<AccountState>()
        .credentials()
        .await
        .map_err(|e| e.message)?;
    let path =
        relay_path(&campaign, &format!("sounds/takes/{take_id}/file")).map_err(|e| e.message)?;
    let (_, bytes) = AccountClient::new(&server)
        .fetch_file(&token, &path)
        .await
        .map_err(|e| e.message)?;
    if let Some(path) = file {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, &bytes);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn play_gain_is_volume_times_level_and_loops_are_marked() {
        let d = json!({"playId":"p","takeId":"t","mode":"loop","volume":0.5,"level":0.5});
        assert_eq!(
            plan("sound.play", &d, "me"),
            vec![Action::Play {
                play_id: "p".into(),
                take_id: "t".into(),
                looping: true,
                gain: 0.25,
                scene: false
            }]
        );
        let layered =
            json!({"playId":"p","takeId":"t","mode":"oneshot","volume":1,"level":1,"layerId":"l1"});
        assert!(matches!(
            &plan("sound.play", &layered, "me")[0],
            Action::Play { scene: true, .. }
        ));
        assert_eq!(kind_gain(0.5, (0.8, 0.4), true), 0.2);
        assert_eq!(kind_gain(0.5, (0.8, 0.4), false), 0.4);
        let one = json!({"playId":"p","takeId":"t","mode":"oneshot","volume":1,"level":1});
        assert!(matches!(
            &plan("sound.play", &one, "me")[0],
            Action::Play { looping: false, .. }
        ));
    }

    #[test]
    fn stop_with_and_without_an_id() {
        assert_eq!(
            plan("sound.stop", &json!({"playId":"p"}), "me"),
            vec![Action::Stop("p".into())]
        );
        assert_eq!(
            plan("sound.stop", &json!({"playId":null}), "me"),
            vec![Action::StopAll]
        );
        assert_eq!(
            plan("scene.stopped", &json!({}), "me"),
            vec![Action::StopAll]
        );
    }

    #[test]
    fn only_my_own_gain_applies() {
        let mine = json!({"player":{"userId":"me","gain":1.5}});
        let theirs = json!({"player":{"userId":"you","gain":0.0}});
        assert_eq!(plan("sound.volume", &mine, "me"), vec![Action::MyGain(1.5)]);
        assert!(plan("sound.volume", &theirs, "me").is_empty());
        assert_eq!(
            plan("sound.volume", &json!({"master":0.4}), "me"),
            vec![Action::Master(0.4)]
        );
    }

    #[test]
    fn sound_state_rebuilds_everything() {
        let d = json!({
            "master": 0.8,
            "gains": {"me": 0.5},
            "loops": [{"playId":"p","takeId":"t","mode":"loop","volume":1,"level":1}]
        });
        let actions = plan("sound.state", &d, "me");
        assert_eq!(actions[0], Action::StopAll);
        assert_eq!(actions[1], Action::Master(0.8));
        assert_eq!(actions[2], Action::MyGain(0.5));
        assert!(matches!(actions[3], Action::Play { looping: true, .. }));
    }

    #[test]
    fn malformed_or_unrelated_frames_do_nothing() {
        assert!(plan("sound.play", &json!({"playId":"p"}), "me").is_empty());
        assert!(plan("chat.message", &json!({}), "me").is_empty());
    }

    #[test]
    fn only_the_dm_in_the_roster_is_the_dm() {
        let roster = json!({ "members": [
            { "userId": "dm1", "role": "dm" },
            { "userId": "p1", "role": "player" },
        ]});
        assert!(self_is_dm(&roster, "dm1"));
        assert!(!self_is_dm(&roster, "p1"));
        assert!(!self_is_dm(&roster, "stranger"));
        assert!(!self_is_dm(&json!({}), "dm1"));
        assert!(!self_is_dm(&json!({ "members": "no" }), "dm1"));
    }

    #[test]
    fn take_ids_must_be_plain() {
        assert!(plain_id("3f2a-9b_c"));
        for bad in ["", "../x", "a/b", "a b", "a?b"] {
            assert!(!plain_id(bad), "{bad:?}");
        }
    }
}
