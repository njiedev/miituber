import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const expectedFiles = [
  "portrait-normal-closed.png",
  "portrait-normal-open.png",
  "portrait-happy-closed.png",
  "portrait-happy-open.png",
  "portrait-surprised-closed.png",
  "portrait-surprised-open.png",
  "portrait-sad-closed.png",
  "portrait-sad-open.png",
  "portrait-wink-closed.png",
  "portrait-wink-open.png",
];

const minPngBytes = 3 * 1024;
const captureTimeoutMs = 120_000;
const edgeFlagAttempts = [
  // Headed with the real GPU. Headless + swiftshader never produced a
  // working WebGL2 context on this machine (both attempts hung, 2026-07-05).
  ["--window-size=900,700"],
];

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out connecting to Edge CDP.")),
        15_000,
      );
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Failed to connect to Edge CDP."));
      });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(
              `${pending.method} failed: ${
                message.error.message ?? JSON.stringify(message.error)
              }`,
            ),
          );
        } else {
          pending.resolve(message.result ?? {});
        }
        return;
      }

      if (message.method) {
        const listeners = this.listeners.get(message.method);
        if (listeners) {
          for (const listener of listeners) listener(message);
        }
      }
    });
  }

  call(method, params = {}, sessionId, timeoutMs = 15_000) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  close() {
    this.ws?.close();
  }
}

async function main() {
  const meePath = path.join(repoRoot, "mee.ffsd");
  if (!existsSync(meePath)) {
    throw new Error(`Missing ${meePath}`);
  }

  const edgePath = edgeCandidates.find((candidate) => existsSync(candidate));
  if (!edgePath) {
    throw new Error(`Could not find Edge. Checked: ${edgeCandidates.join(", ")}`);
  }

  const server = await startViteServer();
  console.log(`Vite dev server: http://localhost:${server.port}/`);

  let lastError;
  try {
    for (let index = 0; index < edgeFlagAttempts.length; index += 1) {
      const attempt = index + 1;
      try {
        const result = await runCaptureAttempt({
          attempt,
          edgePath,
          flags: edgeFlagAttempts[index],
          meePath,
          vitePort: server.port,
        });
        await moveToPublicTour(result.downloadDir);
        await verifyPublicTour();
        return;
      } catch (error) {
        lastError = error;
        console.error(`Attempt ${attempt} failed: ${formatError(error)}`);
      }
    }
  } finally {
    killProcessTree(server.child.pid);
  }

  throw new Error(
    `Headless portrait capture failed after ${edgeFlagAttempts.length} flag attempts. Last error: ${formatError(
      lastError,
    )}`,
  );
}

