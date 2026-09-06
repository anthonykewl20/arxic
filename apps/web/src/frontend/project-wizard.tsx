import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  FolderGit2,
  GitBranch,
  Search,
  Monitor,
  Smartphone,
  Tablet,
  ListChecks,
  Sparkles,
} from 'lucide-react';
import {
  Button,
  Callout,
  Checkbox,
  DialogBody,
  DialogFooter,
  DialogHeading,
  Input,
  Label,
  Select,
  Textarea,
} from './components';
import { ModelControls, type ModelChoice, type RefreshModels } from './model-controls';
import type { Project } from '../types';
import type { Detection, FolderCandidate } from '../workspace';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
type Props = {
  project?: Project;
  api: Api;
  onRefreshModels: RefreshModels;
  onSaved: () => Promise<void>;
  onClose: () => void;
};
const executionNumbers = ['modelBudgetUsd', 'maxRuntimeMinutes', 'maxUrls', 'maxDepth'];
const executionLists = ['frameworks', 'domains', 'languages'];
const splitList = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
const lines = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
const viewportPresets = [
  { label: 'Desktop', size: '1440x900', icon: Monitor },
  { label: 'Phone', size: '390x844', icon: Smartphone },
  { label: 'Tablet', size: '834x1194', icon: Tablet },
];
const frameworkLabel: Record<string, string> = {
  next: 'Next.js',
  remix: 'Remix',
  nuxt: 'Nuxt',
  sveltekit: 'SvelteKit',
  astro: 'Astro',
  angular: 'Angular',
  'create-react-app': 'Create React App',
  vite: 'Vite',
  express: 'Express',
};

/** Builds the project request body from the settings form; mirrors the server's accepted shape. */
export function projectBody(values: FormData) {
  const body: Record<string, unknown> = Object.fromEntries(
    ['name', 'folder', 'origin', 'configPath', 'cron', 'scheduleMode'].map((key) => [
      key,
      values.get(key) ?? '',
    ]),
  );
  body.paths = lines(values.get('paths'));
  body.masks = lines(values.get('masks'));
  body.viewports = String(values.get('viewports') ?? '')
    .split(',')
    .map((value) => {
      const [width, height] = value.trim().split('x').map(Number);
      return { width, height };
    });
  body.paused = values.has('paused');
  body.captureConsent = values.has('captureConsent');
  body.pageMode = values.get('pageMode') === 'discover' ? 'discover' : 'manual';
  body.recordVideo = false;
  body.maxPages = Number(values.get('maxPages') ?? 50);
  body.maxDepth = Number(values.get('maxDepth') ?? 3);
  if (values.has('loginEnabled'))
    body.login = Object.fromEntries(
      ['loginPath', 'emailRef', 'passwordRef', 'emailLabel', 'passwordLabel', 'submitLabel'].map(
        (key) => [key, values.get(`login_${key}`) ?? ''],
      ),
    );
  if (values.has('guided')) {
    body.configPath = '';
    const execution: Record<string, unknown> = { persona: {} };
    for (const [name, value] of values) {
      if (name.startsWith('persona_'))
        (execution.persona as Record<string, unknown>)[name.slice(8)] = value;
      if (!name.startsWith('exec_')) continue;
      const key = name.slice(5);
      if (key === 'featureFlags') {
        const flags = lines(value).map((line) => {
          const match = /^([A-Za-z][A-Za-z0-9_.-]{0,99})=(true|false)$/u.exec(line);
          if (!match) throw new Error('Use name=true or name=false for each feature flag');
          return [match[1], match[2] === 'true'] as const;
        });
        if (new Set(flags.map(([key]) => key)).size !== flags.length)
          throw new Error('Feature flag names must be unique');
        execution.featureFlags = Object.fromEntries(flags);
      } else
        execution[key] = executionNumbers.includes(key)
          ? Number(value)
          : executionLists.includes(key)
            ? splitList(value)
            : value;
    }
    body.execution = execution;
  }
  return body;
}

