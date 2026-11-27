/**
 * Short haptic tick, best effort.
 *
 * Android and most Chromium browsers expose `navigator.vibrate`. iOS Safari does
 * not, but since iOS 18 toggling an `<input type="checkbox" switch>` plays the
 * system "selection" haptic, so we click a hidden one there.
 */
let toggle: HTMLLabelElement | null = null;

export function haptic(ms = 10): void {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(ms);
    return;
  }
  if (!/iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) || !('ontouchend' in document)) return;
  if (!toggle) {
    toggle = document.createElement('label');
    toggle.setAttribute('aria-hidden', 'true');
    toggle.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    toggle.append(input);
    document.body.append(toggle);
  }
  toggle.click();
}

/** True when the user asked the system for fewer animations. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
