'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { buttonStyles } from '@/components/ui';
import { cn } from '@/lib/utils';

export const THEME_STORAGE_KEY = 'ailist-theme';

/**
 * The script that runs before first paint. It has to be inlined in <head> and
 * duplicated here (rather than imported) because it must execute before React
 * hydrates — otherwise the page flashes light before the dark class lands.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

type Theme = 'light' | 'dark' | 'system';

const ORDER: Theme[] = ['system', 'light', 'dark'];

const META: Record<Theme, { label: string; Icon: typeof Sun }> = {
  system: { label: 'System theme', Icon: Monitor },
  light: { label: 'Light theme', Icon: Sun },
  dark: { label: 'Dark theme', Icon: Moon },
};

function apply(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle({ className }: { className?: string }) {
  // Starts as null and is filled in after mount: the server has no idea what is
  // in localStorage, so rendering a concrete icon on the first pass would
  // guarantee a hydration mismatch.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    setTheme(stored === 'light' || stored === 'dark' ? stored : 'system');
  }, []);

  useEffect(() => {
    if (theme !== 'system') return;
    // Only while following the system do we care about it changing under us.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const current = theme ?? 'system';
  const { label, Icon } = META[current];

  function cycle() {
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
    setTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    apply(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${label}. Activate to change theme.`}
      title={label}
      className={cn(buttonStyles.ghost, 'size-8 p-0', className)}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
