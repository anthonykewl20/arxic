import { expect, it } from 'vitest';
import { STATIC_FAMILY_CONFIG } from './corpus-capture';

it('configures the nine static public families with read-only docroots and stable controls', () => {
  expect(Object.keys(STATIC_FAMILY_CONFIG).sort()).toEqual([
    'adminbsb',
    'adminlte',
    'gentelella',
    'material-dashboard',
    'material-kit',
    'now-ui-kit',
    'sb-admin',
    'sb-admin-2',
    'todomvc',
  ]);
  for (const [family, config] of Object.entries(STATIC_FAMILY_CONFIG)) {
    expect(family).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
    // Docroots are relative to the local public-families root; the capture
    // never writes inside the clones and never depends on absolute paths.
    expect(config.docroot).toMatch(/^[a-z0-9][a-z0-9/.-]*$/);
    expect(config.path.startsWith('/')).toBe(true);
    expect(config.buttonSelector || config.button).toBeTruthy();
  }
  // todomvc's control is its input (a class, not an id, in the modern repo);
  // the docroot is the monorepo root because the app loads shared assets that
  // the shallow clone does not ship — those route to local vendor clones.
  expect(STATIC_FAMILY_CONFIG.todomvc.buttonSelector).toBe('input.new-todo');
  expect(STATIC_FAMILY_CONFIG.todomvc.docroot).toBe('todomvc');
  expect(STATIC_FAMILY_CONFIG.todomvc.path).toBe('/examples/javascript-es5/');
  expect(Object.keys(STATIC_FAMILY_CONFIG.todomvc.vendorRoutes ?? {})).toHaveLength(2);
  // The admin templates: sb-admin's login "button" is an anchor styled as a
  // button; gentelella's dashboard header action is visible without scroll;
  // adminlte's OSS dist keeps every real button below the fold on its index
  // pages, so its starter page card button is the control.
  expect(STATIC_FAMILY_CONFIG['sb-admin'].path).toBe('/login.html');
  expect(STATIC_FAMILY_CONFIG['sb-admin'].buttonSelector).toBe('a.btn.btn-primary');
  // sb-admin-2 (the successor template, a distinct DOM): the login submit is
  // the only btn-primary anchor on the centered card; the sibling Google and
  // Facebook anchors carry different classes, so the selector stays unique.
  expect(STATIC_FAMILY_CONFIG['sb-admin-2'].docroot).toBe('sb-admin-2');
  expect(STATIC_FAMILY_CONFIG['sb-admin-2'].path).toBe('/login.html');
  expect(STATIC_FAMILY_CONFIG['sb-admin-2'].buttonSelector).toBe('a.btn-primary.btn-user');
  expect(STATIC_FAMILY_CONFIG['sb-admin-2'].viewport).toBeUndefined();
  // material-dashboard (Creative Tim, MIT, a vendor distinct from the
  // StartBootstrap families): the static v3.1.0 build ships the sign-in page
  // with a plain enabled submit button — the page's only bg-gradient-primary
  // button (the navbar CTA is bg-gradient-dark), so the selector stays
  // unique. Remote fonts and the unsplash header image do not paint offline;
  // nothing the oracles measure depends on them.
  expect(STATIC_FAMILY_CONFIG['material-dashboard'].docroot).toBe('material-dashboard');
  expect(STATIC_FAMILY_CONFIG['material-dashboard'].path).toBe('/pages/sign-in.html');
  expect(STATIC_FAMILY_CONFIG['material-dashboard'].buttonSelector).toBe(
    'button.bg-gradient-primary',
  );
  expect(STATIC_FAMILY_CONFIG['material-dashboard'].viewport).toBeUndefined();
  // material-kit (same Creative Tim vendor, MIT, commit-pinned): the sign-in
  // page's submit is the page's only bg-gradient-dark BUTTON — the navbar CTA
  // carrying the same class is an anchor, so the tag-qualified selector stays
  // unique page-wide. Like material-dashboard it centers its card with
  // my-auto, so removing the control re-centers the inputs (honest
  // unstable-case skips, never fabricated rows).
  expect(STATIC_FAMILY_CONFIG['material-kit'].docroot).toBe('material-kit');
  expect(STATIC_FAMILY_CONFIG['material-kit'].path).toBe('/pages/sign-in.html');
  expect(STATIC_FAMILY_CONFIG['material-kit'].buttonSelector).toBe('button.bg-gradient-dark');
  expect(STATIC_FAMILY_CONFIG['material-kit'].viewport).toBeUndefined();
  // adminbsb (AdminBSB - Material Design, MIT, a plain no-build repo pinned at
  // its default-branch HEAD): the sign-in submit is the page's only bg-pink
  // element at all, so the class selector alone stays unique. The card does
  // not re-center when the control is removed, so the missing-element oracle
  // is stable at every probed width. The page carries no h1/h2/p (its intro
  // text lives in a div.msg), so the text-truncate variant honestly refuses
  // no-text-element — recorded per case, never fabricated.
  expect(STATIC_FAMILY_CONFIG.adminbsb.docroot).toBe('adminbsb');
  expect(STATIC_FAMILY_CONFIG.adminbsb.path).toBe('/pages/examples/sign-in.html');
  expect(STATIC_FAMILY_CONFIG.adminbsb.buttonSelector).toBe('button.bg-pink');
  expect(STATIC_FAMILY_CONFIG.adminbsb.viewport).toBeUndefined();
  // now-ui-kit (Creative Tim again, MIT, a static kit commit-pinned at its
  // default-branch HEAD): the login card's "Get Started" control is an
  // anchor styled as a button — the sb-admin precedent — and it is the
  // page's only btn-primary anchor, so the class selector stays unique.
  // The card keeps its position when the control is removed (missing-element
  // stable at every probed width). The page's widest h1/h2/p text measures
  // under the oracle's 80px floor (none at the wide widths), so the
  // text-truncate variant honestly refuses no-text-element.
  expect(STATIC_FAMILY_CONFIG['now-ui-kit'].docroot).toBe('now-ui-kit');
  expect(STATIC_FAMILY_CONFIG['now-ui-kit'].path).toBe('/examples/login-page.html');
  expect(STATIC_FAMILY_CONFIG['now-ui-kit'].buttonSelector).toBe('a.btn-primary');
  expect(STATIC_FAMILY_CONFIG['now-ui-kit'].viewport).toBeUndefined();
  expect(STATIC_FAMILY_CONFIG.gentelella.buttonSelector).toBe(
    'div.page-actions button.btn-outline',
  );
  // Wide dashboards scroll horizontally at 800px, which would contradict the
  // overflow oracle on unmutated pages; both capture at their design width.
  expect(STATIC_FAMILY_CONFIG.gentelella.viewport).toBe(1280);
  expect(STATIC_FAMILY_CONFIG.adminlte.path).toBe('/starter.html');
  expect(STATIC_FAMILY_CONFIG.adminlte.buttonSelector).toBe(':nth-match(a.btn.btn-primary, 1)');
  expect(STATIC_FAMILY_CONFIG.adminlte.viewport).toBe(1280);
});
