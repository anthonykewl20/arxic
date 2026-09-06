import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  LayoutDashboard,
  ScanSearch,
  Play,
  Layers,
  CalendarClock,
  Bot,
  Settings2,
  Menu,
  X,
  Plus,
} from 'lucide-react';
import { Button, Input, Label, ThemeSwitch } from './components';

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
export const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'intents', label: 'Intent inventory', icon: ScanSearch },
  { id: 'runs', label: 'Test runs', icon: Play },
  { id: 'campaigns', label: 'Campaigns', icon: Layers },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  { id: 'providers', label: 'Models & accounts', icon: Bot },
  { id: 'admin', label: 'Administration', icon: Settings2 },
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
            <h1>A clearer view of your frontend.</h1>
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
        <a className="skip-link" href="#main-content">Skip to main content</a>
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
          <nav id="workspace-navigation" aria-label="Workspace">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                data-nav={id}
                className={`nav-item${id === 'overview' ? ' active' : ''}`}
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
              <span id="breadcrumb">Overview</span>
            </span>
            <div className="topbar-actions">
              <Button id="connect-agent" variant="outline" size="sm">
                <Bot />
                <span>Connect agent</span>
              </Button>
              <Button id="new-project" size="sm">
                <Plus />
                <span>Connect project</span>
              </Button>
            </div>
          </header>
          <div className="page">
            <div id="notice" role="status" hidden></div>
            <div className="page-heading">
              <h1 id="page-title" tabIndex={-1}>Workspace overview</h1>
              <p id="page-description" className="muted">
                Manage projects, uncover gaps, and review what changed.
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
    </>
  );
}
export function mountWorkspaceShell(element: Element) {
  const root = createRoot(element);
  flushSync(() => root.render(<WorkspaceShell />));
}
