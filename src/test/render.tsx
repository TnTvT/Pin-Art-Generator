import { MantineProvider } from '@mantine/core';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

export function renderWithProviders(element: ReactElement, options?: RenderOptions) {
  return render(element, {
    wrapper: ({ children }: { children: ReactNode }) => <MantineProvider env="test">{children}</MantineProvider>,
    ...options,
  });
}