async function startViteServer() {
  const child = spawn(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/s", "/c", "npm.cmd run dev -- --configLoader runner"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CI: "1",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let output = "";
  const append = (chunk) => {
    output += stripAnsi(String(chunk));
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for Vite port.\n${output}`));
    }, 30_000);

    const onData = () => {
      const match = output.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)\//);
      if (match) {
        cleanup();
        resolve(Number(match[1]));
      }
    };

    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `Vite exited before serving. code=${code} signal=${signal}\n${output}`,
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", onExit);
    onData();
  });

  return { child, port };
}

async function runCaptureAttempt({ attempt, edgePath, flags, meePath, vitePort }) {
  const debugPort = await getFreePort();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "miituber-edge-"));
  const downloadDir = await mkdtemp(path.join(repoRoot, ".portrait-downloads-"));
  let browser;
  let edge;
  let edgeStderr = "";

  try {
    console.log(`Capture attempt ${attempt}: launching Edge on CDP port ${debugPort}`);
    edge = spawn(
      edgePath,
      [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-dev-shm-usage",
        ...flags,
        "about:blank",
      ],
      {
        cwd: repoRoot,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );

    edge.stderr.on("data", (chunk) => {
      edgeStderr += String(chunk);
    });

    const wsUrl = await waitForBrowserWebSocket(debugPort, edge);
    browser = new CdpClient(wsUrl);
    await browser.connect();
    console.log(`Capture attempt ${attempt}: connected to Edge CDP`);

    const consoleMessages = [];
    browser.on("Runtime.consoleAPICalled", (message) => {
      consoleMessages.push(JSON.stringify(message.params));
    });
    browser.on("Runtime.exceptionThrown", (message) => {
      consoleMessages.push(JSON.stringify(message.params.exceptionDetails));
    });

    await allowDownloads(browser, downloadDir);
    console.log(`Capture attempt ${attempt}: downloads directed to ${downloadDir}`);

    const { targetId } = await browser.call("Target.createTarget", {
      url: "about:blank",
    });
    console.log(`Capture attempt ${attempt}: created browser target ${targetId}`);
    const { sessionId } = await browser.call("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    console.log(`Capture attempt ${attempt}: attached to target`);

    await browser.call("Runtime.enable", {}, sessionId);
    await browser.call("Page.enable", {}, sessionId);
    await browser.call("DOM.enable", {}, sessionId);

    const pageDownloadFallback = browser
      .call(
        "Page.setDownloadBehavior",
        { behavior: "allow", downloadPath: downloadDir },
        sessionId,
      )
      .catch(() => {});
    await pageDownloadFallback;

    const url = `http://localhost:${vitePort}/?capture-portraits`;
    await browser.call("Page.navigate", { url }, sessionId);
    await waitForExpression(
      browser,
      sessionId,
      // index.html ships its own static file inputs (#load-profile-input,
      // #mii-file); the capture module replaces the whole body once its
      // dynamic import resolves. Wait for the capture UI's marker text so we
      // don't inject into an app input that is about to be discarded.
      "document.body.innerText.includes('Tour portrait capture') && !!document.querySelector('input[type=file]')",
      30_000,
      "portrait capture page",
    );
    console.log(`Capture attempt ${attempt}: capture page loaded`);

    // DOM.setFileInputFiles proved unreliable here (files never populated,
    // change never fired). mee.ffsd is 96 bytes, so inject it directly:
    // rebuild a real File in the page and dispatch change ourselves.
    const meeBase64 = (await readFile(meePath)).toString("base64");
    const uploadResult = await browser.call(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const input = document.querySelector('input[type=file]');
          if (!input) return 'error: no file input';
          const bytes = Uint8Array.from(atob(${JSON.stringify(
            meeBase64,
          )}), (c) => c.charCodeAt(0));
          const dt = new DataTransfer();
          dt.items.add(new File([bytes], 'mee.ffsd'));
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return 'ok: ' + input.files.length + ' file(s), ' + bytes.length + ' bytes';
        })()`,
        returnByValue: true,
      },
      sessionId,
    );
    if (uploadResult.exceptionDetails) {
      throw new Error(
        `File injection threw: ${JSON.stringify(uploadResult.exceptionDetails)}`,
      );
    }
    const uploadStatus = String(uploadResult.result?.value ?? "no result");
    if (!uploadStatus.startsWith("ok:")) {
      throw new Error(`File injection failed: ${uploadStatus}`);
    }
    console.log(`Capture attempt ${attempt}: injected mee.ffsd (${uploadStatus})`);

    await waitForCaptureDone(browser, sessionId, consoleMessages);
    console.log(`Capture attempt ${attempt}: page reported Done`);
    await waitForExpectedDownloads(downloadDir);
    await verifyDownloadDir(downloadDir);
    console.log(`Capture attempt ${attempt} wrote PNGs to ${downloadDir}`);
    return { downloadDir };
  } catch (error) {
    await rm(downloadDir, { recursive: true, force: true }).catch(() => {});
    const details = [formatError(error)];
    if (edge?.exitCode !== null) {
      details.push(`Edge exited with code ${edge.exitCode}`);
    }
    if (edgeStderr.trim()) {
      details.push(`Edge stderr:\n${edgeStderr.trim()}`);
    }
    if (edgeStderrHasWebGl(error)) {
      details.push("WebGL-related failure detected.");
    }
    throw new Error(details.join("\n"));
  } finally {
    browser?.close();
    if (edge?.pid) killProcessTree(edge.pid);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function allowDownloads(browser, downloadDir) {
  try {
    await browser.call("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDir,
      eventsEnabled: true,
    });
  } catch {
    await browser.call("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDir,
    });
  }
}

async function waitForCaptureDone(browser, sessionId, consoleMessages) {
  const started = Date.now();
  while (Date.now() - started < captureTimeoutMs) {
    const text = await readPageText(browser, sessionId);
    if (text.includes("Portrait capture failed:")) {
      throw new Error(`${text}\nConsole: ${consoleMessages.join("\n")}`);
    }
    if (text.includes("Done. Move the downloaded PNGs into public/tour/.")) {
      return;
    }
    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for Done status. Last page text: ${await readPageText(
      browser,
      sessionId,
    )}\nConsole: ${consoleMessages.join("\n")}`,
  );
}

