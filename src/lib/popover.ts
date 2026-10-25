let popoverZIndex = 40;
type PopoverPosition = { left: number; top: number };
const POPOVER_VIEWPORT_PADDING = 8;
const popoverSessionPositions = new Map<string, PopoverPosition>();

function bringPopoverToFront(popover: HTMLElement) {
  popoverZIndex += 1;
  popover.style.zIndex = String(popoverZIndex);
}

function ensurePopoverDefaultPosition(popover: HTMLElement, index: number): PopoverPosition {
  if (!popover.dataset.defaultLeft || !popover.dataset.defaultTop) {
    const offset = index * 28;
    popover.dataset.defaultLeft = String(110 + offset);
    popover.dataset.defaultTop = String(70 + offset);
  }

  return {
    left: Number(popover.dataset.defaultLeft),
    top: Number(popover.dataset.defaultTop),
  };
}

function setPopoverPosition(
  popover: HTMLElement,
  position: PopoverPosition,
  remember = true,
) {
  const clamped = clampPopoverPosition(popover, position);
  popover.style.left = "0";
  popover.style.top = "0";
  popover.style.transform = `translate(${clamped.left}px, ${clamped.top}px)`;
  popover.dataset.left = String(clamped.left);
  popover.dataset.top = String(clamped.top);

  const key = popover.dataset.popover;
  if (remember && key) popoverSessionPositions.set(key, clamped);
}

function clampPopoverPosition(
  popover: HTMLElement,
  position: PopoverPosition,
): PopoverPosition {
  const maxLeft = Math.max(
    POPOVER_VIEWPORT_PADDING,
    window.innerWidth - popover.offsetWidth - POPOVER_VIEWPORT_PADDING,
  );
  const maxTop = Math.max(
    POPOVER_VIEWPORT_PADDING,
    window.innerHeight - popover.offsetHeight - POPOVER_VIEWPORT_PADDING,
  );

  return {
    left: Math.min(Math.max(POPOVER_VIEWPORT_PADDING, position.left), maxLeft),
    top: Math.min(Math.max(POPOVER_VIEWPORT_PADDING, position.top), maxTop),
  };
}

function resetPopoverPosition(popover: HTMLElement) {
  const key = popover.dataset.popover;
  if (key) popoverSessionPositions.delete(key);

  setPopoverPosition(
    popover,
    {
      left: Number(popover.dataset.defaultLeft ?? 0),
      top: Number(popover.dataset.defaultTop ?? 0),
    },
    false,
  );
}

function makePopoverDraggable(popover: HTMLElement) {
  if (popover.dataset.draggable === "true") return;
  popover.dataset.draggable = "true";

  const handle = popover.querySelector<HTMLElement>(".menu-popover__header");
  if (!handle) return;

  handle.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest(".menu-popover__close")) return;
    if (event.button !== 0) return;
    event.preventDefault();
    bringPopoverToFront(popover);

    const startLeft = Number(popover.dataset.left ?? popover.getBoundingClientRect().left);
    const startTop = Number(popover.dataset.top ?? popover.getBoundingClientRect().top);
    const startX = event.clientX;
    const startY = event.clientY;
    popover.dataset.dragging = "true";
    handle.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      setPopoverPosition(popover, {
        left: startLeft + moveEvent.clientX - startX,
        top: startTop + moveEvent.clientY - startY,
      });
    };

    const onUp = (upEvent: PointerEvent) => {
      delete popover.dataset.dragging;
      if (handle.hasPointerCapture(upEvent.pointerId)) {
        handle.releasePointerCapture(upEvent.pointerId);
      }
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });

  handle.addEventListener("dblclick", (event) => {
    if ((event.target as HTMLElement).closest(".menu-popover__close")) return;
    event.preventDefault();
    resetPopoverPosition(popover);
  });
}

export function openPopover(popover: HTMLElement, index: number) {
  const defaultPosition = ensurePopoverDefaultPosition(popover, index);
  popover.hidden = false;
  const key = popover.dataset.popover ?? "";
  setPopoverPosition(
    popover,
    key ? popoverSessionPositions.get(key) ?? defaultPosition : defaultPosition,
  );
  bringPopoverToFront(popover);
  makePopoverDraggable(popover);
}
