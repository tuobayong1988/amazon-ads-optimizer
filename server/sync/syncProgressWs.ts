/**
 * v671: WebSocket 同步进度实时推送服务
 * 
 * 替代前端2秒一次的短轮询机制，由后端主动推送同步进度更新：
 * - 降低服务器查询负载（消除每2秒一次的DB查询）
 * - 提供更平滑的实时进度反馈
 * - 保留HTTP轮询作为降级方案（WebSocket断开时自动切换）
 * 
 * 协议设计：
 * - 客户端连接: ws://host/api/sync-progress?accountId=xxx&token=xxx
 * - 服务端推送: { type: 'progress', accountId, data: { step, stepIndex, totalSteps, progressPercent, ... } }
 * - 心跳保活: 服务端每30秒发送 { type: 'ping' }，客户端回复 { type: 'pong' }
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import type { IncomingMessage } from 'http';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('SyncProgressWs');

// ==================== 类型定义 ====================

interface SyncProgressMessage {
  type: 'progress' | 'completed' | 'failed' | 'ping' | 'error';
  accountId?: number;
  data?: {
    step?: string;
    stepIndex?: number;
    totalSteps?: number;
    progressPercent?: number;
    status?: string;
    errorMessage?: string;
    recordsSynced?: number;
    // v671: 批次进度信息
    batchInfo?: {
      currentBatch: number;
      totalBatches: number;
      batchProgress: number;
    };
    // v686: 长耗时步骤子进度信息 — 缓解用户等待焦虑
    subProgress?: {
      phase: string;       // 子阶段名称（如"提交报告"、"轮询报告"、"处理数据"）
      current: number;     // 当前进度
      total: number;       // 总量
      detail?: string;     // 详细描述（如"SP广告活动 3/14天"）
    };
  };
  message?: string;
}

interface ConnectedClient {
  ws: WebSocket;
  accountId: number;
  userId: number;
  connectedAt: Date;
  lastPong: Date;
}

// ==================== 单例状态 ====================

let wss: WebSocketServer | null = null;
const clients = new Map<string, ConnectedClient>(); // key: `${userId}:${accountId}`
const HEARTBEAT_INTERVAL_MS = 30000; // 30秒心跳
const CLIENT_TIMEOUT_MS = 90000; // 90秒无响应断开
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// ==================== 初始化 ====================

/**
 * 初始化WebSocket服务器，挂载到现有HTTP服务器上
 * 
 * @param httpServer - Express创建的HTTP服务器实例
 */
export function initSyncProgressWebSocket(httpServer: HttpServer): void {
  if (wss) {
    log.warn('[SyncProgressWs] WebSocket服务器已初始化，跳过重复初始化');
    return;
  }

  wss = new WebSocketServer({ 
    noServer: true,  // 不自动创建HTTP服务器，使用upgrade事件手动处理
  });

  // 处理HTTP upgrade请求
  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    
    // 只处理 /api/sync-progress 路径的WebSocket升级请求
    if (url.pathname !== '/api/sync-progress') {
      return; // 让其他WebSocket处理器（如Vite HMR）处理
    }

    // 验证参数
    const accountId = parseInt(url.searchParams.get('accountId') || '0', 10);
    const token = url.searchParams.get('token') || '';

    if (!accountId || !token) {
      log.warn('[SyncProgressWs] 拒绝连接: 缺少accountId或token');
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // 验证token（异步）
    verifyToken(token).then(userId => {
      if (!userId) {
        log.warn('[SyncProgressWs] 拒绝连接: token验证失败');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // 完成WebSocket握手
      wss!.handleUpgrade(request, socket, head, (ws) => {
        handleConnection(ws, userId, accountId);
      });
    }).catch(err => {
      log.warn(`[SyncProgressWs] token验证异常: ${(err as Error).message}`);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  });

  // 启动心跳定时器
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, client] of clients.entries()) {
      // 检查客户端是否超时
      if (now - client.lastPong.getTime() > CLIENT_TIMEOUT_MS) {
        log.debug(`[SyncProgressWs] 客户端超时断开: ${key}`);
        client.ws.terminate();
        clients.delete(key);
        continue;
      }
      // 发送心跳
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // 发送失败，清理
          clients.delete(key);
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  log.info('[SyncProgressWs] v671: WebSocket同步进度推送服务已初始化');
}

// ==================== 连接管理 ====================

function handleConnection(ws: WebSocket, userId: number, accountId: number): void {
  const clientKey = `${userId}:${accountId}`;
  
  // 如果已有同一用户+账户的连接，关闭旧连接
  const existing = clients.get(clientKey);
  if (existing) {
    try {
      existing.ws.close(1000, 'Replaced by new connection');
    } catch {
      // ignore
    }
  }

  const client: ConnectedClient = {
    ws,
    accountId,
    userId,
    connectedAt: new Date(),
    lastPong: new Date(),
  };
  clients.set(clientKey, client);

  log.info(`[SyncProgressWs] 客户端连接: userId=${userId}, accountId=${accountId}, 当前连接数=${clients.size}`);

  // 处理客户端消息
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'pong') {
        client.lastPong = new Date();
      }
    } catch {
      // 忽略无效消息
    }
  });

  // 处理断开
  ws.on('close', () => {
    clients.delete(clientKey);
    log.debug(`[SyncProgressWs] 客户端断开: userId=${userId}, accountId=${accountId}, 剩余连接数=${clients.size}`);
  });

  ws.on('error', (err) => {
    log.debug(`[SyncProgressWs] 客户端错误: ${err.message}`);
    clients.delete(clientKey);
  });
}

