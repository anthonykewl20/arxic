import type { BrowserContext } from 'playwright';

/**
 * Provoking the states a page only shows when something goes wrong.
 *
 * Plain navigation reaches a route's happy path. Error banners, boundary
 * fallbacks, toasts and inline validation are exactly the surfaces that break
 * unnoticed, and they are unreachable by navigation alone. Two mechanisms cover
 * the overwhelming majority of them, and both stay read-only against the target:
 *
 *  - a fault response, which answers the application's own data requests with a
 *    chosen status instead of letting them through;
 *  - an empty form submission, which is handled by the page's client-side
 *    validation before any request leaves the browser.
 *
 * Neither writes to the target. The fault route never forwards the request it
 * intercepts, and the capture context already aborts every non-GET request, so
 * a submission that survives validation still cannot reach the server.
 */

/**
 * The statuses a checkpoint may induce. A closed list: a checkpoint is a
 * declaration about the product's own error handling, not a way to probe a
 * target with arbitrary responses.
 */
export const INDUCIBLE_STATUSES = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503] as const;
export type InducibleStatus = (typeof INDUCIBLE_STATUSES)[number];

export type Fault = {
  status: InducibleStatus;
  /** Only intercept requests whose path contains this. Absent: every data request. */
  path?: string;
};

export const isInducibleStatus = (value: unknown): value is InducibleStatus =>
  typeof value === 'number' && (INDUCIBLE_STATUSES as readonly number[]).includes(value);

/** A body shaped like the error envelopes applications actually parse. */
export function faultBody(status: number): string {
  return JSON.stringify({
    error: `Induced ${status} for visual state capture`,
    status,
    induced: true,
  });
}

/**
 * Answers the page's data requests with `fault.status`.
 *
 * Document navigations are left alone: replacing them would capture the
 * browser's own error page instead of the application's error handling, which
 * is the thing under test. Registered after the context's same-origin guard so
 * it takes precedence for the requests it claims, and returns the number it
 * answered so a checkpoint that provoked nothing can say so.
 */
export async function installFault(context: BrowserContext, origin: string, fault: Fault) {
  const counters = { answered: 0 };
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (request.resourceType() === 'document') return route.fallback();
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return route.fallback();
    }
    if (url.origin !== origin) return route.fallback();
    if (fault.path && !url.pathname.includes(fault.path)) return route.fallback();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return route.fallback();
    counters.answered++;
    await route.fulfill({
      status: fault.status,
      contentType: 'application/json',
      body: faultBody(fault.status),
    });
  });
  return counters;
}

/**
 * Submits every form on the page with its fields left empty, so required-field
 * and pattern validation renders.
 *
 * `requestSubmit()` rather than `submit()`: the bare `submit()` skips
 * validation and the submit event entirely, which is the whole thing being
 * provoked. Fields are cleared first so a browser-restored value cannot make a
 * form pass. Returns what appeared, so a checkpoint that provoked no validation
 * at all is visible as a coverage gap rather than a silently empty capture.
 */
export const SUBMIT_FORMS_SCRIPT = `(() => {
  const forms = [...document.querySelectorAll('form')];
  for (const form of forms) {
    for (const field of form.querySelectorAll('input, textarea, select')) {
      const type = (field.getAttribute('type') || '').toLowerCase();
      if (['submit', 'button', 'reset', 'image', 'hidden'].includes(type)) continue;
      try {
        if (field.tagName === 'SELECT') field.selectedIndex = -1;
        else if (['checkbox', 'radio'].includes(type)) field.checked = false;
        else field.value = '';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      } catch {
        /* a field that refuses to be cleared is left as it is */
      }
    }
    try {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    } catch {
      /* a form that throws on submit has still had its fields cleared */
    }
  }
  return {
    forms: forms.length,
    invalidFields: document.querySelectorAll('[aria-invalid="true"], :invalid').length,
  };
})()`;

/**
 * The transient surfaces a page raised: alerts, live regions, open dialogs and
 * the containers a toast library renders into.
 *
 * Recorded as counts and boxes rather than text — the text belongs to the
 * target application and is not evidence this tool should retain, while the
 * geometry is what a capture needs in order to say a state was reached.
 */
export const TRANSIENT_REGIONS_SCRIPT = `(() => {
  const selector = [
    '[role="alert"]',
    '[role="alertdialog"]',
    '[role="status"]',
    '[aria-live="assertive"]',
    '[aria-live="polite"]',
    'dialog[open]',
    '[role="dialog"]',
    '[data-sonner-toaster]',
    '.toast, .Toastify, .toast-container, .notification, .snackbar',
  ].join(',');
  const visible = [];
  for (const element of document.querySelectorAll(selector)) {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (!box.width || !box.height) continue;
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    visible.push({
      role: element.getAttribute('role') || element.tagName.toLowerCase(),
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    });
  }
  return visible.slice(0, 40);
})()`;

export type TransientRegion = {
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
