/**
 * useDebounce hooks 单元测试
 * 测试防抖值、防抖回调和节流回调的行为
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce, useDebouncedCallback, useThrottledCallback } from './useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('useDebounce (value)', () => {
    it('should return initial value immediately', () => {
      const { result } = renderHook(() => useDebounce('hello', 500));
      expect(result.current).toBe('hello');
    });

    it('should not update value before delay', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: 'hello', delay: 500 } }
      );

      rerender({ value: 'world', delay: 500 });
      expect(result.current).toBe('hello');
    });

    it('should update value after delay', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: 'hello', delay: 500 } }
      );

      rerender({ value: 'world', delay: 500 });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(result.current).toBe('world');
    });

    it('should reset timer on rapid changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: 'a', delay: 500 } }
      );

      rerender({ value: 'b', delay: 500 });
      act(() => { vi.advanceTimersByTime(200); });

      rerender({ value: 'c', delay: 500 });
      act(() => { vi.advanceTimersByTime(200); });

      // Only 200ms since last change, should still be 'a'
      expect(result.current).toBe('a');

      act(() => { vi.advanceTimersByTime(300); });
      // Now 500ms since last change to 'c'
      expect(result.current).toBe('c');
    });

    it('should work with number values', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: 0, delay: 300 } }
      );

      rerender({ value: 42, delay: 300 });
      act(() => { vi.advanceTimersByTime(300); });
      expect(result.current).toBe(42);
    });
  });

  describe('useDebouncedCallback', () => {
    it('should not call callback immediately', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 500));

      act(() => {
        result.current('test');
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should call callback after delay', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 500));

      act(() => {
        result.current('test');
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('test');
    });

    it('should only call once for rapid invocations', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 500));

      act(() => {
        result.current('a');
        result.current('b');
        result.current('c');
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('c');
    });

    it('should call multiple times with sufficient delay between calls', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 200));

      act(() => { result.current('first'); });
      act(() => { vi.advanceTimersByTime(200); });

      act(() => { result.current('second'); });
      act(() => { vi.advanceTimersByTime(200); });

      expect(callback).toHaveBeenCalledTimes(2);
    });
  });

  describe('useThrottledCallback', () => {
    it('should call callback immediately on first invocation', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useThrottledCallback(callback, 500));

      act(() => {
        result.current('test');
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('test');
    });

    it('should not call again within throttle period', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useThrottledCallback(callback, 500));

      act(() => {
        result.current('first');
        result.current('second');
      });

      // Only first call should have executed immediately
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('first');
    });

    it('should execute trailing call after throttle period', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useThrottledCallback(callback, 500));

      act(() => {
        result.current('first');
      });

      act(() => {
        result.current('second');
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenLastCalledWith('second');
    });

    it('should allow new calls after throttle period expires', () => {
      const callback = vi.fn();
      const { result } = renderHook(() => useThrottledCallback(callback, 200));

      act(() => { result.current('first'); });
      expect(callback).toHaveBeenCalledTimes(1);

      act(() => { vi.advanceTimersByTime(200); });

      act(() => { result.current('second'); });
      expect(callback).toHaveBeenCalledTimes(2);
    });
  });
});
