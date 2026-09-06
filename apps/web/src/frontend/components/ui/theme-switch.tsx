import { useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { applyTheme, currentTheme, type Theme } from '../../theme';

const options: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'Follow system theme', icon: Monitor },
];
/** Segmented Light / Dark / System control; persists through theme.ts. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          type="button"
          key={value}
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => {
            applyTheme(value);
            setTheme(value);
          }}
        >
          <Icon size={14} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
