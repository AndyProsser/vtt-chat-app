//! Choosing the microphone and speaker. The lists come from the platform audio module; a choice is
//! matched by the device's id string against that list (never constructed from user text), so a
//! saved id for a device that has been unplugged simply finds nothing and the system default stays.

use livekit::PlatformAudio;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceEntry {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeviceList {
    pub inputs: Vec<DeviceEntry>,
    pub outputs: Vec<DeviceEntry>,
}

/// The entry with this id, if the wanted device is still present.
pub fn find<'a>(list: &'a [DeviceEntry], wanted: &str) -> Option<&'a DeviceEntry> {
    list.iter().find(|d| d.id == wanted)
}

pub(crate) fn list(audio: &PlatformAudio) -> DeviceList {
    DeviceList {
        inputs: audio
            .recording_devices()
            .map(|d| DeviceEntry {
                id: d.id.as_str().to_string(),
                name: d.name,
            })
            .collect(),
        outputs: audio
            .playout_devices()
            .map(|d| DeviceEntry {
                id: d.id.as_str().to_string(),
                name: d.name,
            })
            .collect(),
    }
}

/// Switches to the wanted devices. A `None` or a device that is gone leaves that side alone; the
/// error names the first thing that failed.
pub(crate) fn apply(
    audio: &PlatformAudio,
    input: Option<&str>,
    output: Option<&str>,
) -> Result<(), String> {
    if let Some(wanted) = input {
        if let Some(device) = audio.recording_devices().find(|d| d.id.as_str() == wanted) {
            audio
                .switch_recording_device(&device.id)
                .map_err(|e| format!("could not switch the microphone: {e}"))?;
        }
    }
    if let Some(wanted) = output {
        if let Some(device) = audio.playout_devices().find(|d| d.id.as_str() == wanted) {
            audio
                .switch_playout_device(&device.id)
                .map_err(|e| format!("could not switch the speaker: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> DeviceEntry {
        DeviceEntry {
            id: id.into(),
            name: id.to_uppercase(),
        }
    }

    #[test]
    fn a_wanted_device_is_found_by_id_and_a_missing_one_is_not() {
        let list = [entry("a"), entry("b")];
        assert_eq!(find(&list, "b").map(|d| d.name.as_str()), Some("B"));
        assert!(find(&list, "unplugged").is_none());
    }
}
