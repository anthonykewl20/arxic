import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Workbench } from '../workbench';
import { executionConfig } from '../execution';

it('requires consent and preserves the approved workflow region through guided configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-capture-'));
  const wb = await Workbench.open(join(root, 'state'), [root]);
  const capture = {
    mode: 'approved-region',
    region: { kind: 'role', role: 'heading', name: 'Reference Auth App', exact: true },
    masks: [],
  };
  const input = {
    name: 'Workflow region',
    folder: root,
    origin: 'http://127.0.0.1:1',
    execution: {
      model: 'test-provider',
      frameworks: ['nextjs'],
      domains: ['authentication'],
      checkpointCapture: capture,
    },
  };
  try {
    await expect(wb.saveProject(input)).rejects.toThrow(/consent/i);
    const project = await wb.saveProject({ ...input, captureConsent: true });
    expect(executionConfig(project.execution!, root, project.origin).policy).toMatchObject({
      checkpointCapture: capture,
    });
    await expect(
      wb.saveProject({
        ...input,
        captureConsent: true,
        execution: {
          ...input.execution,
          checkpointCapture: { ...capture, region: { kind: 'css', selector: 'body' } },
        },
      }),
    ).rejects.toThrow();
  } finally {
    await wb.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('preserves a semantic capture declaration from the project form', async () => {
  const { projectBody } = await import('../frontend/project-wizard');
  const values = new FormData();
  values.set('guided', 'on');
  values.set('checkpointEnabled', 'on');
  values.set(
    'checkpointCapture',
    JSON.stringify({
      mode: 'approved-region',
      region: { kind: 'role', role: 'heading', name: 'Reference Auth App', exact: true },
      masks: [],
    }),
  );
  expect(projectBody(values).execution).toMatchObject({
    checkpointCapture: { mode: 'approved-region', region: { name: 'Reference Auth App' } },
  });
});
