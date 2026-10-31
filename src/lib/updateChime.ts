export function createUpdateChime(isVisible: () => boolean) {
  let context: AudioContext | null = null;
  let pending = false;
  let playing = false;
  let cleanupTimer: number | undefined;
  const oscillators = new Set<OscillatorNode>();
  const nodes = new Set<AudioNode>();

  function clearListeners() {
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
  }

  function stop() {
    pending = false;
    playing = false;
    clearListeners();
    window.clearTimeout(cleanupTimer);
    for (const oscillator of oscillators) {
      try { oscillator.stop(); } catch {}
    }
    oscillators.clear();
    for (const node of nodes) node.disconnect();
    nodes.clear();
  }

  function sound() {
    if (!context || context.state !== "running" || !pending || !isVisible()) return;
    pending = false;
    playing = true;
    clearListeners();
    const output = context.createGain();
    output.gain.value = 0.35;
    output.connect(context.destination);
    const delay = context.createDelay(0.2);
    delay.delayTime.value = 0.085;
    const echo = context.createGain();
    echo.gain.value = 0.16;
    delay.connect(echo).connect(output);
    [output, delay, echo].forEach(node => nodes.add(node));
    const start = context.currentTime + 0.01;
    [659.25, 880, 1318.51].forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const envelope = context!.createGain();
      const at = start + index * 0.075;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(0.11, at + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.23);
      oscillator.connect(envelope);
      envelope.connect(output);
      envelope.connect(delay);
      oscillator.start(at);
      oscillator.stop(at + 0.25);
      oscillators.add(oscillator);
      nodes.add(oscillator);
      nodes.add(envelope);
    });
    cleanupTimer = window.setTimeout(stop, 700);
  }

  function resume() {
    if (!context) return;
    if (context.state === "running") sound();
    else void context.resume().then(sound).catch(() => {});
  }

  function unlock(event: Event) {
    if (!pending || !isVisible()) {
      stop();
      return;
    }
    if ((event.target as Element)?.closest?.("#release-toast-close") ||
        (event instanceof KeyboardEvent && event.key === "Escape")) return;
    resume();
  }

  return {
    play() {
      if (playing || pending || !isVisible()) return;
      try {
        context ??= new AudioContext();
        pending = true;
        document.addEventListener("pointerdown", unlock, true);
        document.addEventListener("keydown", unlock, true);
        resume();
      } catch {
        stop();
      }
    },
    stop,
  };
}