// ==================== 进度推送 ====================

/**
 * 向订阅了指定账户的所有客户端推送同步进度
 * 
 * 在心跳更新和步骤完成时调用此函数
 */
export function broadcastSyncProgress(accountId: number, data: SyncProgressMessage['data']): void {
  if (!wss || clients.size === 0) return;

  const message = JSON.stringify({
    type: 'progress',
    accountId,
    data,
  });

  let sentCount = 0;
  for (const [key, client] of clients.entries()) {
    if (client.accountId === accountId && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(message);
        sentCount++;
      } catch {
        clients.delete(key);
      }
    }
  }

  if (sentCount > 0) {
    log.debug(`[SyncProgressWs] 推送进度: accountId=${accountId}, progressPercent=${data?.progressPercent}, 发送给${sentCount}个客户端`);
  }
}

/**
 * 推送同步完成事件
 */
export function broadcastSyncCompleted(accountId: number, data?: SyncProgressMessage['data']): void {
  if (!wss || clients.size === 0) return;

  const message = JSON.stringify({
    type: 'completed',
    accountId,
    data: { ...data, status: 'completed', progressPercent: 100 },
  });

  for (const [key, client] of clients.entries()) {
    if (client.accountId === accountId && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(message);
      } catch {
        clients.delete(key);
      }
    }
  }
}

/**
 * 推送同步失败事件
 */
export function broadcastSyncFailed(accountId: number, errorMessage: string): void {
  if (!wss || clients.size === 0) return;

  const message = JSON.stringify({
    type: 'failed',
    accountId,
    data: { status: 'failed', errorMessage },
  });

  for (const [key, client] of clients.entries()) {
    if (client.accountId === accountId && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(message);
      } catch {
        clients.delete(key);
      }
    }
  }
}

// ==================== Token验证 ====================

async function verifyToken(token: string): Promise<number | null> {
  try {
    // 复用现有的JWT验证逻辑
    const jwt = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'default-secret';
    const decoded = jwt.verify(token, secret) as { userId?: number; id?: number; sub?: string };
    return decoded.userId || decoded.id || (decoded.sub ? parseInt(decoded.sub, 10) : null);
  } catch {
    return null;
  }
}

// ==================== 清理 ====================

export function shutdownSyncProgressWebSocket(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  
  // 关闭所有客户端连接
  for (const [, client] of clients) {
    try {
      client.ws.close(1001, 'Server shutting down');
    } catch {
      // ignore
    }
  }
  clients.clear();

  if (wss) {
    wss.close();
    wss = null;
  }

  log.info('[SyncProgressWs] WebSocket服务器已关闭');
}

// ==================== 状态查询 ====================

export function getWsClientCount(): number {
  return clients.size;
}

export function getWsClientsByAccount(accountId: number): number {
  let count = 0;
  for (const client of clients.values()) {
    if (client.accountId === accountId) count++;
  }
  return count;
}
