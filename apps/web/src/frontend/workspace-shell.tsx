import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  LayoutDashboard,
  ScanSearch,
  Play,
  Layers,
  CalendarClock,
  Plug,
  Settings2,
  ScanLine,
  Menu,
  X,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';

/** Static React shell; screen actions and controlled forms migrate incrementally. */
function WorkspaceShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggle = useRef<HTMLButtonElement>(null);
  return (
    <>
      <section id="login" className="login-shell">
        <form id="login-form" className="login-card">
          <div className="brand-mark">
            <ScanLine size={26} />
          </div>
          <p className="eyebrow">ARXIC / WORKBENCH</p>
          <h1>A clearer view of your frontend.</h1>
          <p className="muted">Discover intent. Replay behavior. Review visual change.</p>
          <label>
            Administrator token
            <Input
              name="token"
              type="password"
              autoComplete="current-password"
              required
              minLength={32}
            />
          </label>
          <Button className="primary" type="submit">
            Open workbench <span aria-hidden="true">→</span>
          </Button>
          <p id="login-error" role="alert"></p>
          <small>Use the token configured on this Arxic instance.</small>
        </form>
      </section>
      <div id="app" className="shell" hidden>
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
          <a className="brand" href="/">
            <span className="brand-mark">
              <ScanLine size={20} />
            </span>
            <span>
              arxic<small>FRONTEND WORKBENCH</small>
            </span>
          </a>
          <Button
            variant="ghost"
            ref={menuToggle}
            className="mobile-nav-toggle"
            aria-controls="workspace-navigation"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </Button>
          <p className="nav-label">WORKSPACE</p>
          <nav id="workspace-navigation" aria-label="Workspace">
            <Button data-nav="overview" variant="ghost" className="nav-item active">
              <LayoutDashboard />
              Overview
            </Button>
            <Button data-nav="intents" variant="ghost" className="nav-item">
              <ScanSearch />
              Intent inventory
            </Button>
            <Button data-nav="runs" variant="ghost" className="nav-item">
              <Play />
              Test runs
            </Button>
            <Button data-nav="campaigns" variant="ghost" className="nav-item">
              <Layers />
              Campaigns
            </Button>
            <Button data-nav="schedules" variant="ghost" className="nav-item">
              <CalendarClock />
              Schedules
            </Button>
            <Button data-nav="providers" variant="ghost" className="nav-item">
              <Plug />
              Models & accounts
            </Button>
            <Button data-nav="admin" variant="ghost" className="nav-item">
              <Settings2 />
              Administration
            </Button>
          </nav>
          <div className="sidebar-bottom">
            <span className="online-dot"></span> Self-hosted instance
            <p>
              Administrator · <span id="version"></span>
            </p>
            <Button id="logout" className="text-button">
              Sign out
            </Button>
          </div>
        </aside>
        <main>
          <header className="topbar">
            <span>
              Workspace <span className="muted">/</span> <span id="breadcrumb">Overview</span>
            </span>
            <span className="instance-label">PRIVATE WORKSPACE</span>
          </header>
          <div className="page">
            <div id="notice" role="status" hidden></div>
            <div className="page-heading">
              <div>
                <h1 id="page-title">Workspace overview</h1>
                <p id="page-description" className="muted">
                  Manage projects, uncover gaps, and review what changed.
                </p>
              </div>
              <Button id="new-project" className="primary">
                + Add project
              </Button>
            </div>
            <div id="content"></div>
          </div>
        </main>
      </div>
      <dialog id="project-dialog">
        <form id="project-form">
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">PROJECT SETTINGS</p>
              <h2 id="dialog-title">Connect a project</h2>
            </div>
            <Button
              type="button"
              id="close-dialog"
              className="secondary"
              aria-label="Close project settings"
            >
              ×
            </Button>
          </div>
          <p className="muted">
            Choose a folder accessible to this Arxic server. Source discovery can run before a test
            app is available.
          </p>
          <div className="form-grid">
            <label>
              Project name
              <Input name="name" required maxLength={100} placeholder="Customer portal" />
            </label>
            <label>
              Project folder
              <Input name="folder" required placeholder="/workspace/customer-portal" />
            </label>
            <label>
              Running test app origin
              <Input name="origin" type="url" placeholder="http://localhost:3000" />
              <small>No path, query string, or credentials.</small>
            </label>
            <label>
              AI E2E configuration file
              <Input name="configPath" placeholder="arxic.config.yaml" />
              <small>Relative to the project folder. Uses existing Arxic CLI configuration.</small>
            </label>
            <label>
              Visual checkpoint paths
              <textarea
                name="paths"
                rows={3}
                placeholder="/&#10;/login"
              ></textarea>
              <small>One path per line. Maximum 20. Anonymous, read-only pages.</small>
            </label>
            <label>
              Additional privacy masks
              <textarea name="masks" rows={3} placeholder="[data-private]"></textarea>
              <small>One CSS selector per line. Inputs are always masked.</small>
            </label>
            <label>
              Viewport sizes
              <Input name="viewports" placeholder="1440x900, 390x844" required />
              <small>Up to 3 sizes. Each capture covers the visible viewport.</small>
            </label>
            <label>
              Schedule (UTC cron)
              <Input name="cron" placeholder="0 9 * * *" />
              <small>Five fields: minute, hour, day, month, weekday. Blank disables.</small>
            </label>
            <label>
              Scheduled run
              <select name="scheduleMode">
                <option value="discovery">Source discovery</option>
                <option value="visual">Visual regression</option>
                <option value="agent">AI E2E</option>
              </select>
            </label>
            <label className="checkbox">
              <Input name="paused" type="checkbox" defaultChecked /> Pause scheduled runs
            </label>
          </div>
          <label className="checkbox consent">
            <Input name="guided" type="checkbox" /> Configure AI execution in this dashboard
          </label>
          <fieldset id="execution-fields" hidden disabled>
            <legend>AI execution</legend>
            <p className="muted">
              Choose a provider connection and model. Secret references name server environment
              variables; enter no passwords or API keys here.
            </p>
            <div className="form-grid">
              <div id="execution-model-controls"></div>
              <label>
                Model secret reference
                <Input name="exec_modelSecretRef" placeholder="ARXIC_SECRET_MODEL_KEY" />
                <small>Blank uses the selected provider's credential.</small>
              </label>
              <label>
                Frameworks
                <Input name="exec_frameworks" required placeholder="nextjs" />
                <small>
                  Comma-separated declarations; engine support is checked before crawling.
                </small>
              </label>
              <label>
                Domain declarations
                <Input name="exec_domains" required placeholder="authentication" />
                <small>
                  Comma-separated. Enables matching domain seeders; does not restrict discovered
                  routes.
                </small>
              </label>
              <label>
                Languages
                <Input name="exec_languages" required defaultValue="typescript, javascript" />
              </label>
              <label>
                Environment
                <select name="exec_environmentClass">
                  <option value="local-test">Local test</option>
                  <option value="preview">Preview</option>
                  <option value="staging">Staging</option>
                </select>
              </label>
              <label>
                Planning budget (estimated USD)
                <Input
                  name="exec_modelBudgetUsd"
                  type="number"
                  min="0"
                  max="100"
                  step="0.001"
                  defaultValue="0.025"
                  required
                />
                <small>
                  Engine estimate. Host agent billing may be unavailable; this is not a billing
                  limit.
                </small>
              </label>
              <label>
                Maximum run minutes
                <Input
                  name="exec_maxRuntimeMinutes"
                  type="number"
                  min="1"
                  max="30"
                  defaultValue="10"
                  required
                />
              </label>
              <label>
                Maximum crawl URLs
                <Input
                  name="exec_maxUrls"
                  type="number"
                  min="1"
                  max="500"
                  defaultValue="20"
                  required
                />
              </label>
              <label>
                Maximum crawl depth
                <Input
                  name="exec_maxDepth"
                  type="number"
                  min="1"
                  max="10"
                  defaultValue="2"
                  required
                />
              </label>
              <label>
                Persona strategy
                <select name="persona_mode">
                  <option value="anonymous">Anonymous</option>
                  <option value="seed-api">Test app seed API</option>
                  <option value="per-pass-login">Existing test account login</option>
                </select>
              </label>
              <label>
                Email secret reference
                <Input name="persona_emailRef" placeholder="ARXIC_SECRET_TEST_EMAIL" />
              </label>
              <label>
                Password secret reference
                <Input name="persona_passwordRef" placeholder="ARXIC_SECRET_TEST_PASSWORD" />
              </label>
              <label>
                New password secret reference
                <Input name="persona_newPasswordRef" placeholder="ARXIC_SECRET_NEW_PASSWORD" />
              </label>
            </div>
            <details>
              <summary>Login and deployment declarations</summary>
              <p className="muted">
                Login fields apply to existing test accounts. Feature flags describe the running
                deployment; Arxic does not change them.
              </p>
              <div className="form-grid">
                <label>
                  Login path
                  <Input name="persona_loginPath" defaultValue="/login" />
                </label>
                <label>
                  Email field label
                  <Input name="persona_emailLabel" defaultValue="Email" />
                </label>
                <label>
                  Password field label
                  <Input name="persona_passwordLabel" defaultValue="Password" />
                </label>
                <label>
                  Login button label
                  <Input name="persona_submitLabel" defaultValue="Login" />
                </label>
                <label>
                  Attestation path
                  <Input
                    name="exec_attestationPath"
                    defaultValue="/.well-known/arxic-test-target.json"
                  />
                </label>
                <label>
                  Feature flag declarations
                  <textarea
                    name="exec_featureFlags"
                    placeholder="passwordReset=true"
                    rows={3}
                  ></textarea>
                  <small>One name=true or name=false per line.</small>
                </label>
              </div>
            </details>
          </fieldset>
          <label className="checkbox consent">
            <Input name="captureConsent" type="checkbox" /> I authorize screenshot capture of this
            test environment. The pages contain test data; I have added masks for any other
            sensitive content.
          </label>
          <p id="project-error" role="alert"></p>
          <div className="dialog-footer">
            <small>
              Discovery reports known scope and gaps; source alone cannot prove complete business
              coverage.
            </small>
            <Button type="submit" className="primary">
              Save project
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
export function mountWorkspaceShell(element: Element) {
  const root = createRoot(element);
  flushSync(() => root.render(<WorkspaceShell />));
}
