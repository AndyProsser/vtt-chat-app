//! Turning a downloaded clip (OGG/MP3/FLAC/WAV, judged by its bytes — the server already did) into
//! mono `f32` samples at the output device's rate, ready for the mixer.

use std::io::Cursor;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::error::LiveKitError;

/// A clip longer than this is refused: the server caps files at 5 MB, but a highly compressed one
/// could still expand to hours of PCM in memory.
const MAX_SECONDS: usize = 10 * 60;

fn audio(msg: impl ToString) -> LiveKitError {
    LiveKitError::Audio(msg.to_string())
}

/// Decodes `bytes` to mono at `target_rate` Hz.
pub fn decode_to_mono(bytes: Vec<u8>, target_rate: u32) -> Result<Vec<f32>, LiveKitError> {
    let stream = MediaSourceStream::new(Box::new(Cursor::new(bytes)), Default::default());
    let probed = symphonia::default::get_probe()
        .format(
            &Hint::new(),
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(audio)?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| audio("no audio track"))?
        .clone();
    let source_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| audio("unknown sample rate"))?;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(audio)?;

    let mut mono: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => return Err(audio(e)),
        };
        if packet.track_id() != track.id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let channels = decoded.spec().channels.count().max(1);
                let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
                buf.copy_interleaved_ref(decoded);
                for frame in buf.samples().chunks(channels) {
                    mono.push(frame.iter().sum::<f32>() / channels as f32);
                }
            }
            // A corrupt packet is skipped; the rest of the clip still plays.
            Err(SymError::DecodeError(_)) => continue,
            Err(e) => return Err(audio(e)),
        }
        if mono.len() > source_rate as usize * MAX_SECONDS {
            return Err(audio("that clip is too long"));
        }
    }
    if mono.is_empty() {
        return Err(audio("the clip has no audio"));
    }
    Ok(resample_linear(&mono, source_rate, target_rate))
}

/// Linear interpolation: plenty for sound effects and ambience, and no extra dependency.
pub fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = f64::from(from) / f64::from(to);
    let len = ((input.len() as f64) / ratio).floor() as usize;
    (0..len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let idx = pos.floor() as usize;
            let frac = (pos - idx as f64) as f32;
            let a = input[idx];
            let b = input.get(idx + 1).copied().unwrap_or(a);
            a + (b - a) * frac
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A mono 16-bit PCM WAV of `samples` at `rate`.
    fn wav(samples: &[i16], rate: u32) -> Vec<u8> {
        let data_len = (samples.len() * 2) as u32;
        let mut out = Vec::new();
        out.extend(b"RIFF");
        out.extend((36 + data_len).to_le_bytes());
        out.extend(b"WAVEfmt ");
        out.extend(16u32.to_le_bytes());
        out.extend(1u16.to_le_bytes()); // PCM
        out.extend(1u16.to_le_bytes()); // mono
        out.extend(rate.to_le_bytes());
        out.extend((rate * 2).to_le_bytes());
        out.extend(2u16.to_le_bytes());
        out.extend(16u16.to_le_bytes());
        out.extend(b"data");
        out.extend(data_len.to_le_bytes());
        for s in samples {
            out.extend(s.to_le_bytes());
        }
        out
    }

    #[test]
    fn a_wav_decodes_to_mono_floats() {
        let decoded = decode_to_mono(wav(&[0, 16384, -16384, 32767], 48_000), 48_000).unwrap();
        assert_eq!(decoded.len(), 4);
        assert!((decoded[1] - 0.5).abs() < 0.01);
        assert!((decoded[2] + 0.5).abs() < 0.01);
    }

    #[test]
    fn decoding_resamples_to_the_device_rate() {
        let decoded = decode_to_mono(wav(&[1000; 480], 24_000), 48_000).unwrap();
        assert!((decoded.len() as i64 - 960).abs() <= 2, "{}", decoded.len());
    }

    #[test]
    fn garbage_is_an_error_not_a_panic() {
        assert!(decode_to_mono(vec![1, 2, 3, 4, 5, 6, 7, 8], 48_000).is_err());
        assert!(decode_to_mono(Vec::new(), 48_000).is_err());
    }

    #[test]
    fn linear_resampling_changes_length_by_the_ratio() {
        let up = resample_linear(&[0.0, 1.0, 0.0, 1.0], 1, 2);
        assert_eq!(up.len(), 8);
        let same = resample_linear(&[0.3, 0.4], 44_100, 44_100);
        assert_eq!(same, vec![0.3, 0.4]);
    }
}
