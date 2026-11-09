//! Which microphone and speaker the player chose. Kept beside the account file; `None` means "the
//! system default". A saved id for a device that has since been unplugged is harmless: it matches
//! nothing, so the default stays in use.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPrefs {
    pub input: Option<String>,
    pub output: Option<String>,
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
        };
        assert_eq!(prefs.clone().with("input", None).unwrap().input, None);
        assert!(prefs.with("camera", Some("x".into())).is_err());
    }
}