async function readPageText(browser, sessionId) {
  const result = await browser.call(
    "Runtime.evaluate",
    {
      expression: "document.body?.innerText || ''",
      returnByValue: true,
    },
    sessionId,
  );
  return String(result.result?.value ?? "");
}

async function waitForExpression(
  browser,
  sessionId,
  expression,
  timeoutMs,
  label,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await browser.call(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      sessionId,
    );
    if (result.result?.value) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForExpectedDownloads(downloadDir) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const entries = await readdir(downloadDir);
    const hasCrdownload = entries.some((entry) => entry.endsWith(".crdownload"));
    const hasAll = expectedFiles.every((file) => entries.includes(file));
    if (hasAll && !hasCrdownload) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for all downloads in ${downloadDir}.`);
}

async function verifyDownloadDir(downloadDir) {
  const entries = await readdir(downloadDir);
  const pngs = entries.filter((entry) => entry.endsWith(".png")).sort();
  if (pngs.length !== expectedFiles.length) {
    throw new Error(
      `Expected ${expectedFiles.length} PNGs, found ${pngs.length}: ${pngs.join(
        ", ",
      )}`,
    );
  }

  const missing = expectedFiles.filter((file) => !pngs.includes(file));
  if (missing.length) {
    throw new Error(`Missing PNGs: ${missing.join(", ")}`);
  }

  const tooSmall = [];
  for (const file of expectedFiles) {
    const size = (await stat(path.join(downloadDir, file))).size;
    if (size <= minPngBytes) tooSmall.push(`${file} (${size} bytes)`);
  }
  if (tooSmall.length) {
    throw new Error(`PNG render failed, files under 3 KB: ${tooSmall.join(", ")}`);
  }
}

async function moveToPublicTour(downloadDir) {
  const publicTour = path.join(repoRoot, "public", "tour");
  await mkdir(publicTour, { recursive: true });
  for (const file of expectedFiles) {
    const destination = path.join(publicTour, file);
    await rm(destination, { force: true });
    await rename(path.join(downloadDir, file), destination);
  }
  await rm(downloadDir, { recursive: true, force: true });
}

async function verifyPublicTour() {
  const publicTour = path.join(repoRoot, "public", "tour");
  const entries = (await readdir(publicTour)).filter((entry) =>
    /^portrait-(normal|happy|surprised|sad|wink)-(closed|open)\.png$/.test(entry),
  );
  entries.sort();

  if (entries.length !== expectedFiles.length) {
    throw new Error(
      `Expected exactly ${expectedFiles.length} matching tour PNGs, found ${
        entries.length
      }: ${entries.join(", ")}`,
    );
  }

  const lines = [];
  for (const file of expectedFiles) {
    const size = (await stat(path.join(publicTour, file))).size;
    if (size <= minPngBytes) {
      throw new Error(`${file} is under 3 KB after move (${size} bytes).`);
    }
    lines.push(`${file}\t${size}`);
  }
  console.log(lines.join("\n"));
}

async function waitForBrowserWebSocket(port, edge) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (edge.exitCode !== null) {
      throw new Error(`Edge exited before CDP was available. code=${edge.exitCode}`);
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 750);
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (response.ok) {
        const json = await response.json();
        if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
      }
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`Timed out waiting for Edge CDP on port ${port}.`);
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function killProcessTree(pid) {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function edgeStderrHasWebGl(error) {
  return /webgl|gpu|canvas/i.test(formatError(error));
}

function formatError(error) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
