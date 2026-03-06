/**
 * v345: 凭证加解密服务 (CryptoService)
 * 
 * 使用 AES-256-GCM 对称加密算法保护敏感凭证数据。
 * 加密密钥通过环境变量 ENCRYPTION_KEY 配置（32字节 hex 字符串）。
 * 
 * 加密格式: "enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * - 前缀 "enc:v1:" 用于标识已加密的数据，便于向后兼容
 * - iv: 12字节随机初始化向量
 * - authTag: 16字节认证标签（GCM模式提供完整性校验）
 * - ciphertext: 加密后的密文
 * 
 * 安全特性:
 * - 每次加密使用随机 IV，相同明文产生不同密文
 * - GCM 模式提供认证加密，防止密文篡改
 * - 密钥不在代码中硬编码，仅通过环境变量注入
 */

import crypto from 'crypto';
import { createModuleLogger } from './logger';
const log = createModuleLogger('Crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推荐 12 字节 IV
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = 'enc:v1:';

/**
 * 获取加密密钥
 * 从环境变量 ENCRYPTION_KEY 读取，必须是 64 个 hex 字符（32 字节）
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      '[CryptoService] ENCRYPTION_KEY 环境变量未配置。' +
      '请在 Elastic Beanstalk 环境变量中设置一个 64 字符的 hex 字符串。'
    );
  }
  if (keyHex.length !== 64) {
    throw new Error(
      `[CryptoService] ENCRYPTION_KEY 长度错误: 期望 64 hex 字符 (32 字节), 实际 ${keyHex.length} 字符。`
    );
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * 检查值是否已经是加密格式
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * 加密字符串
 * @param plaintext 明文字符串
 * @returns 加密后的字符串，格式: "enc:v1:<iv>:<authTag>:<ciphertext>"
 */
export function encrypt(plaintext: string): string {
  if (!plaintext || plaintext.trim() === '') {
    return plaintext; // 空值不加密
  }
  
  // 如果已经加密，直接返回（幂等性）
  if (isEncrypted(plaintext)) {
    return plaintext;
  }
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * 解密字符串
 * @param ciphertext 加密后的字符串
 * @returns 解密后的明文
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext || ciphertext.trim() === '') {
    return ciphertext; // 空值直接返回
  }
  
  // 如果不是加密格式，说明是旧的明文数据，直接返回（向后兼容）
  if (!isEncrypted(ciphertext)) {
    return ciphertext;
  }
  
  const key = getEncryptionKey();
  
  // 解析加密格式: "enc:v1:<iv>:<authTag>:<ciphertext>"
  const withoutPrefix = ciphertext.slice(ENCRYPTED_PREFIX.length);
  const parts = withoutPrefix.split(':');
  
  if (parts.length !== 3) {
    throw new Error(
      `[CryptoService] 加密数据格式错误: 期望 3 个部分 (iv:authTag:ciphertext), 实际 ${parts.length} 个部分。`
    );
  }
  
  const [ivHex, authTagHex, encryptedHex] = parts;
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * 安全加密 — 带错误处理的加密包装器
 * 如果加密失败（如密钥未配置），返回原始明文并记录警告
 * 用于渐进式迁移期间，确保系统不会因加密失败而中断
 */
export function safeEncrypt(plaintext: string): string {
  try {
    return encrypt(plaintext);
  } catch (error: any) {
    log.warn(`[CryptoService] 加密失败，返回明文: ${error.message}`);
    return plaintext;
  }
}

/**
 * 安全解密 — 带错误处理的解密包装器
 * 如果解密失败，返回原始值并记录警告
 * 用于向后兼容，处理混合存储（部分加密、部分明文）的过渡期
 */
export function safeDecrypt(ciphertext: string): string {
  try {
    return decrypt(ciphertext);
  } catch (error: any) {
    log.warn(`[CryptoService] 解密失败，返回原始值: ${error.message}`);
    return ciphertext;
  }
}

/**
 * 检查加密服务是否可用（ENCRYPTION_KEY 已配置且格式正确）
 */
export function isCryptoAvailable(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * 自检：验证加密/解密流程是否正常工作
 * 在系统启动时调用，确保配置正确
 */
export function selfTest(): { success: boolean; error?: string } {
  try {
    const testPlaintext = 'crypto-service-self-test-' + Date.now();
    const encrypted = encrypt(testPlaintext);
    
    if (!isEncrypted(encrypted)) {
      return { success: false, error: '加密结果缺少正确前缀' };
    }
    
    const decrypted = decrypt(encrypted);
    
    if (decrypted !== testPlaintext) {
      return { success: false, error: '解密结果与原文不匹配' };
    }
    
    // 验证幂等性
    const doubleEncrypted = encrypt(encrypted);
    if (doubleEncrypted !== encrypted) {
      return { success: false, error: '重复加密未保持幂等性' };
    }
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
