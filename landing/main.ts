import "../src/styles.css";
import "./landing.css";
import { FFLExpression } from "../src/lib/types";
import { ensureReady, type FFLContext } from "../src/lib/fflRenderer";
import { MiiStage } from "./miiStage";
import meeUrl from "../mee.ffsd?url";

// Same bundled resources the app uses (see src/main.ts for the note about
// shipping a user-supplied .dat instead of redistributing this one).
const FFL_RESOURCE_URL = "/AFLResHigh_2_3.dat";
const FFL_WASM_URL = "/ffl-emscripten.wasm";

/**
 * Where waitlist signups go. Point this at a form backend (Formspree,
 * Buttondown, a worker…) that accepts `POST { email }` as JSON. While empty,
 * the form falls back to a prefilled signup email.
 */
const WAITLIST_ENDPOINT = "";
const WAITLIST_FALLBACK_EMAIL = "njiedoescs@gmail.com";

/**
 * Stylized extras beyond the app's face-driven 0..18 (see FFLExpression.MAX
 * = 70 in ffl.js). These must be listed here to be baked into the CharModel,
 * or setExpression() on them is a no-op warning.
 */
const EXTRA_EXPRESSIONS = {
  LoveOpenMouth: 26,
  Cry: 30,
  BigSmile: 32,
} as const;
/** The hover face for the waitlist button. */
const HOVER_EXPRESSION: number = EXTRA_EXPRESSIONS.LoveOpenMouth;
/** The signup-success celebration face. */
const SUCCESS_EXPRESSION: number = EXTRA_EXPRESSIONS.BigSmile;
/** The signup-failed face. */
const FAIL_EXPRESSION: number = EXTRA_EXPRESSIONS.Cry;

const canvas = document.querySelector<HTMLCanvasElement>("#mii-stage")!;
const placeholder = document.querySelector<HTMLElement>("#stage-placeholder")!;
const form = document.querySelector<HTMLFormElement>("#waitlist-form")!;
const emailInput = document.querySelector<HTMLInputElement>("#waitlist-email")!;
const joinButton = document.querySelector<HTMLButtonElement>("#waitlist-button")!;
const waitlistStatus = document.querySelector<HTMLElement>("#waitlist-status")!;

const stage = new MiiStage(canvas);

/** Expression state, lowest priority first. Blink/wink overlay whatever holds. */
let baseExpression: number = FFLExpression.Normal;
let overlayExpression: number | null = null;
let miiReady = false;
/**
 * While `performance.now() < resultHoldUntil`, a signup result face (happy /
 * sad) owns baseExpression and hover can't overwrite it. The button is still
 * hovered/focused right after a click, so without this a lingering hover event
 * would clobber the celebration the instant it appears.
 */
let resultHoldUntil = 0;
const RESULT_HOLD_MS = 2600;

function applyExpression() {
  if (!miiReady) return;
  stage.setExpression(overlayExpression ?? baseExpression);
}

function setWaitlistStatus(text: string, tone: "idle" | "success" | "error") {
  waitlistStatus.textContent = text;
  waitlistStatus.dataset.tone = tone;
}

// ---- Boot the in-process FFL renderer, same seam as the app ----

