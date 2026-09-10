import { useRef, useState } from 'react';
import { actions } from './dashboard-actions';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  LayoutGrid,
  GitCompare,
  ScanSearch,
  Play,
  Route,
  CalendarClock,
  Bot,
  FolderGit2,
  Settings2,
  Menu,
  X,
  Plus,
  Search,
} from 'lucide-react';
import { Button, Input, Label, ThemeSwitch, Toaster, ConfirmHost } from './components';
import { CommandBar } from './command-registry';

function Mark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M4 12h16" />
    </svg>
  );
}
/** Apple keyboards label the palette shortcut ⌘K; every other platform reads Ctrl K. */
function shortcutHint() {
  const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform);
  return apple ? '⌘K' : 'Ctrl K';
}
/**
 * The sidebar, in two groups.
 *
 * Everything above the rule is work a person does day to day — look at pages,
 * decide on changes, check a run. Everything below it is how the workspace is
 * set up, which is read far less often and was crowding the list. Pages leads
 * because pages are the subject; Changes carries the only count in the
 * navigation, because it is the only entry that ever needs someone.
 */
export const sections = [
  { id: 'pages', label: 'Pages', icon: LayoutGrid, group: 'work' },
  { id: 'changes', label: 'Changes', icon: GitCompare, group: 'work' },
  { id: 'runs', label: 'Test runs', icon: Play, group: 'work' },
  { id: 'campaigns', label: 'User journeys', icon: Route, group: 'work' },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock, group: 'work' },
  { id: 'overview', label: 'Projects', icon: FolderGit2, group: 'setup' },
  { id: 'intents', label: 'Code scan', icon: ScanSearch, group: 'setup' },
  { id: 'providers', label: 'AI models', icon: Bot, group: 'setup' },
  { id: 'admin', label: 'Settings', icon: Settings2, group: 'setup' },
] as const;

/** Static React shell; the dashboard actions in app.ts drive navigation, data and dialogs. */
function WorkspaceShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggle = useRef<HTMLButtonElement>(null);
  return (
    <>
      <section id="login" className="login-shell">
        <form id="login-form" className="login-card">
          <div className="brand">
            <span className="brand-mark">
              <Mark size={16} />
            </span>
            Arxic
          </div>
          <div className="page-heading">
            <h1>See every page. Catch every change.</h1>
            <p className="muted">Sign in with the administrator token configured on this server.</p>
          </div>
          <Label>
            Administrator token
            <Input
              name="token"
              type="password"
              autoComplete="current-password"
              required
              minLength={32}
            />
          </Label>
          <Button size="lg" type="submit">
            Open workbench
          </Button>
          <p id="login-error" role="alert"></p>
          <small>Sessions last eight hours. Sign-in attempts are rate limited.</small>
        </form>
      </section>
      <div id="app" className="shell" hidden>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <aside
          className="sidebar"
          data-mobile-open={menuOpen}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && menuOpen) {
              setMenuOpen(false);
              menuToggle.current?.focus();
            }
          }}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-nav]'))
              setMenuOpen(false);
          }}
        >
          <div className="sidebar-head">
            <a className="brand" href="/">
              <span className="brand-mark">
                <Mark />
              </span>
              Arxic
            </a>
            <span className="version-tag" id="version"></span>
            <Button
              variant="ghost"
              size="icon"
              ref={menuToggle}
              className="mobile-nav-toggle"
              aria-controls="workspace-navigation"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X /> : <Menu />}
            </Button>
          </div>
          {/*
            What you are looking at, before what you are looking for.
            Every screen below obeys these two: the project list stopped
            carrying an environment column the moment the environment became
            something you choose here, and no screen carries its own project
            filter any more.
          */}
          <div className="scope-bar">
            <label htmlFor="project-scope">Project</label>
            <select id="project-scope" defaultValue="">
              <option value="">All projects</option>
            </select>
            <label htmlFor="environment-scope">Environment</label>
            <select id="environment-scope" defaultValue="">
              <option value="">All environments</option>
              <option value="development">Development</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </div>
          <nav id="workspace-navigation" aria-label="Workspace">
            {sections
              .filter((item) => item.group === 'work')
              .map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  data-nav={id}
                  className={`nav-item${id === 'pages' ? ' active' : ''}`}
                  onClick={() => actions().navigate(id)}
                >
                  <Icon aria-hidden="true" />
                  {label}
                  {id === 'changes' && (
                    <span className="nav-badge" data-nav-badge="changes" hidden></span>
                  )}
                </button>
              ))}
            <p className="nav-group">Setup</p>
            {sections
              .filter((item) => item.group === 'setup')
              .map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  data-nav={id}
                  className="nav-item"
                  onClick={() => actions().navigate(id)}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="instance">
              <span className="online-dot"></span>
              Self-hosted
            </span>
            <Button id="logout" variant="ghost" size="sm" className="text-button">
              Sign out
            </Button>
            <ThemeSwitch />
          </div>
        </aside>
        <main id="main-content" tabIndex={-1}>
          <header className="topbar">
            <span className="crumb">
              <span>Workspace</span>
              <span aria-hidden="true">/</span>
              <span id="breadcrumb">Pages</span>
            </span>
            <div className="topbar-actions">
              {/* Named explicitly: the visible label is hidden on narrow
                  viewports, and the icon and shortcut hint are decorative. */}
              <button
                type="button"
                className="command-trigger"
                id="open-command-palette"
                aria-label="Search the workspace"
                title={`Search the workspace (${shortcutHint()})`}
              >
                <Search aria-hidden="true" />
                <span>Search</span>
                <kbd aria-hidden="true">{shortcutHint()}</kbd>
              </button>
              <Button
                id="new-project"
                aria-label="Connect project"
                title="Connect project"
                size="sm"
              >
                <Plus />
                <span>Connect project</span>
              </Button>
            </div>
          </header>
          <div className="page">
            <div className="page-heading">
              <h1 id="page-title" tabIndex={-1}>
                Pages
              </h1>
              <p id="page-description" className="muted">
                Every page Arxic found, what is on it, and whether it still looks right.
              </p>
            </div>
            <div id="content"></div>
          </div>
        </main>
      </div>
      <dialog id="project-dialog">
        <div id="project-wizard-root"></div>
      </dialog>
      <dialog id="agent-dialog">
        <div id="agent-wizard-root"></div>
      </dialog>
      <CommandBar />
      <ConfirmHost />
      <Toaster />
    </>
  );
}
export function mountWorkspaceShell(element: Element) {
  const root = createRoot(element);
  flushSync(() => root.render(<WorkspaceShell />));
}
