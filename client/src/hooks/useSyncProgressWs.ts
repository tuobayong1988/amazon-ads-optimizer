/**
 * v671: WebSocket同步进度实时推送Hook
 * 
 * 通过WebSocket长连接接收后端同步进度推送，替代2秒一次的HTTP短轮询。
 * 
 * 设计原则：
 * - 渐进增强：WebSocket不可用时自动降级为HTTP轮询
 * - 自动重连：连接断开后指数退避重连（最大30秒间隔）
 * - 心跳保活：响应服务端ping保持连接活跃
 * - 类型安全：与后端syncProgressWs.ts共享消息类型定义
 * - v688: 防抖优化：合并高频progress消息，减少React重渲染
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// 与后端syncProgressWs.ts保持一致的消息类型
interface SyncProgressMessage {
  type: 'progress' | 'completed' | 'failed' | 'ping' | 'error';
  data?: {
    step?: string;
    stepIndex?: number;
    totalSteps?: number;
    progressPercent?: number;
    status?: string;
    errorMessage?: string;
    recordsSynced?: number;
    batchInfo?: {
      currentBatch: number;
      totalBatches: number;
      batchProgress: number;
    };
    // v686: 长耗时步骤子进度信息
    subProgress?: {
      phase: string;
      current: number;
      total: number;
      detail?: string;
    };
    // v688: 并行步骤多任务子进度汇总
    parallelSubProgress?: Record<string, {
      stepId: string;
      stepName: string;
      phase: string;
      current: number;
      total: number;
      detail?: string;
    }>;
  };
  timestamp?: string;
}

interface SyncProgressState {
  step: string;
  stepIndex: number;
  totalSteps: number;
  progressPercent: number;
  status: 'idle' | 'running' | 'completed' | 'failed';
  recordsSynced: number;
  batchInfo: {
    currentBatch: number;
    totalBatches: number;
    batchProgress: number;
  } | null;
  // v686: 长耗时步骤子进度
  subProgress: {
    phase: string;
    current: number;
    total: number;
    detail?: string;
  } | null;
  // v688: 并行步骤多任务子进度汇总
  parallelSubProgress: Record<string, {
    stepId: string;
    stepName: string;
    phase: string;
    current: number;
    total: number;
    detail?: string;
  }> | null;
  lastUpdated: Date | null;
}

interface UseSyncProgressWsOptions {
  accountId: string | number | null;
  enabled: boolean;
  onCompleted?: (recordsSynced: number) => void;
  onFailed?: (errorMessage: string) => void;
  onProgress?: (progress: SyncProgressState) => void;
}

interface UseSyncProgressWsResult {
  progress: SyncProgressState;
  isConnected: boolean;
  isWsActive: boolean;  // WebSocket是否活跃（用于判断是否需要降级到轮询）
  isAuthExpired: boolean; // v687: 登录Token是否已过期（区分后端异常与前端鉴权失效）
}

const INITIAL_STATE: SyncProgressState = {
  step: '',
  stepIndex: 0,
  totalSteps: 0,
  progressPercent: 0,
  status: 'idle',
  recordsSynced: 0,
  batchInfo: null,
  subProgress: null,
  parallelSubProgress: null, // v688
  lastUpdated: null,
};

// 重连参数
const RECONNECT_BASE_DELAY = 2000;  // 初始重连延迟2秒
const RECONNECT_MAX_DELAY = 30000;  // 最大重连延迟30秒
const MAX_RECONNECT_ATTEMPTS = 10;  // 最大重连次数

// v688: progress消息防抖参数
const PROGRESS_DEBOUNCE_MS = 150;   // 150ms防抖窗口，合并并行步骤的高频subProgress消息

export function useSyncProgressWs(options: UseSyncProgressWsOptions): UseSyncProgressWsResult {
  const { accountId, enabled, onCompleted, onFailed, onProgress } = options;
  
  const [progress, setProgress] = useState<SyncProgressState>(INITIAL_STATE);
  const [isConnected, setIsConnected] = useState(false);
  const [isWsActive, setIsWsActive] = useState(false);
  const [isAuthExpired, setIsAuthExpired] = useState(false); // v687: 登录过期检测
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  
  // v688: 防抖相关ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgressRef = useRef<SyncProgressState | null>(null);

  // 构建WebSocket URL
  const getWsUrl = useCallback(() => {
    if (!accountId) return null;
    const token = localStorage.getItem('authToken') || '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/api/sync-progress?accountId=${accountId}&token=${encodeURIComponent(token)}`;
  }, [accountId]);

  // 清理WebSocket连接
  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // v688: 清理防抖定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // v688: 如果有待处理的progress消息，立即刷新
    if (pendingProgressRef.current && mountedRef.current) {
      setProgress(pendingProgressRef.current);
      pendingProgressRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close(1000, 'cleanup');
      }
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // 重连逻辑
  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || !enabled || reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setIsWsActive(false);
      return;
    }
    
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptRef.current),
      RECONNECT_MAX_DELAY
    );
    
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current && enabled) {
        reconnectAttemptRef.current++;
        connect();
      }
    }, delay);
  }, [enabled]);

  // v688: 防抖更新progress状态 — 合并150ms内的连续消息，只取最新一条
  const debouncedSetProgress = useCallback((newState: SyncProgressState) => {
    pendingProgressRef.current = newState;
    
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      if (mountedRef.current && pendingProgressRef.current) {
        setProgress(pendingProgressRef.current);
        onProgress?.(pendingProgressRef.current);
        pendingProgressRef.current = null;
      }
      debounceTimerRef.current = null;
    }, PROGRESS_DEBOUNCE_MS);
  }, [onProgress]);

  // 建立WebSocket连接
  const connect = useCallback(() => {
    const url = getWsUrl();
    if (!url || !enabled) return;

    cleanup();

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        setIsWsActive(true);
        reconnectAttemptRef.current = 0; // 重置重连计数
        console.log('[v671] WebSocket同步进度连接已建立');
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg: SyncProgressMessage = JSON.parse(event.data);
          
          switch (msg.type) {
            case 'ping':
              // 响应心跳
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'pong' }));
              }
              break;
              
            case 'progress': {
              const newState: SyncProgressState = {
                step: msg.data?.step || '',
                stepIndex: msg.data?.stepIndex || 0,
                totalSteps: msg.data?.totalSteps || 0,
                progressPercent: msg.data?.progressPercent || 0,
                status: 'running',
                recordsSynced: msg.data?.recordsSynced || 0,
                batchInfo: msg.data?.batchInfo || null,
                subProgress: msg.data?.subProgress || null, // v686: 子进度
                parallelSubProgress: msg.data?.parallelSubProgress || null, // v688: 并行子进度
                lastUpdated: new Date(),
              };
              // v688: 使用防抖更新，合并并行步骤的高频消息
              // 步骤切换（stepIndex变化）时立即更新，不走防抖
              const currentPending = pendingProgressRef.current;
              const isStepChange = !currentPending || currentPending.stepIndex !== newState.stepIndex;
              if (isStepChange) {
                // 步骤切换 — 立即更新，确保用户看到步骤变化
                if (debounceTimerRef.current) {
                  clearTimeout(debounceTimerRef.current);
                  debounceTimerRef.current = null;
                }
                pendingProgressRef.current = null;
                setProgress(newState);
                onProgress?.(newState);
              } else {
                // 同一步骤内的subProgress更新 — 防抖合并
                debouncedSetProgress(newState);
              }
              break;
            }
              
            case 'completed': {
              // v688: 清理防抖定时器，确保completed消息立即处理
              if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
              }
              pendingProgressRef.current = null;
              const completedState: SyncProgressState = {
                ...progress,
                progressPercent: 100,
                status: 'completed',
                recordsSynced: msg.data?.recordsSynced || 0,
                lastUpdated: new Date(),
              };
              setProgress(completedState);
              onCompleted?.(msg.data?.recordsSynced || 0);
              break;
            }
              
            case 'failed': {
              // v688: 清理防抖定时器，确保failed消息立即处理
              if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
              }
              pendingProgressRef.current = null;
              const failedState: SyncProgressState = {
                ...progress,
                status: 'failed',
                lastUpdated: new Date(),
              };
              setProgress(failedState);
              onFailed?.(msg.data?.errorMessage || '同步失败');
              break;
            }
              
            case 'error':
              console.warn('[v671] WebSocket服务端错误:', msg.data?.errorMessage);
              break;
          }
        } catch (parseErr) {
          console.warn('[v671] WebSocket消息解析失败:', parseErr);
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        console.warn('[v671] WebSocket连接错误');
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        setIsConnected(false);
        
        // v687: 检测登录Token过期 — 服务端返回401时会直接销毁socket
        // 表现为: close code 1006(异常关闭) 且连接存活时间极短(<3秒)，或 close code 1008(Policy Violation)
        const isAuthFailure = event.code === 1008 || 
          (event.code === 1006 && event.reason?.includes?.('401')) ||
          (event.code === 1006 && event.reason?.includes?.('Unauthorized'));
        
        if (isAuthFailure) {
          console.warn('[v687] WebSocket: 登录Token已过期，需要重新登录');
          setIsAuthExpired(true);
          setIsWsActive(false);
          // 不再尝试重连，因为Token过期后重连也会失败
          return;
        }
        
        // v687: 如果连续多次快速断开（<5秒内），可能是Token问题
        if (event.code === 1006 && reconnectAttemptRef.current >= 3) {
          console.warn('[v687] WebSocket: 连续快速断开，可能是登录Token已过期');
          setIsAuthExpired(true);
          setIsWsActive(false);
          return;
        }
        
        // 非正常关闭时尝试重连
        if (event.code !== 1000 && enabled) {
          scheduleReconnect();
        } else {
          setIsWsActive(false);
        }
      };
    } catch (err) {
      console.warn('[v671] WebSocket创建失败:', err);
      setIsWsActive(false);
    }
  }, [getWsUrl, enabled, cleanup, scheduleReconnect, onCompleted, onFailed, onProgress, debouncedSetProgress]);

  // 当accountId或enabled变化时重新连接
  useEffect(() => {
    mountedRef.current = true;
    
    if (enabled && accountId) {
      reconnectAttemptRef.current = 0;
      connect();
    } else {
      cleanup();
      setIsWsActive(false);
      setProgress(INITIAL_STATE);
    }

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [accountId, enabled]);

  return {
    progress,
    isConnected,
    isWsActive,
    isAuthExpired, // v687: 登录过期状态
  };
}