export type SourceDraft = { source: 'local' | 'github'; folder: string; url: string };
function SourceStep({
  api,
  draft,
  onDraft,
  onDetected,
  onClose,
}: {
  api: Api;
  draft: SourceDraft;
  onDraft: (draft: SourceDraft) => void;
  onDetected: (detection: Detection) => void;
  onClose: () => void;
}) {
  const { source, folder, url } = draft;
  const setSource = (source: SourceDraft['source']) => onDraft({ ...draft, source });
  const setFolder = (folder: string) => onDraft({ ...draft, folder });
  const setUrl = (url: string) => onDraft({ ...draft, url });
  const [query, setQuery] = useState('');
  const [folders, setFolders] = useState<FolderCandidate[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api(`/workspace/folders?query=${encodeURIComponent(query)}`)
        .then((result) => {
          if (!cancelled) setFolders(result.folders);
        })
        .catch(() => {
          if (!cancelled) setFolders([]);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query]);
  const ready = !busy && (source === 'local' ? !!folder : !!url);
  const proceed = async () => {
    if (!ready) return;
    setError('');
    setBusy(source === 'github' ? 'Cloning repository…' : 'Inspecting folder…');
    try {
      const detection =
        source === 'github'
          ? await api('/workspace/clone', 'POST', { url })
          : await api('/workspace/detect', 'POST', { folder });
      onDetected(detection);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not inspect that source');
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <DialogHeading
        title="Connect a project"
        subtitle="Step 1 of 2 · Where is the code?"
        steps={{ total: 2, current: 1 }}
        onClose={onClose}
        closeId="close-dialog"
        closeLabel="Close project settings"
      />
      <DialogBody>
        <div className="choice-grid" role="group" aria-label="Project source">
          <button
            type="button"
            className="choice"
            aria-pressed={source === 'local'}
            onClick={() => setSource('local')}
          >
            <FolderGit2 size={20} aria-hidden="true" />
            <strong>Folder on this machine</strong>
            <small>Pick a folder inside the allowed workspace roots. Nothing is uploaded.</small>
          </button>
          <button
            type="button"
            className="choice"
            aria-pressed={source === 'github'}
            onClick={() => setSource('github')}
          >
            <GitBranch size={20} aria-hidden="true" />
            <strong>GitHub repository</strong>
            <small>
              Paste a public repository URL. Arxic clones it into the workspace for you.
            </small>
          </button>
        </div>
        {source === 'local' ? (
          <div className="form-stack">
            <Label>
              Search folders
              <span className="search-field">
                <Search size={15} aria-hidden="true" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter by folder name"
                  autoComplete="off"
                />
              </span>
            </Label>
            <div className="picker" role="group" aria-label="Workspace folders">
              {folders === null ? (
                <div className="picker-empty">Loading folders…</div>
              ) : folders.length === 0 ? (
                <div className="picker-empty">
                  No folders found here. Enter an absolute path below or clone a repository.
                </div>
              ) : (
                folders.map((item) => (
                  <button
                    type="button"
                    key={item.path}
                    className="picker-row"
                    aria-pressed={folder === item.path}
                    onClick={() => setFolder(item.path)}
                  >
                    <FolderGit2 size={16} aria-hidden="true" />
                    <span>{item.name}</span>
                    <small>
                      {[
                        item.framework ? frameworkLabel[item.framework] : null,
                        item.git ? 'git' : null,
                        !item.hasPackage ? 'no package.json' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </button>
                ))
              )}
            </div>
            <Label>
              Project folder
              <Input
                name="folder"
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void proceed();
                  }
                }}
                placeholder="/workspace/customer-portal"
                required
              />
              <small>Absolute path on the Arxic server, inside an allowed root.</small>
            </Label>
          </div>
        ) : (
          <Label>
            Repository URL
            <Input
              name="repository"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void proceed();
                }
              }}
              placeholder="https://github.com/owner/repository"
              required
            />
            <small>
              Public repositories only. Clone private repositories on the server, then connect the
              folder.
            </small>
          </Label>
        )}
        <p id="project-error" role="alert">
          {error}
        </p>
      </DialogBody>
      <DialogFooter>
        <small>{busy || 'Source discovery runs before a test app is available.'}</small>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!ready} onClick={() => void proceed()}>
          Continue
        </Button>
      </DialogFooter>
    </>
  );
}

