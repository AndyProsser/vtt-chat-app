//! Reading a picture from the system clipboard for "paste a picture as a handout".
//!
//! The webview's own paste event is unreliable for images on some platforms (WebKitGTK especially),
//! so Rust reads the clipboard itself and hands the panel a PNG.

use base64::Engine;

/// RGBA pixels as a base64 PNG.
pub fn rgba_to_png_base64(width: u32, height: u32, rgba: &[u8]) -> Result<String, String> {
    if rgba.len() != (width as usize) * (height as usize) * 4 {
        return Err("the clipboard picture has an unexpected size".into());
    }
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

/// The picture on the clipboard as a base64 PNG, or `None` if there is none (or only text).
#[tauri::command]
pub async fn clipboard_picture() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        match clipboard.get_image() {
            Ok(image) => {
                rgba_to_png_base64(image.width as u32, image.height as u32, &image.bytes).map(Some)
            }
            // Text, nothing, or a format we cannot read: simply no picture.
            Err(_) => Ok(None),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgba_becomes_a_png_of_the_same_size() {
        let rgba: Vec<u8> = (0..2 * 3)
            .flat_map(|i| [i as u8 * 10, 0, 255, 255])
            .collect();
        let b64 = rgba_to_png_base64(2, 3, &rgba).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        let reader = decoder.read_info().unwrap();
        assert_eq!((reader.info().width, reader.info().height), (2, 3));
    }

    #[test]
    fn a_size_that_does_not_match_the_pixels_is_refused() {
        assert!(rgba_to_png_base64(2, 2, &[0; 7]).is_err());
        assert!(rgba_to_png_base64(0, 0, &[1]).is_err());
    }
}
