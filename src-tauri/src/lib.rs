use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

const FFL_STORE_DATA_LEN: usize = 96;
const SWITCH_CHAR_INFO_LEN: usize = 88;
const STUDIO_RAW_LEN: usize = 46;
const STUDIO_ENCODED_LEN: usize = 47;
const LEGACY_MIIC_DATA_LENS: &[usize] = &[104, 106, 108];
const CURRENT_MIIC_DATA_LEN: usize = 128;
const RENDERER_IMAGE_URL: &str = "http://127.0.0.1:5000/miis/image.png";
const RENDERER_GLB_URL: &str = "http://127.0.0.1:5000/miis/image.glb";
const ALL_FFL_EXPRESSIONS: &str = "0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18";

#[derive(serde::Serialize)]
struct RendererStatus {
    reachable: bool,
    message: String,
}

#[derive(Default)]
struct RenderCache {
    glb_by_hash: Mutex<HashMap<String, Vec<u8>>>,
    png_by_hash: Mutex<HashMap<String, Vec<u8>>>,
}

type SharedRenderCache = Arc<RenderCache>;

#[derive(Debug)]
struct RendererPayload {
    bytes: Vec<u8>,
    verify_char_info: bool,
}

#[tauri::command]
async fn render_mii_png(
    mii_bytes: Vec<u8>,
    cache: tauri::State<'_, SharedRenderCache>,
) -> Result<Vec<u8>, String> {
    let renderer_payload = normalize_mii_data_for_renderer(&mii_bytes)?;
    let cache_key = renderer_cache_key(&renderer_payload);

    if let Some(cached_png) = cache
        .png_by_hash
        .lock()
        .map_err(|_| "Render cache lock failed".to_string())?
        .get(&cache_key)
        .cloned()
    {
        println!(
            "render_mii_png: cache hit input_len={} renderer_len={} verify_char_info={} sha256={cache_key}",
            mii_bytes.len(),
            renderer_payload.bytes.len(),
            renderer_payload.verify_char_info
        );
        return Ok(cached_png);
    }

    let hex_data = hex_encode(&renderer_payload.bytes);
    let verify_char_info = if renderer_payload.verify_char_info {
        "1"
    } else {
        "0"
    };
    println!(
        "render_mii_png: requesting PNG input_len={} renderer_len={} verify_char_info={} sha256={cache_key} url={RENDERER_IMAGE_URL}",
        mii_bytes.len(),
        renderer_payload.bytes.len(),
        renderer_payload.verify_char_info
    );

    let client = reqwest::Client::new();
    let response = client
        .get(RENDERER_IMAGE_URL)
        .query(&[
            ("data", hex_data.as_str()),
            ("verifyCharInfo", verify_char_info),
        ])
        .send()
        .await
        .map_err(|error| format!("Could not reach FFL renderer on port 5000: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|error| format!("Could not read renderer error body: {error}"));
        eprintln!(
            "render_mii_png: renderer rejected request input_len={} renderer_len={} sha256={cache_key} status={status} body={body}",
            mii_bytes.len(),
            renderer_payload.bytes.len()
        );

        return Err(format!(
            "FFL renderer rejected the avatar data with HTTP {status}. Renderer said: {}",
            compact_error_body(&body)
        ));
    }

    let png_bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read renderer response: {error}"))?
        .to_vec();

    if !png_bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        eprintln!(
            "render_mii_png: renderer returned non-PNG input_len={} renderer_len={} sha256={cache_key} response_bytes={}",
            mii_bytes.len(),
            renderer_payload.bytes.len(),
            png_bytes.len()
        );
        return Err("Renderer response was not a PNG image".to_string());
    }

    println!(
        "render_mii_png: renderer returned PNG input_len={} renderer_len={} sha256={cache_key} response_bytes={}",
        mii_bytes.len(),
        renderer_payload.bytes.len(),
        png_bytes.len()
    );

    cache
        .png_by_hash
        .lock()
        .map_err(|_| "Render cache lock failed".to_string())?
        .insert(cache_key, png_bytes.clone());

    Ok(png_bytes)
}

