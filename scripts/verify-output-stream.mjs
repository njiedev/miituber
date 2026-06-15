const DEFAULT_BASE_URL = "http://127.0.0.1:49321";
const DEFAULT_FRAME_COUNT = 3;
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const unknownFlag = args.find(
  (arg) =>
    arg.startsWith("--") &&
    arg !== "--transparent" &&
    !arg.startsWith("--min-fps="),
);
if (unknownFlag) {
  console.error(`Unknown option: ${unknownFlag}`);
  printHelp();
  process.exit(1);
}

const transparent = args.includes("--transparent");
const minFps = parseMinFps(args.find((arg) => arg.startsWith("--min-fps=")));
const positionalArgs = args.filter((arg) => !arg.startsWith("--"));
const baseUrl = (positionalArgs[0] ?? DEFAULT_BASE_URL).replace(/\/$/, "");
const frameCount = parsePositiveInteger(positionalArgs[1], DEFAULT_FRAME_COUNT);

try {
  const latestFrame = await fetchLatestFrame(`${baseUrl}/frame.jpg`);
  const mjpegFrames = await fetchMjpegFrames(`${baseUrl}/stream.mjpeg`, frameCount);
  const transparentFrame = transparent
    ? await fetchTransparentFrame(`${baseUrl}/frame.png`)
    : null;
  const transparentSource = transparent
    ? await fetchTransparentSource(`${baseUrl}/source-transparent.html`)
    : null;

  console.log(
    JSON.stringify(
      {
        baseUrl,
        minFps,
        latestFrame,
        mjpegFrames,
        transparentFrame,
        transparentSource,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Output stream verification failed: ${message}`);
  console.error(
    "Start the Tauri app, load an avatar, click Start Output, then run this command again.",
  );
  process.exitCode = 1;
}

async function fetchLatestFrame(url) {
  const response = await fetchWithTimeout(url, 3000);
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (!response.ok) {
    throw new Error(
      `/frame.jpg returned HTTP ${response.status}: ${new TextDecoder().decode(bytes)}`,
    );
  }

  assertContentType(response, "image/jpeg", "/frame.jpg");
  assertJpeg(bytes, "/frame.jpg");

  return {
    url,
    bytes: bytes.length,
  };
}

async function fetchMjpegFrames(url, targetFrameCount) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const response = await fetch(url, { signal: controller.signal });

  try {
    if (!response.ok) {
      throw new Error(`/stream.mjpeg returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!contentType.includes("multipart/x-mixed-replace") || !boundaryMatch) {
      throw new Error(`/stream.mjpeg returned unexpected Content-Type: ${contentType}`);
    }

    const boundary = `--${boundaryMatch[1].replace(/^"|"$/g, "")}`;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("/stream.mjpeg did not provide a readable body");

    let buffer = new Uint8Array();
    const frames = [];
    const frameTimes = [];

    while (frames.length < targetFrameCount) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = concatBytes(buffer, value);
      const parsed = parseMjpegBuffer(buffer, boundary);
      buffer = parsed.remaining;
      for (const frame of parsed.frames) {
        frames.push(frame);
        frameTimes.push(performance.now());
      }
    }

    if (frames.length < targetFrameCount) {
      throw new Error(
        `/stream.mjpeg ended after ${frames.length} frame(s), expected ${targetFrameCount}`,
      );
    }

    const sampledFrames = frames.slice(0, targetFrameCount);
    const sampledFrameTimes = frameTimes.slice(0, targetFrameCount);
    const elapsedMs =
      sampledFrameTimes.length > 1
        ? sampledFrameTimes[sampledFrameTimes.length - 1] - sampledFrameTimes[0]
        : 0;
    const observedFps =
      elapsedMs > 0 ? ((sampledFrameTimes.length - 1) * 1000) / elapsedMs : null;
    const roundedObservedFps =
      observedFps === null ? null : Number(observedFps.toFixed(1));

    if (minFps !== null && (roundedObservedFps === null || roundedObservedFps < minFps)) {
      throw new Error(
        `/stream.mjpeg observed ${roundedObservedFps ?? "unknown"} fps, below minimum ${minFps} fps`,
      );
    }

    return {
      count: sampledFrames.length,
      observedFps: roundedObservedFps,
      frames: sampledFrames.map((frame, index) => {
        assertJpeg(frame, `/stream.mjpeg frame ${index + 1}`);
        return {
          index: index + 1,
          bytes: frame.length,
        };
      }),
    };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function fetchTransparentFrame(url) {
  const response = await fetchWithTimeout(url, 3000);
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (!response.ok) {
    throw new Error(
      `/frame.png returned HTTP ${response.status}: ${new TextDecoder().decode(bytes)}`,
    );
  }

  assertContentType(response, "image/png", "/frame.png");
  assertPng(bytes, "/frame.png");
  const alphaInfo = pngAlphaInfo(bytes);
  if (!alphaInfo.supportsAlpha) {
    throw new Error(`/frame.png is PNG, but not alpha-capable: ${alphaInfo.reason}`);
  }

  return {
    url,
    bytes: bytes.length,
    alpha: alphaInfo.reason,
  };
}

async function fetchTransparentSource(url) {
  const response = await fetchWithTimeout(url, 3000);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`/source-transparent.html returned HTTP ${response.status}: ${text}`);
  }

  assertContentType(response, "text/html", "/source-transparent.html");
  if (!text.includes("/frame.png")) {
    throw new Error("/source-transparent.html does not reference /frame.png");
  }

  return {
    url,
    bytes: new TextEncoder().encode(text).length,
  };
}

