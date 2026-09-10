/**
 * What a dashboard control can do, in one place, so the control itself can do it.
 *
 * These used to be `data-*` attributes read by a single delegated click
 * listener on `document`. That worked, but it put a button's behaviour a file
 * away from the button, and it leaked: any element anywhere carrying a matching
 * attribute fired the action, which is why `event.stopPropagation()` had to be
 * sprinkled through the toolbar selects to stop them triggering navigation.
 *
 * A registry rather than props: these actions need the session, the polling
 * loop and the URL, all of which live in the action layer, and threading a
 * callback bundle through five levels of panel to reach a pagination button is
 * the prop drilling the brief asked to avoid. One indirection, set once at
 * start-up, and every control calls what it means.
 *
 * The `data-*` attributes stay on the elements. They are how journeys address
 * these controls, and several are load-bearing in the test suite.
 */
export type DashboardActions = {
  navigate(section: string): void;
  /** Open one page's full record: screenshots, checks, source and history. */
  openPage(projectId: string, path: string): void;
  closePage(): void;
  /** Photograph and check this page alone, rather than the whole project. */
  runPageTest(projectId: string, path: string): void;
  addProject(): void;
  editProject(id: string): void;
  /** Project settings, opened on the sign-in section. */
  projectCredentials(id: string): void;
  connectAgent(): void;
  startRun(projectId: string, mode: string): void;
  openRun(id: string): void;
  cancelRun(id: string): void;
  deleteRun(id: string): void;
  approveBaseline(runId: string, captureId: string): void;
  openCampaign(id: string): void;
  cancelCampaign(id: string): void;
  retryRunHistory(): void;
  clearRunFilters(): void;
  pageRuns(direction: number): void;
  pageWorkflows(discoveryId: string, direction: number): void;
  pageCampaign(campaignId: string, direction: number): void;
  pageDeclarations(runId: string, direction: number): void;
};

/**
 * Until the action layer registers, every action is a no-op rather than a
 * crash. A control rendered during start-up, or in a unit test that mounts a
 * panel on its own, should do nothing — not throw into a click handler.
 */
const inert: DashboardActions = {
  navigate: () => {},
  openPage: () => {},
  closePage: () => {},
  runPageTest: () => {},
  addProject: () => {},
  editProject: () => {},
  projectCredentials: () => {},
  connectAgent: () => {},
  startRun: () => {},
  openRun: () => {},
  cancelRun: () => {},
  deleteRun: () => {},
  approveBaseline: () => {},
  openCampaign: () => {},
  cancelCampaign: () => {},
  retryRunHistory: () => {},
  clearRunFilters: () => {},
  pageRuns: () => {},
  pageWorkflows: () => {},
  pageCampaign: () => {},
  pageDeclarations: () => {},
};

let registered: DashboardActions = inert;

export function setDashboardActions(actions: DashboardActions) {
  registered = actions;
}

/** The current action set. Called at click time, so a later registration is picked up. */
export function actions(): DashboardActions {
  return registered;
}