#[tauri::command]
async fn render_mii_glb(
    mii_bytes: Vec<u8>,
    cache: tauri::State<'_, SharedRenderCache>,
) -> Result<Vec<u8>, String> {
    let renderer_payload = normalize_mii_data_for_renderer(&mii_bytes)?;
    let cache_key = renderer_cache_key(&renderer_payload);

    if let Some(cached_glb) = cache
        .glb_by_hash
        .lock()
        .map_err(|_| "Render cache lock failed".to_string())?
        .get(&cache_key)
        .cloned()
    {
        println!(
            "render_mii_glb: cache hit input_len={} renderer_len={} verify_char_info={} sha256={cache_key}",
            mii_bytes.len(),
            renderer_payload.bytes.len(),
            renderer_payload.verify_char_info
        );
        return Ok(cached_glb);
    }

    let glb_bytes = fetch_renderer_bytes(
        RENDERER_GLB_URL,
        &renderer_payload,
        &[
            ("expression", ALL_FFL_EXPRESSIONS),
            ("shaderType", "wiiu"),
            ("type", "face"),
            ("width", "512"),
            ("height", "512"),
        ],
        mii_bytes.len(),
        "GLB",
        &cache_key,
    )
    .await?;

    if !glb_bytes.starts_with(b"glTF") {
        eprintln!(
            "render_mii_glb: renderer returned non-GLB input_len={} renderer_len={} sha256={cache_key} response_bytes={}",
            mii_bytes.len(),
            renderer_payload.bytes.len(),
            glb_bytes.len()
        );
        return Err("Renderer response was not a GLB model".to_string());
    }

    println!(
        "render_mii_glb: renderer returned GLB input_len={} renderer_len={} sha256={cache_key} response_bytes={}",
        mii_bytes.len(),
        renderer_payload.bytes.len(),
        glb_bytes.len()
    );

    cache
        .glb_by_hash
        .lock()
        .map_err(|_| "Render cache lock failed".to_string())?
        .insert(cache_key, glb_bytes.clone());

    Ok(glb_bytes)
}

#[tauri::command]
async fn check_renderer_status() -> RendererStatus {
    let client = reqwest::Client::new();
    let result = client
        .get(RENDERER_IMAGE_URL)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await;

    match result {
        Ok(response) => RendererStatus {
            reachable: true,
            message: format!(
                "FFL renderer is reachable on port 5000 ({})",
                response.status()
            ),
        },
        Err(error) => RendererStatus {
            reachable: false,
            message: format!("FFL renderer is not reachable on port 5000: {error}"),
        },
    }
}

fn compact_error_body(body: &str) -> String {
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");

    if compact.len() > 500 {
        format!("{}...", &compact[..500])
    } else if compact.is_empty() {
        "(empty response body)".to_string()
    } else {
        compact
    }
}

fn renderer_cache_key(renderer_payload: &RendererPayload) -> String {
    let mut hasher = Sha256::new();
    hasher.update(&renderer_payload.bytes);
    hasher.update([renderer_payload.verify_char_info as u8]);
    let hash = hasher.finalize();

    format!("{hash:x}")
}

