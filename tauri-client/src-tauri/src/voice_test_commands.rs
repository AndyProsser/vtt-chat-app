//! Settings -> Audio -> "Test your voice": record a few seconds, play them back under any voice-tone
//! preset. The engine is `rust_livekit::engine::voice_test`; this only turns the player's saved audio
//! settings into its inputs and the answers into JSON for the panel.

use rust_livekit::engine::voice_test::{Phase, TestSettings, VoiceTest};
use rust_livekit::engine::voice_tone::VoicePreset;
use serde_json::json;
use tauri::{AppHandle, State};

use crate::audio_prefs::AudioPrefs;

fn prefs_of(app: &AppHandle) -> Result<AudioPrefs, String> {
    let dir = crate::account::data_dir(app).ok_or("no place to read the audio settings")?;
    Ok(AudioPrefs::load(&dir))
}

/// Starts recording `seconds` (3 to 10) with the player's current microphone, volume and filters.
#[tauri::command]
pub fn voice_test_record(
    app: AppHandle,
    test: State<'_, VoiceTest>,
    seconds: u32,
) -> Result<(), String> {
    let prefs = prefs_of(&app)?;
    test.record(
        seconds,
        TestSettings {
            input: prefs.input.clone(),
            output: prefs.output.clone(),
            mic_gain: prefs.mic_gain.unwrap_or(1.0),
            auto_gain: prefs.auto_gain_on(),
            noise_filter: prefs.noise_filter_level(),
        },
    )
}

/// Plays the recording under `preset` (`off`, `natural`, `warm`, `broadcast`) on the chosen speakers.
#[tauri::command]
pub fn voice_test_play(
    app: AppHandle,
    test: State<'_, VoiceTest>,
    preset: String,
) -> Result<(), String> {
    let preset = VoicePreset::from_name(&preset).ok_or("unknown voice preset")?;
    let prefs = prefs_of(&app)?;
    test.play(preset, prefs.output.clone())
}

/// Stops a recording early (keeping what was heard) or a playback.
#[tauri::command]
pub fn voice_test_stop(test: State<'_, VoiceTest>) {
    test.stop();
}

/// Forgets the recording.
#[tauri::command]
pub fn voice_test_clear(test: State<'_, VoiceTest>) {
    test.clear();
}

/// Where the test is: `phase` (`idle`, `recording`, `ready`, `playing`), the time into it and its length in
/// milliseconds, the voice level while recording (0 to 1), and the last error, if any.
#[tauri::command]
pub fn voice_test_status(test: State<'_, VoiceTest>) -> serde_json::Value {
    let status = test.status();
    json!({
        "phase": status.phase.name(),
        "elapsedMs": status.elapsed_ms,
        "totalMs": status.total_ms,
        "level": status.level,
        "error": status.error,
        "hasClip": matches!(status.phase, Phase::Ready | Phase::Playing),
    })
}
