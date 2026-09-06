import { useId, useState } from 'react';
import type { CheckpointCapture } from '../../../worker/src/checkpoint-capture';
import type { ScreenshotSemanticLocator } from '../../../../packages/playwright-screenshot-privacy/src';
import { Button, Checkbox, Input, Label, Select } from './components';

function LocatorFields({
  value,
  onChange,
  caption,
}: {
  value: ScreenshotSemanticLocator;
  onChange: (value: ScreenshotSemanticLocator) => void;
  caption: string;
}) {
  return (
    <div className="form-grid">
      <Label>
        {caption} locator
        <Select
          value={value.kind}
          onChange={(event) =>
            onChange(
              event.target.value === 'role'
                ? { kind: 'role', role: 'heading', name: value.name ?? '', exact: true }
                : { kind: 'label', name: value.name ?? '', exact: true },
            )
          }
        >
          <option value="role">Accessible role and name</option>
          <option value="label">Field label</option>
        </Select>
      </Label>
      {value.kind === 'role' && (
        <Label>
          {caption} role
          <Input
            value={value.role}
            onChange={(event) => onChange({ ...value, role: event.target.value })}
            required
            maxLength={160}
            placeholder="heading"
          />
        </Label>
      )}
      <Label>
        {caption} exact name
        <Input
          value={value.name ?? ''}
          onChange={(event) => {
            const name = event.target.value;
            onChange(
              value.kind === 'role' && !name && caption !== 'Region'
                ? { kind: 'role', role: value.role, exact: true }
                : { ...value, name },
            );
          }}
          required={caption === 'Region' || value.kind === 'label'}
          maxLength={160}
          placeholder="Account settings"
        />
      </Label>
    </div>
  );
}
export function CheckpointSettings({ initial }: { initial?: CheckpointCapture }) {
  const [enabled, setEnabled] = useState(!!initial);
  const [capture, setCapture] = useState<CheckpointCapture>(
    initial ?? {
      mode: 'approved-region',
      region: { kind: 'role', role: 'heading', name: '', exact: true },
      masks: [],
    },
  );
  const hint = useId();
  return (
    <div className="checkpoint-settings">
      <Checkbox
        name="checkpointEnabled"
        checked={enabled}
        onChange={(event) => setEnabled(event.target.checked)}
        label="Show workflow screenshots in run results"
      />
      <p className="muted" id={hint}>
        Choose the exact region approved for capture. It must exist at every workflow checkpoint.
        Add masks for sensitive fields, then confirm screenshot consent below.
      </p>
      <fieldset hidden={!enabled} disabled={!enabled} aria-describedby={hint}>
        <legend>Workflow checkpoint capture</legend>
        <input type="hidden" name="checkpointCapture" value={JSON.stringify(capture)} />
        <Label>
          Capture area
          <Select
            value={capture.mode}
            onChange={(event) =>
              setCapture(
                event.target.value === 'approved-region'
                  ? {
                      mode: 'approved-region',
                      region: { kind: 'role', role: 'heading', name: '', exact: true },
                      masks: capture.masks,
                    }
                  : {
                      mode: 'masked-page',
                      fullPage: true,
                      masks: capture.masks.length
                        ? (capture.masks as [
                            ScreenshotSemanticLocator,
                            ...ScreenshotSemanticLocator[],
                          ])
                        : [{ kind: 'label', name: '', exact: true }],
                    },
              )
            }
          >
            <option value="approved-region">Only an approved region</option>
            <option value="masked-page">Page with required privacy masks</option>
          </Select>
        </Label>
        {capture.mode === 'approved-region' ? (
          <LocatorFields
            caption="Region"
            value={capture.region}
            onChange={(region) => setCapture({ ...capture, region })}
          />
        ) : (
          <Checkbox
            label="Capture full page"
            checked={capture.fullPage}
            onChange={(event) => setCapture({ ...capture, fullPage: event.target.checked })}
          />
        )}
        {capture.masks.map((mask, index) => (
          <div key={index}>
            <LocatorFields
              caption={`Mask ${index + 1}`}
              value={mask}
              onChange={(value) =>
                setCapture({
                  ...capture,
                  masks: capture.masks.map((item, i) => (i === index ? value : item)),
                } as CheckpointCapture)
              }
            />
            <Button
              type="button"
              variant="outline"
              disabled={capture.mode === 'masked-page' && capture.masks.length === 1}
              onClick={() =>
                setCapture({
                  ...capture,
                  masks: capture.masks.filter((_, i) => i !== index),
                } as CheckpointCapture)
              }
            >
              Remove mask {index + 1}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setCapture({
              ...capture,
              masks: [...capture.masks, { kind: 'label', name: '', exact: true }],
            } as CheckpointCapture)
          }
        >
          Add privacy mask
        </Button>
      </fieldset>
    </div>
  );
}
