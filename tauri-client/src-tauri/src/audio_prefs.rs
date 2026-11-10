//! Which microphone and speaker the player chose. Kept beside the account file; `None` means "the
//! system default". A saved id for a device that has since been unplugged is harmless: it matches
//! nothing, so the default stays in use.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AudioPrefs {
    pub input: Option<String>,
    pub output: Option<String>,
    /// `"mixer"` for the app's own audio engine; anything else (or nothing) is the platform layer.
    pub engine: Option<String>,
    /// Microphone volume (mixer engine only), 0 to 4; `None` is 1.
    pub mic_gain: Option<f32>,
    /// Adjust the microphone volume automatically; `None` is on. Fixed for the length of a call.
    pub auto_gain: Option<bool>,
    /// Each person's volume (mixer engine only), by account id, 0 to 2.
    pub volumes: std::collections::HashMap<String, f32>,
}

const FILE_NAME: &str = "audio.json";

impl AudioPrefs {
    /// Missing or unreadable files are just "no choice yet".
    pub fn load(dir: &Path) -> Self {
        std::fs::read_to_string(dir.join(FILE_NAME))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        std::fs::write(
            dir.join(FILE_NAME),
            serde_json::to_string_pretty(self).map_err(std::io::Error::other)?,
        )
    }

    pub fn auto_gain_on(&self) -> bool {
        self.auto_gain.unwrap_or(true)
    }

    pub fn uses_mixer(&self) -> bool {
        self.engine.as_deref() == Some("mixer")
    }

    /// Sets one side (`input` or `output`); anything else is refused.
    pub fn with(mut self, kind: &str, id: Option<String>) -> Result<Self, String> {
        match kind {
            "input" => self.input = id,
            "output" => self.output = id,
            other => return Err(format!("unknown device kind: {other}")),
        }
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_old_file_without_the_new_fields_still_loads() {
        let prefs: AudioPrefs = serde_json::from_str(r#"{"input":"mic","output":null}"#).unwrap();
        assert_eq!(prefs.input.as_deref(), Some("mic"));
        assert!(!prefs.uses_mixer());
        assert!(prefs.volumes.is_empty());
        assert!(
            prefs.auto_gain_on(),
            "automatic volume is on unless switched off"
        );
    }

    #[test]
    fn engine_gain_and_volumes_round_trip() {
        let mut prefs = AudioPrefs {
            engine: Some("mixer".into()),
            mic_gain: Some(1.5),
            auto_gain: Some(false),
            ..Default::default()
        };
        prefs.volumes.insert("user-1".into(), 0.5);
        let back: AudioPrefs =
            serde_json::from_str(&serde_json::to_string(&prefs).unwrap()).unwrap();
        assert_eq!(back, prefs);
        assert!(back.uses_mixer());
        assert!(!back.auto_gain_on());
    }

    #[test]
    fn choices_survive_a_restart_and_a_missing_file_means_defaults() {
        let dir = std::env::temp_dir().join(format!("vtt-audio-prefs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(AudioPrefs::load(&dir), AudioPrefs::default());
        let prefs = AudioPrefs::default()
            .with("input", Some("mic-1".into()))
            .unwrap()
            .with("output", Some("spk-2".into()))
            .unwrap();
        prefs.save(&dir).unwrap();
        assert_eq!(AudioPrefs::load(&dir), prefs);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_input_and_output_can_be_set_and_none_clears_a_choice() {
        let prefs = AudioPrefs {
            input: Some("a".into()),
            output: None,
            ..Default::default()
        };
        assert_eq!(prefs.clone().with("input", None).unwrap().input, None);
        assert!(prefs.with("camera", Some("x".into())).is_err());
    }
}