async function boot() {
  try {
    const [resource, miiBytes] = await Promise.all([
      fetch(FFL_RESOURCE_URL).then((r) => {
        if (!r.ok) throw new Error(`resource ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(meeUrl).then((r) => {
        if (!r.ok) throw new Error(`mii ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);

    const ffl: FFLContext = await ensureReady({
      resource,
      wasmUrl: FFL_WASM_URL,
    });
    await stage.load(
      new Uint8Array(miiBytes),
      ffl,
      Object.values(EXTRA_EXPRESSIONS),
    );

    miiReady = true;
    placeholder.hidden = true;
    startBlinking();

    // Dev-only pose/expression preview, e.g. ?pose=excited&expression=10
    const params = new URLSearchParams(window.location.search);
    if (params.get("pose") === "excited") {
      setExcited(true);
      stage.setExcited(true, true);
    }
    const expressionParam = Number(params.get("expression"));
    if (Number.isInteger(expressionParam) && params.has("expression")) {
      baseExpression = expressionParam;
      applyExpression();
    }
  } catch (error) {
    console.error("landing: failed to boot FFL stage", error);
    placeholder.textContent = "The Mii is napping. The waitlist still works.";
  }
}

// ---- Head follows the cursor ----

window.addEventListener("pointermove", (event) => {
  const head = stage.headScreenPosition();
  const rect = canvas.getBoundingClientRect();
  // Cursor offset from the head itself, so the Mii tracks you across the
  // whole page, not just inside its frame.
  const headX = rect.left + (head?.x ?? 0.5) * rect.width;
  const headY = rect.top + (head?.y ?? 0.35) * rect.height;
  const nx = (event.clientX - headX) / (window.innerWidth / 2);
  const ny = (event.clientY - headY) / (window.innerHeight / 2);
  stage.lookToward(nx * 1.6, ny * 1.6);
});

// ---- Idle blinks (skipped while an overlay expression holds) ----

function startBlinking() {
  const scheduleNext = () => {
    const delay = 2400 + Math.random() * 3200;
    window.setTimeout(() => {
      // Blink only from the neutral face — never interrupt excitement/winks.
      if (
        overlayExpression === null &&
        baseExpression === FFLExpression.Normal &&
        document.visibilityState === "visible"
      ) {
        stage.setExpression(FFLExpression.Blink);
        window.setTimeout(applyExpression, 130);
      }
      scheduleNext();
    }, delay);
  };
  scheduleNext();
}

// ---- Waitlist button hover: happy-shocked + arms up + hop ----

function setExcited(excited: boolean) {
  // Arms still track hover even mid-celebration; only the face is locked.
  stage.setExcited(excited);
  if (excited) stage.hop();
  if (performance.now() < resultHoldUntil) return;
  baseExpression = excited ? HOVER_EXPRESSION : FFLExpression.Normal;
  applyExpression();
}

/** Show a signup result face and hold it against hover for RESULT_HOLD_MS. */
function showResult(expression: number) {
  baseExpression = expression;
  resultHoldUntil = performance.now() + RESULT_HOLD_MS;
  applyExpression();
}

joinButton.addEventListener("pointerenter", () => setExcited(true));
joinButton.addEventListener("pointerleave", () => setExcited(false));
joinButton.addEventListener("focus", () => setExcited(true));
joinButton.addEventListener("blur", () => setExcited(false));

// ---- Easter egg: poke the Mii, get a wink and a head tilt ----

canvas.addEventListener("pointerdown", () => {
  if (!miiReady || overlayExpression !== null) return;
  overlayExpression = FFLExpression.WinkRight;
  stage.tiltHead(-12);
  applyExpression();
  window.setTimeout(() => {
    overlayExpression = null;
    stage.tiltHead(0);
    applyExpression();
  }, 650);
});

// ---- Waitlist form ----

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  if (!email || !emailInput.checkValidity()) {
    setWaitlistStatus("That email doesn't look right yet.", "error");
    emailInput.focus();
    return;
  }

  if (!WAITLIST_ENDPOINT) {
    // No backend wired up yet — hand off to a prefilled email instead of
    // pretending the signup landed somewhere.
    const subject = encodeURIComponent("MiiTuber waitlist");
    const body = encodeURIComponent(`Add me to the MiiTuber waitlist: ${email}`);
    window.location.href = `mailto:${WAITLIST_FALLBACK_EMAIL}?subject=${subject}&body=${body}`;
    setWaitlistStatus("Opening your email app to finish signing up…", "idle");
    return;
  }

  joinButton.disabled = true;
  setWaitlistStatus("Adding you to the list…", "idle");
  try {
    const response = await fetch(WAITLIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw new Error(`waitlist ${response.status}`);

    setWaitlistStatus("You're in! Watch your inbox.", "success");
    form.reset();
    // Celebrate: big smile and a hop, held against the lingering button hover.
    showResult(SUCCESS_EXPRESSION);
    stage.hop();
  } catch (error) {
    console.error("landing: waitlist signup failed", error);
    setWaitlistStatus("Signup didn't go through — try again in a bit.", "error");
    showResult(FAIL_EXPRESSION);
  } finally {
    joinButton.disabled = false;
  }
});

boot();