async fn fetch_renderer_bytes(
    url: &str,
    renderer_payload: &RendererPayload,
    extra_query: &[(&str, &str)],
    input_len: usize,
    output_label: &str,
    cache_key: &str,
) -> Result<Vec<u8>, String> {
    let hex_data = hex_encode(&renderer_payload.bytes);
    let verify_char_info = if renderer_payload.verify_char_info {
        "1"
    } else {
        "0"
    };
    println!(
        "fetch_renderer_bytes: requesting {output_label} input_len={} renderer_len={} verify_char_info={} sha256={cache_key} url={url}",
        input_len,
        renderer_payload.bytes.len(),
        renderer_payload.verify_char_info
    );

    let client = reqwest::Client::new();
    let mut query = vec![
        ("data", hex_data.as_str()),
        ("verifyCharInfo", verify_char_info),
    ];
    query.extend(extra_query.iter().copied());

    let response = client
        .get(url)
        .query(&query)
        .send()
        .await
        .map_err(|error| format!("Could not reach FFL renderer on port 5000: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|error| format!("Could not read renderer error body: {error}"));
        eprintln!(
            "fetch_renderer_bytes: renderer rejected request input_len={} renderer_len={} sha256={cache_key} status={status} body={body}",
            input_len,
            renderer_payload.bytes.len()
        );

        return Err(format!(
            "FFL renderer rejected the avatar data with HTTP {status}. Renderer said: {}",
            compact_error_body(&body)
        ));
    }

    response
        .bytes()
        .await
        .map_err(|error| format!("Could not read renderer response: {error}"))
        .map(|bytes| bytes.to_vec())
}

fn normalize_mii_data_for_renderer(bytes: &[u8]) -> Result<RendererPayload, String> {
    match bytes.len() {
        FFL_STORE_DATA_LEN | SWITCH_CHAR_INFO_LEN | STUDIO_RAW_LEN | STUDIO_ENCODED_LEN => Ok(RendererPayload {
            bytes: bytes.to_vec(),
            verify_char_info: true,
        }),
        len if LEGACY_MIIC_DATA_LENS.contains(&len) => {
            println!("normalize_mii_data_for_renderer: converting legacy .miic input len={len} to 96-byte FFSD payload");
            Ok(RendererPayload {
                bytes: miic_to_ffsd_payload(bytes),
                verify_char_info: true,
            })
        }
        CURRENT_MIIC_DATA_LEN => Err(
            "This 128-byte .miic file is the current Mii Creator v4 format. The local renderer cannot read it directly, and the public legacy decoder renders this sample incorrectly. Export this avatar as .ffsd or Mii Studio/CharInfo data, or add a real v4 .miic converter before rendering it.".to_string()
        ),
        actual_len => Err(format!(
            "Unsupported avatar data length: expected {FFL_STORE_DATA_LEN} bytes for FFSD, {SWITCH_CHAR_INFO_LEN} bytes for Switch CharInfo, {STUDIO_RAW_LEN}/{STUDIO_ENCODED_LEN} bytes for Studio data, or legacy .miic extended FFSD data ({:?} bytes), got {actual_len} bytes",
            LEGACY_MIIC_DATA_LENS
        )),
    }
}

fn miic_to_ffsd_payload(bytes: &[u8]) -> Vec<u8> {
    let mut ffsd = bytes[..FFL_STORE_DATA_LEN].to_vec();
    let crc = calculate_ffsd_crc16(&ffsd);

    ffsd[94] = (crc >> 8) as u8;
    ffsd[95] = (crc & 0xff) as u8;

    ffsd
}

fn calculate_ffsd_crc16(bytes: &[u8]) -> u16 {
    let mut crc = 0u32;

    for byte in &bytes[..94] {
        for bit in (0..=7).rev() {
            let flag = (crc & 0x8000) != 0;
            crc = (crc << 1) | ((byte >> bit) & 1) as u32;

            if flag {
                crc ^= 0x1021;
            }
        }
    }

    for _ in 0..16 {
        let flag = (crc & 0x8000) != 0;
        crc <<= 1;

        if flag {
            crc ^= 0x1021;
        }
    }

    (crc & 0xffff) as u16
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::{
        calculate_ffsd_crc16, hex_encode, normalize_mii_data_for_renderer, FFL_STORE_DATA_LEN,
        LEGACY_MIIC_DATA_LENS, STUDIO_ENCODED_LEN, STUDIO_RAW_LEN, SWITCH_CHAR_INFO_LEN,
    };

    #[test]
    fn accepts_supported_mii_data_lengths() {
        let ffsd = normalize_mii_data_for_renderer(&vec![0; FFL_STORE_DATA_LEN]).unwrap();
        let switch_char_info =
            normalize_mii_data_for_renderer(&vec![0; SWITCH_CHAR_INFO_LEN]).unwrap();
        let studio_raw = normalize_mii_data_for_renderer(&vec![0; STUDIO_RAW_LEN]).unwrap();
        let studio_encoded = normalize_mii_data_for_renderer(&vec![0; STUDIO_ENCODED_LEN]).unwrap();

        assert!(ffsd.verify_char_info);
        assert!(switch_char_info.verify_char_info);
        assert!(studio_raw.verify_char_info);
        assert!(studio_encoded.verify_char_info);
    }

    #[test]
    fn converts_legacy_miic_like_data_to_ffsd_payload() {
        for len in LEGACY_MIIC_DATA_LENS {
            let input = vec![7; *len];
            let renderer_payload = normalize_mii_data_for_renderer(&input).unwrap();

            assert_eq!(renderer_payload.bytes.len(), FFL_STORE_DATA_LEN);
            assert!(renderer_payload.verify_char_info);
            assert_eq!(&renderer_payload.bytes[..94], vec![7; 94]);
            assert_ne!(&renderer_payload.bytes[94..], &[7, 7]);
        }
    }

    #[test]
    fn conversion_rewrites_ffsd_crc16() {
        let mut input = vec![7; 108];
        input[94] = 0;
        input[95] = 0;

        let renderer_payload = normalize_mii_data_for_renderer(&input).unwrap();
        let crc = calculate_ffsd_crc16(&renderer_payload.bytes);

        assert_eq!(renderer_payload.bytes[94], (crc >> 8) as u8);
        assert_eq!(renderer_payload.bytes[95], (crc & 0xff) as u8);
    }

    #[test]
    fn rejects_unsupported_mii_data_lengths() {
        assert!(normalize_mii_data_for_renderer(&vec![0; FFL_STORE_DATA_LEN - 1]).is_err());
        assert!(normalize_mii_data_for_renderer(&vec![0; FFL_STORE_DATA_LEN + 1]).is_err());
    }

    #[test]
    fn rejects_current_miic_v4_until_converter_exists() {
        let error = normalize_mii_data_for_renderer(&vec![0; 128]).unwrap_err();

        assert!(error.contains("128-byte .miic"));
        assert!(error.contains("Mii Creator v4"));
        assert!(error.contains("real v4 .miic converter"));
    }

    #[test]
    fn hex_encodes_bytes_for_renderer_query_param() {
        assert_eq!(hex_encode(&[0x00, 0x0f, 0xa4, 0xff]), "000fa4ff");
    }

    #[test]
    fn compacts_renderer_error_body() {
        assert_eq!(super::compact_error_body("bad\n\nrequest"), "bad request");
        assert_eq!(super::compact_error_body("   "), "(empty response body)");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SharedRenderCache::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_renderer_status,
            render_mii_glb,
            render_mii_png
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
