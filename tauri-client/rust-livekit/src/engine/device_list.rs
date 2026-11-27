//! Which devices the settings screen offers. On Linux, cpal's ALSA host reports every PCM the sound
//! system defines: raw `hw:` and `plughw:` nodes, `surround51`, `iec958`, `dmix`, `null` and dozens of
//! others, many sharing one description ("HDA Intel PCH") and none of them something a person picks
//! a headset from. Only the ones that mean something are kept: the system default, the sound servers
//! (PipeWire, PulseAudio) and a card's own `sysdefault:` entry. Other platforms already list real
//! devices and are left alone.

use crate::devices::DeviceEntry;

/// One device as the host reports it: `key` is what identifies it (the PCM id on ALSA, the name elsewhere).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawDevice {
    pub key: String,
    pub name: String,
}

/// Whether an ALSA PCM id is one worth offering.
fn is_useful_pcm(key: &str) -> bool {
    matches!(key, "default" | "pipewire" | "pulse") || key.starts_with("sysdefault:")
}

fn label(device: &RawDevice) -> String {
    match device.key.as_str() {
        "default" => "System default".to_string(),
        "pipewire" => "PipeWire".to_string(),
        "pulse" => "PulseAudio".to_string(),
        _ => device.name.clone(),
    }
}

/// The list to show. `alsa` says the keys are ALSA PCM ids; without it the devices pass through.
/// Two entries that would read the same get their id added, so they can be told apart. If filtering
/// would leave nothing (an unusual setup), the full list is shown rather than an empty one.
pub fn curate(raw: Vec<RawDevice>, alsa: bool) -> Vec<DeviceEntry> {
    let kept: Vec<&RawDevice> = if alsa {
        raw.iter().filter(|d| is_useful_pcm(&d.key)).collect()
    } else {
        raw.iter().collect()
    };
    let chosen: Vec<&RawDevice> = if kept.is_empty() {
        raw.iter().collect()
    } else {
        kept
    };
    let mut entries: Vec<DeviceEntry> = Vec::new();
    for device in chosen {
        if entries.iter().any(|e| e.id == device.key) {
            continue;
        }
        let name = label(device);
        let taken = entries.iter().any(|e| e.name == name);
        entries.push(DeviceEntry {
            id: device.key.clone(),
            name: if taken {
                format!("{name} ({})", device.key)
            } else {
                name
            },
        });
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(key: &str, name: &str) -> RawDevice {
        RawDevice {
            key: key.into(),
            name: name.into(),
        }
    }

    fn typical_alsa() -> Vec<RawDevice> {
        vec![
            raw("null", "Discard all samples"),
            raw("pipewire", "PipeWire Sound Server"),
            raw("default", "Default Audio Device"),
            raw("sysdefault:CARD=PCH", "HDA Intel PCH"),
            raw("front:CARD=PCH,DEV=0", "HDA Intel PCH"),
            raw("surround51:CARD=PCH,DEV=0", "HDA Intel PCH"),
            raw("hw:CARD=PCH,DEV=0", "HDA Intel PCH"),
            raw("plughw:CARD=PCH,DEV=0", "HDA Intel PCH"),
            raw("iec958:CARD=PCH,DEV=0", "HDA Intel PCH"),
            raw("dmix:CARD=PCH,DEV=0", "HDA Intel PCH"),
            raw("usbstream:CARD=U4K", "U4K"),
            raw(
                "lavrate",
                "Rate Converter Plugin Using Libav/FFmpeg Library",
            ),
        ]
    }

    #[test]
    fn linux_keeps_the_default_the_sound_server_and_each_cards_own_entry() {
        let ids: Vec<String> = curate(typical_alsa(), true)
            .into_iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, ["pipewire", "default", "sysdefault:CARD=PCH"]);
    }

    #[test]
    fn the_internal_nodes_are_gone() {
        let list = curate(typical_alsa(), true);
        for hidden in [
            "null", "hw:", "plughw:", "surround", "iec958", "dmix", "lavrate", "front:",
        ] {
            assert!(
                list.iter().all(|e| !e.id.starts_with(hidden)),
                "{hidden} should be hidden"
            );
        }
    }

    #[test]
    fn the_default_reads_as_a_name_a_person_knows() {
        let list = curate(typical_alsa(), true);
        let default = list.iter().find(|e| e.id == "default").unwrap();
        assert_eq!(default.name, "System default");
    }

    #[test]
    fn two_entries_that_read_alike_are_told_apart() {
        let list = curate(
            vec![
                raw("sysdefault:CARD=A", "USB Audio"),
                raw("sysdefault:CARD=B", "USB Audio"),
            ],
            true,
        );
        assert_eq!(list[0].name, "USB Audio");
        assert_eq!(list[1].name, "USB Audio (sysdefault:CARD=B)");
    }

    #[test]
    fn a_repeated_id_is_listed_once() {
        let list = curate(vec![raw("default", "x"), raw("default", "x")], true);
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn an_unusual_setup_with_nothing_useful_still_shows_something() {
        let list = curate(vec![raw("hw:CARD=X,DEV=0", "X")], true);
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn other_platforms_are_left_alone() {
        let list = curate(
            vec![raw("Speakers", "Speakers"), raw("Headset", "Headset")],
            false,
        );
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].name, "Headset");
    }
}
