import { Button, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';

export default function ThemeToggle() {
  const colorScheme = useComputedColorScheme('light', { getInitialValueInEffect: false });
  const { setColorScheme } = useMantineColorScheme();
  const nextScheme = colorScheme === 'light' ? 'dark' : 'light';

  return (
    <Button
      variant="default"
      size="xs"
      className="theme-toggle"
      aria-label={`Switch to ${nextScheme} mode`}
      onClick={() => setColorScheme(nextScheme)}
      leftSection={
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {nextScheme === 'dark'
            ? <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />
            : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>}
        </svg>
      }
    >
      {nextScheme === 'dark' ? 'Dark mode' : 'Light mode'}
    </Button>
  );
}
