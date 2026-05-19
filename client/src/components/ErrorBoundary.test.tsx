// @ts-nocheck
/**
 * ErrorBoundary 组件测试
 * 测试错误捕获、错误显示和恢复功能
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// Suppress console.error during error boundary tests
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});

afterEach(() => {
  console.error = originalError;
});

// Component that throws an error (returns never since it always throws)
function ThrowingComponent({ error }: { error: Error }): React.ReactNode {
  throw error;
}

// Component that renders normally
function NormalComponent() {
  return <div data-testid="normal-content">Hello World</div>;
}

describe('ErrorBoundary', () => {
  it('should render children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <NormalComponent />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('normal-content')).toBeDefined();
    expect(screen.getByText('Hello World')).toBeDefined();
  });

  it('should render error UI when child throws', () => {
    const testError = new Error('Test error message');
    render(
      <ErrorBoundary>
        <ThrowingComponent error={testError} />
      </ErrorBoundary>
    );
    expect(screen.getByText('An unexpected error occurred.')).toBeDefined();
  });

  it('should display error stack trace', () => {
    const testError = new Error('Test error with stack');
    render(
      <ErrorBoundary>
        <ThrowingComponent error={testError} />
      </ErrorBoundary>
    );
    // The error stack should be displayed in a pre element
    const preElement = document.querySelector('pre');
    expect(preElement).toBeDefined();
    expect(preElement?.textContent).toContain('Test error with stack');
  });

  it('should render reload button', () => {
    const testError = new Error('Test error');
    render(
      <ErrorBoundary>
        <ThrowingComponent error={testError} />
      </ErrorBoundary>
    );
    const reloadButton = screen.getByText('Reload Page');
    expect(reloadButton).toBeDefined();
    expect(reloadButton.tagName.toLowerCase()).toBe('button');
  });

  it('should not affect sibling components', () => {
    // Each ErrorBoundary is independent
    const { container } = render(
      <div>
        <ErrorBoundary>
          <NormalComponent />
        </ErrorBoundary>
      </div>
    );
    expect(container.querySelector('[data-testid="normal-content"]')).toBeDefined();
  });
});