function SettingsStep({
  project,
  detection,
  api,
  onRefreshModels,
  onSaved,
  onClose,
  onBack,
}: Props & { detection?: Detection; onBack?: () => void }) {
  const seed = project ?? {
    name: detection?.name ?? '',
    folder: detection?.folder ?? '',
    origin: detection?.origin ?? '',
    paths: detection?.paths ?? ['/'],
    masks: [],
    viewports: [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ],
    captureConsent: false,
    pageMode: 'manual' as const,
    recordVideo: false,
    maxPages: 50,
    maxDepth: 3,
    login: undefined,
    configPath: detection?.configPath ?? '',
    cron: '',
    scheduleMode: 'discovery' as const,
    paused: true,
    execution: undefined,
  };
  const [guided, setGuided] = useState(!!seed.execution);
  const [pageMode, setPageMode] = useState<'manual' | 'discover'>(seed.pageMode);
  const [loginEnabled, setLoginEnabled] = useState(!!seed.login);
  const [viewports, setViewports] = useState(
    seed.viewports.map((view) => `${view.width}x${view.height}`).join(', '),
  );
  const [model, setModel] = useState<ModelChoice>({
    modelConnection: seed.execution?.modelConnection ?? '',
    model: seed.execution?.model ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const initialConnection = seed.execution?.modelConnection;
  const hasExecution = !!seed.execution;
  useEffect(() => {
    if (hasExecution) void onRefreshModels(initialConnection ?? '');
  }, [hasExecution, initialConnection, onRefreshModels]);
  const exec = seed.execution;
  const persona = exec?.persona;
  const selected = new Set(viewports.split(',').map((item) => item.trim()));
  const togglePreset = (size: string) => {
    const next = selected.has(size)
      ? [...selected].filter((item) => item !== size)
      : [...selected, size];
    setViewports(next.filter(Boolean).join(', '));
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = projectBody(new FormData(event.currentTarget));
      await api(`/projects${project ? `/${project.id}` : ''}`, project ? 'PUT' : 'POST', body);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the project');
    } finally {
      setSaving(false);
    }
  };
  const steps = project ? undefined : { total: 2, current: 2 };
  return (
    <form id="project-form" ref={form} onSubmit={(event) => void submit(event)}>
      <DialogHeading
        title={project ? 'Project settings' : 'Connect a project'}
        subtitle={project ? project.folder : 'Step 2 of 2 · Confirm the settings we detected'}
        steps={steps}
        onClose={onClose}
        closeId="close-dialog"
        closeLabel="Close project settings"
      />
      <DialogBody>
        {detection && (
          <Callout
            tone={detection.git.repository ? 'success' : 'warning'}
            title={[
              detection.framework ? `${frameworkLabel[detection.framework]} app` : 'Source folder',
              detection.language === 'typescript' ? 'TypeScript' : null,
              detection.git.repository
                ? detection.git.clean === false
                  ? 'uncommitted changes'
                  : 'clean git checkout'
                : 'not a git repository',
            ]
              .filter(Boolean)
              .join(', ')}
          >
            {detection.git.repository
              ? 'Everything below is a suggestion. Change what you need; you can edit it later.'
              : 'Discovery needs a git repository with a resolvable HEAD. Initialise git before running AI execution.'}
          </Callout>
        )}
        <div className="form-grid">
          <Label>
            Project name
            <Input
              name="name"
              required
              maxLength={100}
              defaultValue={seed.name}
              placeholder="Customer portal"
            />
          </Label>
          <Label>
            Project folder
            <Input
              name="folder"
              required
              defaultValue={seed.folder}
              placeholder="/workspace/customer-portal"
            />
          </Label>
          <Label>
            Running test app origin
            <Input
              name="origin"
              type="url"
              defaultValue={seed.origin}
              placeholder="http://localhost:3000"
            />
            <small>
              Optional until you run visual or AI tests. No path, query string, or credentials.
            </small>
          </Label>
        </div>
        <div className="form-stack">
          <span className="text-xs font-medium text-secondary-foreground">Pages to screenshot</span>
          <input type="hidden" name="pageMode" value={pageMode} />
          <div className="choice-grid" role="group" aria-label="Page selection mode">
            <button
              type="button"
              className="choice"
              aria-pressed={pageMode === 'manual'}
              onClick={() => setPageMode('manual')}
            >
              <ListChecks size={18} aria-hidden="true" />
              <strong>Manual list</strong>
              <small>Only the paths you enter below are captured.</small>
            </button>
            <button
              type="button"
              className="choice"
              aria-pressed={pageMode === 'discover'}
              onClick={() => setPageMode('discover')}
            >
              <Sparkles size={18} aria-hidden="true" />
              <strong>AI discovery</strong>
              <small>
                Source routes plus a crawl of the running app, following links from your list. Sign
                in below to reach pages behind login.
              </small>
            </button>
          </div>
          {pageMode === 'discover' && (
            <div className="form-grid">
              <Label>
                Maximum pages
                <Input
                  name="maxPages"
                  type="number"
                  min="1"
                  max="200"
                  defaultValue={seed.maxPages}
                  required
                />
                <small>
                  Pages captured per run, including your list. Up to 200; 600 captures per run.
                </small>
              </Label>
              <Label>
                Crawl depth
                <Input
                  name="maxDepth"
                  type="number"
                  min="1"
                  max="5"
                  defaultValue={seed.maxDepth}
                  required
                />
                <small>How many links away from your list to follow. GET navigation only.</small>
              </Label>
            </div>
          )}
          <Label>
            Visual checkpoint paths
            <Textarea
              name="paths"
              rows={3}
              defaultValue={seed.paths.join('\n')}
              placeholder={'/\n/login'}
            />
            <small>
              {pageMode === 'discover'
                ? 'Always included. Run Discover intents first; its pages are merged at capture time.'
                : 'One path per line, up to 200. Read-only checkpoints.'}
            </small>
          </Label>
        </div>
        <div className="form-stack">
          <span className="text-xs font-medium text-secondary-foreground">Viewports</span>
          <div className="chip-list" role="group" aria-label="Viewport presets">
            {viewportPresets.map(({ label, size, icon: Icon }) => (
              <button
                type="button"
                key={size}
                className="chip"
                aria-pressed={selected.has(size)}
                onClick={() => togglePreset(size)}
              >
                <Icon size={14} aria-hidden="true" />
                {label} {size.replace('x', '×')}
              </button>
            ))}
          </div>
          <Label>
            Viewport sizes
            <Input
              name="viewports"
              required
              value={viewports}
              onChange={(event) => setViewports(event.target.value)}
              placeholder="1440x900, 390x844"
            />
            <small>Up to 3 sizes as width×height. Each capture covers the visible viewport.</small>
          </Label>
        </div>
        <div className="form-stack">
          <Checkbox
            name="loginEnabled"
            checked={loginEnabled}
            onChange={(event) => setLoginEnabled(event.target.checked)}
            label="Sign in before capturing (pages behind login)"
          />
          <fieldset id="login-fields" hidden={!loginEnabled} disabled={!loginEnabled}>
            <legend>Test account sign-in</legend>
            <p className="muted">
              One form sign-in per run with a test account. Secret references name ARXIC_SECRET_
              variables on the server; the session lives in memory for the run only. Fields are
              found by label, then by input type.
            </p>
            <div className="form-grid">
              <Label>
                Login path
                <Input
                  name="login_loginPath"
                  defaultValue={seed.login?.loginPath ?? '/login'}
                  required
                />
              </Label>
              <Label>
                Submit button label
                <Input
                  name="login_submitLabel"
                  defaultValue={seed.login?.submitLabel ?? 'Sign in'}
                />
              </Label>
              <Label>
                Visual sign-in email secret reference
                <Input
                  name="login_emailRef"
                  defaultValue={seed.login?.emailRef}
                  placeholder="ARXIC_SECRET_TEST_EMAIL"
                  required
                />
              </Label>
              <Label>
                Visual sign-in password secret reference
                <Input
                  name="login_passwordRef"
                  defaultValue={seed.login?.passwordRef}
                  placeholder="ARXIC_SECRET_TEST_PASSWORD"
                  required
                />
              </Label>
              <Label>
                Email field label
                <Input name="login_emailLabel" defaultValue={seed.login?.emailLabel ?? 'Email'} />
              </Label>
              <Label>
                Password field label
                <Input
                  name="login_passwordLabel"
                  defaultValue={seed.login?.passwordLabel ?? 'Password'}
                />
              </Label>
            </div>
          </fieldset>
        </div>
        <details open={!!(seed.masks.length || seed.cron || seed.configPath || seed.recordVideo)}>
          <summary>Advanced: privacy masks, schedule, configuration file</summary>
          <div className="form-grid">
            <Label>
              Additional privacy masks
              <Textarea
                name="masks"
                rows={3}
                defaultValue={seed.masks.join('\n')}
                placeholder="[data-private]"
              />
              <small>One CSS selector per line. Inputs are always masked.</small>
            </Label>
            <Label>
              AI E2E configuration file
              <Input
                name="configPath"
                defaultValue={seed.configPath}
                placeholder="arxic.config.yaml"
                disabled={guided}
              />
              <small>Relative to the project folder. Uses existing Arxic CLI configuration.</small>
            </Label>
            <Label>
              Schedule (UTC cron)
              <Input name="cron" defaultValue={seed.cron} placeholder="0 9 * * *" />
              <small>Five fields: minute, hour, day, month, weekday. Blank disables.</small>
            </Label>
            <Label>
              Scheduled run
              <Select name="scheduleMode" defaultValue={seed.scheduleMode}>
                <option value="discovery">Source discovery</option>
                <option value="visual">Visual regression</option>
                <option value="agent">AI E2E</option>
              </Select>
            </Label>
            <Checkbox name="paused" defaultChecked={seed.paused} label="Pause scheduled runs" />
            <p className="muted">
              Every visual run records named masked screenshots and a sanitized action timeline.
              Continuous video is unavailable until capture-time redaction is supported.
            </p>
          </div>
        </details>
        <Checkbox
          name="guided"
          checked={guided}
          onChange={(event) => setGuided(event.target.checked)}
          label="Configure AI execution in this dashboard"
        />
        <fieldset id="execution-fields" hidden={!guided} disabled={!guided}>
          <legend>AI execution</legend>
          <p className="muted">
            Choose a provider connection and model. Secret references name server environment
            variables; enter no passwords or API keys here.
          </p>
          <div className="form-grid">
            <div id="execution-model-controls">
              <ModelControls
                value={model}
                onChange={setModel}
                onRefresh={onRefreshModels}
                prefix="exec_"
                listId="models-project"
              />
            </div>
            <Label>
              Model secret reference
              <Input
                name="exec_modelSecretRef"
                defaultValue={exec?.modelSecretRef}
                placeholder="ARXIC_SECRET_MODEL_KEY"
              />
              <small>Blank uses the selected provider's credential.</small>
            </Label>
            <Label>
              Frameworks
              <Input
                name="exec_frameworks"
                required
                defaultValue={
                  exec?.frameworks.join(', ') ?? (detection?.framework === 'next' ? 'nextjs' : '')
                }
                placeholder="nextjs"
              />
              <small>
                Comma-separated declarations; engine support is checked before crawling.
              </small>
            </Label>
            <Label>
              Domain declarations
              <Input
                name="exec_domains"
                required
                defaultValue={exec?.domains.join(', ')}
                placeholder="authentication"
              />
              <small>
                Comma-separated. Enables matching domain seeders; does not restrict discovered
                routes.
              </small>
            </Label>
            <Label>
              Languages
              <Input
                name="exec_languages"
                required
                defaultValue={exec?.languages.join(', ') ?? 'typescript, javascript'}
              />
            </Label>
            <Label>
              Environment
              <Select
                name="exec_environmentClass"
                defaultValue={exec?.environmentClass ?? 'local-test'}
              >
                <option value="local-test">Local test</option>
                <option value="preview">Preview</option>
                <option value="staging">Staging</option>
              </Select>
            </Label>
            <Label>
              Planning budget (estimated USD)
              <Input
                name="exec_modelBudgetUsd"
                type="number"
                min="0"
                max="100"
                step="0.001"
                defaultValue={exec?.modelBudgetUsd ?? 0.025}
                required
              />
              <small>Engine estimate, not a billing limit.</small>
            </Label>
            <Label>
              Maximum run minutes
              <Input
                name="exec_maxRuntimeMinutes"
                type="number"
                min="1"
                max="30"
                defaultValue={exec?.maxRuntimeMinutes ?? 10}
                required
              />
            </Label>
            <Label>
              Maximum crawl URLs
              <Input
                name="exec_maxUrls"
                type="number"
                min="1"
                max="500"
                defaultValue={exec?.maxUrls ?? 20}
                required
              />
            </Label>
            <Label>
              Maximum crawl depth
              <Input
                name="exec_maxDepth"
                type="number"
                min="1"
                max="10"
                defaultValue={exec?.maxDepth ?? 2}
                required
              />
            </Label>
            <Label>
              Persona strategy
              <Select name="persona_mode" defaultValue={persona?.mode ?? 'anonymous'}>
                <option value="anonymous">Anonymous</option>
                <option value="seed-api">Test app seed API</option>
                <option value="per-pass-login">Existing test account login</option>
              </Select>
            </Label>
            <Label>
              Email secret reference
              <Input
                name="persona_emailRef"
                defaultValue={persona?.emailRef}
                placeholder="ARXIC_SECRET_TEST_EMAIL"
              />
            </Label>
            <Label>
              Password secret reference
              <Input
                name="persona_passwordRef"
                defaultValue={persona?.passwordRef}
                placeholder="ARXIC_SECRET_TEST_PASSWORD"
              />
            </Label>
            <Label>
              New password secret reference
              <Input
                name="persona_newPasswordRef"
                defaultValue={persona?.newPasswordRef}
                placeholder="ARXIC_SECRET_NEW_PASSWORD"
              />
            </Label>
          </div>
          <details>
            <summary>Login and deployment declarations</summary>
            <p className="muted mb-4">
              Login fields apply to existing test accounts. Feature flags describe the running
              deployment; Arxic does not change them.
            </p>
            <div className="form-grid">
              <Label>
                Login path
                <Input name="persona_loginPath" defaultValue={persona?.loginPath ?? '/login'} />
              </Label>
              <Label>
                Email field label
                <Input name="persona_emailLabel" defaultValue={persona?.emailLabel ?? 'Email'} />
              </Label>
              <Label>
                Password field label
                <Input
                  name="persona_passwordLabel"
                  defaultValue={persona?.passwordLabel ?? 'Password'}
                />
              </Label>
              <Label>
                Login button label
                <Input name="persona_submitLabel" defaultValue={persona?.submitLabel ?? 'Login'} />
              </Label>
              <Label>
                Attestation path
                <Input
                  name="exec_attestationPath"
                  defaultValue={exec?.attestationPath ?? '/.well-known/arxic-test-target.json'}
                />
              </Label>
              <Label>
                Feature flag declarations
                <Textarea
                  name="exec_featureFlags"
                  rows={3}
                  placeholder="passwordReset=true"
                  defaultValue={Object.entries(exec?.featureFlags ?? {})
                    .map(([flag, enabled]) => `${flag}=${enabled}`)
                    .join('\n')}
                />
                <small>One name=true or name=false per line.</small>
              </Label>
            </div>
          </details>
        </fieldset>
        <Checkbox
          name="captureConsent"
          className="consent"
          defaultChecked={seed.captureConsent}
          label="I authorize screenshot capture of this test environment. The pages contain test data; I have added masks for any other sensitive content."
        />
        <p id="project-error" role="alert">
          {error}
        </p>
      </DialogBody>
      <DialogFooter>
        {onBack ? (
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
        ) : null}
        <small>
          Discovery reports known scope and gaps; source alone cannot prove complete coverage.
        </small>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save project'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ProjectWizard(props: Props) {
  const [detection, setDetection] = useState<Detection | undefined>();
  const [draft, setDraft] = useState<SourceDraft>({ source: 'local', folder: '', url: '' });
  const [step, setStep] = useState<'source' | 'settings'>(props.project ? 'settings' : 'source');
  if (step === 'source')
    return (
      <SourceStep
        api={props.api}
        draft={draft}
        onDraft={setDraft}
        onClose={props.onClose}
        onDetected={(result) => {
          setDetection(result);
          setStep('settings');
        }}
      />
    );
  return (
    <SettingsStep
      key={detection?.folder ?? props.project?.id ?? ''}
      {...props}
      detection={detection}
      onBack={props.project ? undefined : () => setStep('source')}
    />
  );
}
const roots = new WeakMap<Element, { root: Root; revision: number }>();
/** Mount a fresh wizard each time the dialog opens so no state leaks between projects. */
export function mountProjectWizard(element: Element, props: Props) {
  let entry = roots.get(element);
  if (!entry) {
    entry = { root: createRoot(element), revision: 0 };
    roots.set(element, entry);
  }
  entry.revision++;
  const current = entry;
  flushSync(() => current.root.render(<ProjectWizard key={current.revision} {...props} />));
}
export function unmountProjectWizard(element: Element) {
  roots.get(element)?.root.unmount();
  roots.delete(element);
}
