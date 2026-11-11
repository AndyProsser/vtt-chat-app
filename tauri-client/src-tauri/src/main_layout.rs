//! Where the main window opens. It is a narrow chat column that should fill the screen from top to bottom
//! with a little air at both ends, whatever the resolution, scale factor, taskbar, dock or menu bar.
//! The operating system tells us the **usable** area of the monitor (the work area: the screen minus the
//! taskbar, menu bar and panels it knows about); this module turns that into a size and position.
//!
//! All numbers here are logical pixels, so they scale with the display.

/// The default width of the main window.
pub const WIDTH: f64 = 480.0;
/// The narrowest it is ever opened at (a small screen).
const MIN_WIDTH: f64 = 380.0;
/// Air left above and below the window, inside the usable area.
const BUFFER: f64 = 50.0;
/// Linux on Wayland cannot report the top bar or a dock, so the whole screen looks usable. Assume a
/// GNOME-style bar on top (which the 50 px buffer already clears) and make the bottom buffer large enough
/// for a bottom dock.
const UNKNOWN_BOTTOM_BUFFER: f64 = 90.0;
/// Never opened shorter or taller than this, however small or large the screen.
const MIN_HEIGHT: f64 = 480.0;
const MAX_HEIGHT: f64 = 1400.0;
/// Bump this when the default changes and old remembered sizes should be dropped once.
pub const LAYOUT_VERSION: u32 = 2;

/// A rectangle in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The window's size (inner, i.e. without its title bar) and top-left position for a work area.
/// `bars_unknown` is true when the system gave no hint of any taskbar or panel (the work area is the
/// whole monitor on Linux).
pub fn default_rect(area: Rect, bars_unknown: bool) -> Rect {
    let bottom = if bars_unknown {
        UNKNOWN_BOTTOM_BUFFER
    } else {
        BUFFER
    };
    let free = (area.h - BUFFER - bottom).max(0.0);
    // Prefer the full free height, but keep a usable window on a very small screen and a sane one on a huge one.
    let height = free.clamp(MIN_HEIGHT.min(area.h), MAX_HEIGHT);
    let width = WIDTH.min((area.w * 0.9).max(MIN_WIDTH.min(area.w)));
    Rect {
        x: area.x + (area.w - width) / 2.0,
        y: area.y + BUFFER + (free - height).max(0.0) / 2.0,
        w: width,
        h: height,
    }
}

/// Whether a remembered window position can be kept: it lies inside the usable area with its title bar
/// reachable. A window left from a monitor that is gone, or from before the screen resolution changed, fails.
pub fn fits(outer: Rect, area: Rect) -> bool {
    let slack = 1.0; // rounding between logical and physical pixels
    outer.x >= area.x - slack
        && outer.y >= area.y - slack
        && outer.x + outer.w <= area.x + area.w + slack
        && outer.y + outer.h <= area.y + area.h + slack
        && outer.w >= MIN_WIDTH - slack
}

#[cfg(test)]
mod tests {
    use super::*;

    const FHD: Rect = Rect {
        x: 0.0,
        y: 0.0,
        w: 1920.0,
        h: 1080.0,
    };

    #[test]
    fn it_opens_480_wide_with_50_px_above_and_below() {
        let r = default_rect(FHD, false);
        assert_eq!(r.w, 480.0);
        assert_eq!(r.y, 50.0);
        assert_eq!(r.h, 1080.0 - 100.0);
        assert_eq!(r.x, (1920.0 - 480.0) / 2.0);
    }

    #[test]
    fn it_works_inside_the_usable_area_not_the_whole_screen() {
        // A 1080 screen with a 48 px taskbar at the bottom and a 25 px menu bar on top.
        let area = Rect {
            x: 0.0,
            y: 25.0,
            w: 1920.0,
            h: 1080.0 - 48.0 - 25.0,
        };
        let r = default_rect(area, false);
        assert_eq!(r.y, 25.0 + 50.0);
        assert_eq!(r.y + r.h + 50.0, 25.0 + area.h, "50 px left under it too");
        // A taskbar on the left shifts the area right; the window centres in what is left.
        let side = Rect {
            x: 64.0,
            y: 0.0,
            w: 1856.0,
            h: 1080.0,
        };
        let r = default_rect(side, false);
        assert!(r.x >= 64.0 && r.x + r.w <= 1920.0);
    }

    #[test]
    fn it_scales_with_the_resolution_in_logical_pixels() {
        // 4K at 200% scaling is 1920x1080 logical, so the same window as a plain 1080 screen.
        assert_eq!(default_rect(FHD, false), default_rect(FHD, false));
        let qhd = Rect {
            x: 0.0,
            y: 0.0,
            w: 2560.0,
            h: 1440.0,
        };
        assert_eq!(default_rect(qhd, false).h, 1340.0);
        let big = Rect {
            x: 0.0,
            y: 0.0,
            w: 3840.0,
            h: 2160.0,
        };
        let r = default_rect(big, false);
        assert_eq!(r.h, 1400.0, "never absurdly tall");
        assert_eq!(
            r.y,
            50.0 + (2060.0 - 1400.0) / 2.0,
            "and centred in the room it has"
        );
    }

    #[test]
    fn small_screens_get_a_usable_window() {
        let small = Rect {
            x: 0.0,
            y: 0.0,
            w: 1366.0,
            h: 600.0,
        };
        let r = default_rect(small, false);
        assert_eq!(r.h, 500.0);
        let tiny = Rect {
            x: 0.0,
            y: 0.0,
            w: 340.0,
            h: 300.0,
        };
        let r = default_rect(tiny, false);
        assert!(r.w <= 340.0 && r.h <= 300.0, "never bigger than the screen");
    }

    #[test]
    fn when_the_system_cannot_say_where_the_panels_are_it_leaves_more_room_below() {
        let r = default_rect(FHD, true);
        assert_eq!(r.y, 50.0);
        assert_eq!(r.h, 1080.0 - 50.0 - 90.0);
    }

    #[test]
    fn a_remembered_position_is_kept_only_if_it_is_still_on_screen() {
        let ok = Rect {
            x: 100.0,
            y: 60.0,
            w: 480.0,
            h: 900.0,
        };
        assert!(fits(ok, FHD));
        let too_tall = Rect { h: 1200.0, ..ok };
        assert!(!fits(too_tall, FHD));
        let gone = Rect { x: 2500.0, ..ok };
        assert!(!fits(gone, FHD), "was on a monitor that is gone");
        let off_top = Rect { y: -30.0, ..ok };
        assert!(!fits(off_top, FHD));
    }
}
