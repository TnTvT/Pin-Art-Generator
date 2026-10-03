import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ActionIcon, Popover } from '@mantine/core';

export default function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  function handleEscape(event: KeyboardEvent) {
    if (opened && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpened(false);
    }
  }
  return <Popover opened={opened} onChange={setOpened} width={280} position="bottom-end" shadow="md" returnFocus trapFocus>
    <Popover.Target><ActionIcon variant="subtle" color="gray" size={28} aria-label={label} onClick={() => setOpened(!opened)} onKeyDown={handleEscape}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" />
      </svg>
    </ActionIcon></Popover.Target>
    <Popover.Dropdown role="dialog" aria-label={label} className="info-popover" onKeyDown={handleEscape}>{children}</Popover.Dropdown>
  </Popover>;
}
