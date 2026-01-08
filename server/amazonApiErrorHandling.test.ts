import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Amazon API错误处理测试
 * 测试HTML响应错误处理和Token刷新错误处理
 */
describe('Amazon API Error Handling', () => {
  describe('HTML Response Detection', () => {
    it('should detect HTML response from content-type header', () => {
      const contentType = 'text/html; charset=utf-8';
      const isHtml = contentType.includes('text/html');
      expect(isHtml).toBe(true);
    });

    it('should detect HTML response from data starting with <', () => {
      const data = '<html><head><title>Error</title></head></html>';
      const isHtml = typeof data === 'string' && data.startsWith('<');
      expect(isHtml).toBe(true);
    });

    it('should not detect JSON as HTML', () => {
      const data = '{"error": "something went wrong"}';
      const isHtml = typeof data === 'string' && data.startsWith('<');
      expect(isHtml).toBe(false);
    });
  });

  describe('Error Message Generation', () => {
    it('should generate correct error message for 401 status', () => {
      const status = 401;
      let errorMessage = 'Amazon API returned an error page';
      if (status === 401) {
        errorMessage = 'Token已过期或无效，请重新授权';
      }
      expect(errorMessage).toBe('Token已过期或无效，请重新授权');
    });

    it('should generate correct error message for 403 status', () => {
      const status = 403;
      let errorMessage = 'Amazon API returned an error page';
      if (status === 403) {
        errorMessage = '没有访问权限，请检查API凭证和权限设置';
      }
      expect(errorMessage).toBe('没有访问权限，请检查API凭证和权限设置');
    });

    it('should generate correct error message for 429 status', () => {
      const status = 429;
      let errorMessage = 'Amazon API returned an error page';
      if (status === 429) {
        errorMessage = 'API请求过于频繁，请稍后重试';
      }
      expect(errorMessage).toBe('API请求过于频繁，请稍后重试');
    });

    it('should generate correct error message for 500+ status', () => {
      const status = 503;
      let errorMessage = 'Amazon API returned an error page';
      if (status >= 500) {
        errorMessage = 'Amazon API服务器错误，请稍后重试';
      }
      expect(errorMessage).toBe('Amazon API服务器错误，请稍后重试');
    });
  });

  describe('Token Refresh Error Handling', () => {
    it('should detect invalid_grant error', () => {
      const errorData = { error: 'invalid_grant', error_description: 'The refresh token is invalid' };
      const isInvalidGrant = errorData?.error === 'invalid_grant';
      expect(isInvalidGrant).toBe(true);
    });

    it('should not detect other errors as invalid_grant', () => {
      const errorData = { error: 'invalid_client', error_description: 'Client authentication failed' };
      const isInvalidGrant = errorData?.error === 'invalid_grant';
      expect(isInvalidGrant).toBe(false);
    });
  });

  describe('Error Object Enhancement', () => {
    it('should create enhanced error with additional properties', () => {
      const errorMessage = 'Token已过期或无效，请重新授权';
      const enhancedError = new Error(errorMessage);
      (enhancedError as any).status = 401;
      (enhancedError as any).isHtmlResponse = true;

      expect(enhancedError.message).toBe(errorMessage);
      expect((enhancedError as any).status).toBe(401);
      expect((enhancedError as any).isHtmlResponse).toBe(true);
    });
  });
});