function parseMjpegBuffer(buffer, boundary) {
  const text = new TextDecoder("latin1").decode(buffer);
  const frames = [];
  let cursor = 0;

  while (true) {
    const boundaryIndex = text.indexOf(boundary, cursor);
    if (boundaryIndex === -1) break;

    const headerStart = boundaryIndex + boundary.length + 2;
    const headerEnd = text.indexOf("\r\n\r\n", headerStart);
    if (headerEnd === -1) break;

    const header = text.slice(headerStart, headerEnd);
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!/Content-Type:\s*image\/jpeg/i.test(header) || !lengthMatch) {
      throw new Error(`/stream.mjpeg emitted invalid part header: ${header}`);
    }

    const contentLength = Number(lengthMatch[1]);
    const frameStart = headerEnd + 4;
    const frameEnd = frameStart + contentLength;
    if (buffer.length < frameEnd + 2) break;

    frames.push(buffer.slice(frameStart, frameEnd));
    cursor = frameEnd + 2;
  }

  return {
    frames,
    remaining: buffer.slice(cursor),
  };
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function assertContentType(response, expected, label) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes(expected)) {
    throw new Error(`${label} returned unexpected Content-Type: ${contentType}`);
  }
}

function assertJpeg(bytes, label) {
  const isJpeg = JPEG_MAGIC.every((byte, index) => bytes[index] === byte);
  if (!isJpeg) {
    throw new Error(`${label} was not a JPEG. First bytes: ${hex(bytes.slice(0, 8))}`);
  }
}

function assertPng(bytes, label) {
  const isPng = PNG_MAGIC.every((byte, index) => bytes[index] === byte);
  if (!isPng) {
    throw new Error(`${label} was not a PNG. First bytes: ${hex(bytes.slice(0, 8))}`);
  }
}

function pngAlphaInfo(bytes) {
  let offset = PNG_MAGIC.length;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = ascii(bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;

    if (type === "IHDR") {
      const colorType = bytes[dataStart + 9];
      if (colorType === 4 || colorType === 6) {
        return { supportsAlpha: true, reason: `IHDR color type ${colorType}` };
      }
    }

    if (type === "tRNS") {
      return { supportsAlpha: true, reason: "tRNS transparency chunk" };
    }

    offset = dataEnd + 4;
  }

  return {
    supportsAlpha: false,
    reason: "no alpha color type or tRNS chunk found",
  };
}

function readUint32(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function ascii(bytes) {
  return String.fromCharCode(...bytes);
}

function concatBytes(left, right) {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseMinFps(value) {
  if (!value) return null;

  const parsed = Number(value.slice("--min-fps=".length));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Invalid --min-fps value: ${value}`);
    printHelp();
    process.exit(1);
  }

  return parsed;
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function printHelp() {
  console.log(`Usage:
  npm run verify:output-stream
  npm run verify:output-stream -- --transparent
  npm run verify:output-stream -- <baseUrl> <frameCount>
  npm run verify:output-stream -- <baseUrl> <frameCount> --transparent
  npm run verify:output-stream -- <baseUrl> <frameCount> --min-fps=24

Defaults:
  baseUrl: ${DEFAULT_BASE_URL}
  frameCount: ${DEFAULT_FRAME_COUNT}

Checks:
  /frame.jpg is a JPEG
  /stream.mjpeg emits the requested number of JPEG parts and reports observed FPS
  --min-fps=N fails if observed MJPEG FPS is below N
  --transparent also checks /frame.png is alpha-capable and /source-transparent.html references it
`);
}
