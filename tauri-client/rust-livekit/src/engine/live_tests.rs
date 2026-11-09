//! Calls against a real LiveKit server (`livekit-server --dev`). Ignored by default; they use the real
//! sound card of the machine, so run them on the dev box:
//!
//! ```text
//! VTT_TEST_URL=ws://127.0.0.1:7880 VTT_TEST_TOKEN=<token for "mixer"> VTT_TEST_TOKEN2=<token for "other", same room> \
//!   cargo test -p rust-livekit -- --ignored mixer_
//! ```

use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::track::{LocalAudioTrack, LocalTrack};
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::webrtc::audio_stream::native::NativeAudioStream;

use crate::voice_fx::{BLOCK, SAMPLE_RATE};
use crate::{AudioBackend, ConnectInfo, ConnectInfoProvider, LiveKitClient};

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("set {name}"))
}

async fn mixer_client(url: &str, token: &str) -> LiveKitClient {
    let info = ConnectInfo {
        url: url.into(),
        token: token.into(),
    };
    let provider: ConnectInfoProvider = Arc::new(move || {
        let info = info.clone();
        Box::pin(async move { Ok(info) })
    });
    LiveKitClient::connect_with_backend(
        provider,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        AudioBackend::Mixer,
    )
    .await
    .expect("join with the mixer engine")
}

/// Another participant (plain SDK, no sound card) and its events.
async fn other(
    url: &str,
    token: &str,
) -> (Arc<Room>, tokio::sync::mpsc::UnboundedReceiver<RoomEvent>) {
    let (room, events) = Room::connect(url, token, RoomOptions::default())
        .await
        .expect("the other participant joins");
    (Arc::new(room), events)
}

fn tone_block(start: usize, amp: f32) -> Vec<i16> {
    (0..BLOCK)
        .map(|i| {
            let t = (start + i) as f32 / SAMPLE_RATE as f32;
            ((2.0 * std::f32::consts::PI * 440.0 * t).sin() * amp * i16::MAX as f32) as i16
        })
        .collect()
}

/// Someone else talks; the mixer client's playout receives it.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a LiveKit server, two tokens for one room, and a sound card"]
async fn mixer_receives_a_remote_voice_into_its_playout() {
    let (url, t1, t2) = (
        env("VTT_TEST_URL"),
        env("VTT_TEST_TOKEN"),
        env("VTT_TEST_TOKEN2"),
    );
    let client = mixer_client(&url, &t1).await;
    let mixer = client.mixer().expect("mixer backend");
    let (room, _events) = other(&url, &t2).await;

    let source = NativeAudioSource::new(AudioSourceOptions::default(), SAMPLE_RATE, 1, 200);
    let track =
        LocalAudioTrack::create_audio_track("microphone", RtcAudioSource::Native(source.clone()));
    room.local_participant()
        .publish_track(
            LocalTrack::Audio(track),
            TrackPublishOptions {
                source: TrackSource::Microphone,
                ..Default::default()
            },
        )
        .await
        .expect("publish");

    let talker = tokio::spawn(async move {
        let mut n = 0usize;
        for _ in 0..400 {
            let frame = AudioFrame {
                data: tone_block(n, 0.5).into(),
                sample_rate: SAMPLE_RATE,
                num_channels: 1,
                samples_per_channel: BLOCK as u32,
            };
            n += BLOCK;
            source.capture_frame(&frame).await.ok();
        }
    });

    let identity = "other";
    let mut heard = 0.0;
    for _ in 0..80 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        heard = mixer.duplex().playout.lock().unwrap().peak_seen(identity);
        if heard > 0.2 {
            break;
        }
    }
    talker.abort();
    client.disconnect().await.ok();
    assert!(
        heard > 0.2,
        "the remote voice should reach the playout mixer: {heard}"
    );
}

/// The mixer client speaks; someone else hears it.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a LiveKit server, two tokens for one room, and a sound card"]
async fn mixer_voice_reaches_the_other_participant() {
    let (url, t1, t2) = (
        env("VTT_TEST_URL"),
        env("VTT_TEST_TOKEN"),
        env("VTT_TEST_TOKEN2"),
    );
    let (room, mut events) = other(&url, &t2).await;
    let client = mixer_client(&url, &t1).await;
    let mixer = client.mixer().expect("mixer backend");
    client.set_microphone_muted(false); // opens the real microphone

    // The other side listens for the mixer client's track.
    let listener = tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            if let RoomEvent::TrackSubscribed {
                track: RemoteTrack::Audio(audio),
                ..
            } = event
            {
                let mut stream = NativeAudioStream::new(audio.rtc_track(), SAMPLE_RATE as i32, 1);
                let mut peak = 0i16;
                let mut frames = 0;
                while let Some(frame) = stream.next().await {
                    peak = peak.max(frame.data.iter().map(|s| s.abs()).max().unwrap_or(0));
                    frames += 1;
                    if peak > 3000 || frames > 800 {
                        break;
                    }
                }
                return peak;
            }
        }
        0
    });

    // Speak into the pipeline directly (a loud tone swamps whatever the real microphone hears).
    let duplex = mixer.duplex().clone();
    let mut n = 0usize;
    for _ in 0..300 {
        let block: Vec<f32> = tone_block(n, 0.7)
            .iter()
            .map(|s| *s as f32 / i16::MAX as f32)
            .collect();
        n += BLOCK;
        duplex.on_input(&block, 1, SAMPLE_RATE);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let peak = tokio::time::timeout(Duration::from_secs(5), listener)
        .await
        .map(|r| r.unwrap_or(0))
        .unwrap_or(0);
    client.disconnect().await.ok();
    drop(room);
    assert!(
        peak > 3000,
        "the other participant should hear the voice: {peak}"
    );
}

/// Muting releases the microphone and unmuting takes it again; leaving closes everything.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a LiveKit server, a token, and a sound card"]
async fn mixer_mute_unmute_and_leave_work() {
    let (url, t1) = (env("VTT_TEST_URL"), env("VTT_TEST_TOKEN"));
    let client = mixer_client(&url, &t1).await;
    for _ in 0..3 {
        client.set_microphone_muted(false);
        tokio::time::sleep(Duration::from_millis(300)).await;
        client.set_microphone_muted(true);
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(client.is_microphone_muted());
    client.disconnect().await.expect("leave");
}
