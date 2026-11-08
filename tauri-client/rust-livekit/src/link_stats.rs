//! A player's link quality, boiled down from WebRTC's statistics for the DM's connection screen.

use livekit::webrtc::stats::{IceCandidatePairState, RtcStats};

/// Round-trip time, jitter and loss for one player's voice link.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LinkStats {
    pub rtt_ms: f64,
    pub jitter_ms: f64,
    /// 0–100.
    pub packet_loss_pct: f64,
}

/// Summarises publisher-side statistics (our audio going out). The server's report on what it
/// received (`RemoteInboundRtp`, audio) carries all three numbers; until that first report arrives
/// the ICE pair's round-trip time is better than nothing, with jitter and loss as zero. `None`
/// when there is nothing yet (just connected).
pub fn summarise(stats: &[RtcStats]) -> Option<LinkStats> {
    let remote = stats.iter().find_map(|s| match s {
        RtcStats::RemoteInboundRtp(r) if r.stream.kind == "audio" => Some(LinkStats {
            rtt_ms: r.remote_inbound.round_trip_time * 1000.0,
            jitter_ms: r.received.jitter * 1000.0,
            packet_loss_pct: (r.remote_inbound.fraction_lost * 100.0).clamp(0.0, 100.0),
        }),
        _ => None,
    });
    remote.or_else(|| {
        stats.iter().find_map(|s| match s {
            RtcStats::CandidatePair(p)
                if p.candidate_pair.nominated
                    || p.candidate_pair.state == Some(IceCandidatePairState::Succeeded) =>
            {
                Some(LinkStats {
                    rtt_ms: p.candidate_pair.current_round_trip_time * 1000.0,
                    jitter_ms: 0.0,
                    packet_loss_pct: 0.0,
                })
            }
            _ => None,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use livekit::webrtc::stats::{CandidatePairStats, RemoteInboundRtpStats};

    fn remote(kind: &str, rtt: f64, jitter: f64, lost: f64) -> RtcStats {
        let mut r = RemoteInboundRtpStats::default();
        r.stream.kind = kind.into();
        r.remote_inbound.round_trip_time = rtt;
        r.received.jitter = jitter;
        r.remote_inbound.fraction_lost = lost;
        RtcStats::RemoteInboundRtp(r)
    }

    fn pair(nominated: bool, rtt: f64) -> RtcStats {
        let mut p = CandidatePairStats::default();
        p.candidate_pair.nominated = nominated;
        p.candidate_pair.current_round_trip_time = rtt;
        RtcStats::CandidatePair(p)
    }

    #[test]
    fn reads_rtt_jitter_and_loss_from_the_servers_report_in_ms_and_percent() {
        let s = summarise(&[remote("audio", 0.042, 0.005, 0.015)]).unwrap();
        assert!((s.rtt_ms - 42.0).abs() < 1e-9);
        assert!((s.jitter_ms - 5.0).abs() < 1e-9);
        assert!((s.packet_loss_pct - 1.5).abs() < 1e-9);
    }

    #[test]
    fn ignores_a_video_report_and_falls_back_to_the_ice_pair() {
        let s = summarise(&[remote("video", 0.9, 0.9, 0.9), pair(true, 0.03)]).unwrap();
        assert!((s.rtt_ms - 30.0).abs() < 1e-9);
        assert_eq!((s.jitter_ms, s.packet_loss_pct), (0.0, 0.0));
    }

    #[test]
    fn prefers_the_servers_report_over_the_pair() {
        let s = summarise(&[pair(true, 0.5), remote("audio", 0.01, 0.0, 0.0)]).unwrap();
        assert!((s.rtt_ms - 10.0).abs() < 1e-9);
    }

    #[test]
    fn is_none_with_nothing_usable_and_clamps_loss() {
        assert_eq!(summarise(&[]), None);
        assert_eq!(summarise(&[pair(false, 0.1)]), None);
        assert_eq!(
            summarise(&[remote("audio", 0.0, 0.0, 4.0)])
                .unwrap()
                .packet_loss_pct,
            100.0
        );
    }
}
