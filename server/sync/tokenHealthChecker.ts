/**
 * server/sync/tokenHealthChecker.ts
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */



export async function precheckToken(credentials, accountId, accountName2, marketplace) {
  const cached2 = tokenHealthCache.get(accountId);
  if (cached2 && cached2.lastCheckedAt) {
    const cacheAge = Date.now() - cached2.lastCheckedAt.getTime();
    if (cached2.status === "healthy" && cacheAge < CONFIG.HEALTHY_CACHE_TTL_MS) {
      return { valid: true };
    }
    if (cached2.status !== "healthy" && cached2.status !== "unchecked") {
      if (cacheAge < CONFIG.UNHEALTHY_CACHE_TTL_MS) {
        return { valid: false, error: cached2.lastErrorMessage || "Token cached as invalid", errorType: cached2.status };
      }
      log80.info(`[TokenHealth] \u8D26\u6237${accountId}(${accountName2}) Token\u5931\u6548\u7F13\u5B58\u5DF2\u8FC7\u671F(${Math.round(cacheAge / 6e4)}\u5206\u949F)\uFF0C\u5C1D\u8BD5\u91CD\u65B0\u9A8C\u8BC1`);
    }
  }
  try {
    const axios2 = (await Promise.resolve().then(() => (init_axios2(), axios_exports))).default;
    const tokenResponse = await axios2.post(
      "https://api.amazon.com/auth/o2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: CONFIG.PRECHECK_TIMEOUT_MS
      }
    );
    if (!tokenResponse.data?.access_token) {
      throw new Error("Token\u5237\u65B0\u8FD4\u56DE\u7A7Aaccess_token");
    }
    updateHealthStatus(accountId, accountName2, marketplace, "healthy", null);
    return { valid: true };
  } catch (error48) {
    const err = error48;
    let errorType = "unknown_error";
    let errorMessage = err.message;
    if (err.response) {
      const status = err.response.status;
      const data = err.response.data;
      if (status === 400 && data?.error === "invalid_grant") {
        errorType = "invalid_grant";
        errorMessage = `Refresh Token\u5DF2\u5931\u6548(invalid_grant): ${data.error_description || "\u9700\u8981\u7528\u6237\u91CD\u65B0\u6388\u6743"}`;
      } else if (status === 401) {
        errorType = "auth_error";
        errorMessage = `\u8BA4\u8BC1\u5931\u8D25(401): API\u51ED\u8BC1\u53EF\u80FD\u65E0\u6548`;
      } else if (status === 403) {
        errorType = "auth_error";
        errorMessage = `\u6743\u9650\u4E0D\u8DB3(403): ${JSON.stringify(data).substring(0, 200)}`;
      } else {
        errorType = "unknown_error";
        errorMessage = `HTTP ${status}: ${JSON.stringify(data).substring(0, 200)}`;
      }
    } else if (err.message?.includes("timeout")) {
      errorType = "unknown_error";
      errorMessage = `Token\u9A8C\u8BC1\u8D85\u65F6(${CONFIG.PRECHECK_TIMEOUT_MS}ms)`;
    }
    updateHealthStatus(accountId, accountName2, marketplace, errorType, errorMessage);
    // v620-fix13: P0-3 Fix - Auto-disconnect account on invalid_grant in tokenHealthChecker
    if (errorType === 'invalid_grant') {
      try {
        const { updateAdAccountConnectionStatus: updateConnStatus_thc } = await Promise.resolve().then(() => (init_accounts(), accounts_exports));
        await updateConnStatus_thc(accountId, 'disconnected', `[TokenHealthChecker] ${errorMessage}`);
        log80.warn(`[TokenHealth] v620-fix13: Account ${accountId}(${accountName2}) connectionStatus set to 'disconnected' due to invalid_grant`);
      } catch (disconnErr) {
        log80.warn(`[TokenHealth] v620-fix13: Failed to auto-disconnect account ${accountId}: ${disconnErr.message}`);
      }
    }
    if (!cached2 || cached2.status !== errorType) {
      await sendTokenAlert(accountId, accountName2, marketplace, errorType, errorMessage);
    }
    return { valid: false, error: errorMessage, errorType };
  }
}
function updateHealthStatus(accountId, accountName2, marketplace, status, errorMessage) {
  const existing = tokenHealthCache.get(accountId);
  const consecutiveFailures2 = status === "healthy" ? 0 : (existing?.consecutiveFailures || 0) + 1;
  tokenHealthCache.set(accountId, {
    accountId,
    accountName: accountName2,
    marketplace,
    status,
    lastCheckedAt: /* @__PURE__ */ new Date(),
    lastErrorMessage: errorMessage,
    consecutiveFailures: consecutiveFailures2,
    autoRecoveryAttemptAt: status === "healthy" ? null : existing?.autoRecoveryAttemptAt || null
  });
}
async function sendTokenAlert(accountId, accountName2, marketplace, errorType, errorMessage) {
  try {
    const { notifyOwner: notifyOwner2 } = await Promise.resolve().then(() => (init_notification(), notification_exports));
    await notifyOwner2({
      title: `[\u5E7F\u544A\u7CFB\u7EDF] Token\u5065\u5EB7\u68C0\u67E5\u5931\u8D25 - ${accountName2}(${marketplace})`,
      content: [
        `\u8D26\u6237ID: ${accountId}`,
        `\u8D26\u6237\u540D: ${accountName2}`,
        `\u7AD9\u70B9: ${marketplace}`,
        `\u9519\u8BEF\u7C7B\u578B: ${errorType}`,
        `\u9519\u8BEF\u8BE6\u60C5: ${errorMessage}`,
        `\u68C0\u67E5\u65F6\u95F4: ${(/* @__PURE__ */ new Date()).toISOString()}`,
        "",
        errorType === "invalid_grant" ? "\u64CD\u4F5C\u5EFA\u8BAE: \u8BF7\u767B\u5F55\u7CFB\u7EDF\u524D\u7AEF\uFF0C\u4E3A\u8BE5\u8D26\u6237\u91CD\u65B0\u5B8C\u6210 Amazon OAuth \u6388\u6743\u6D41\u7A0B" : "\u64CD\u4F5C\u5EFA\u8BAE: \u8BF7\u68C0\u67E5API\u51ED\u8BC1\u914D\u7F6E\u662F\u5426\u6B63\u786E"
      ].join("\n")
    });
    log80.info(`[TokenHealth] \u5DF2\u53D1\u9001Token\u5931\u6548\u544A\u8B66 - \u8D26\u6237${accountId}(${accountName2})`);
  } catch (notifyErr) {
    log80.warn(`[TokenHealth] \u544A\u8B66\u53D1\u9001\u5931\u8D25: ${notifyErr.message}`);
  }
}
export function shouldSkipSync(accountId) {
  const status = tokenHealthCache.get(accountId);
  if (!status) return { skip: false };
  if (status.status === "invalid_grant") {
    return {
      skip: true,
      reason: `Token\u5DF2\u5931\u6548(invalid_grant)\uFF0C\u9700\u8981\u7528\u6237\u91CD\u65B0\u6388\u6743\u3002\u4E0A\u6B21\u68C0\u67E5: ${status.lastCheckedAt?.toISOString()}`
    };
  }
  if (status.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES && status.status !== "healthy") {
    return {
      skip: true,
      reason: `Token\u8FDE\u7EED${status.consecutiveFailures}\u6B21\u9A8C\u8BC1\u5931\u8D25(${status.status})\u3002\u4E0A\u6B21\u9519\u8BEF: ${status.lastErrorMessage}`
    };
  }
  return { skip: false };
}
export function getAllTokenHealthStatus() {
  const accounts = Array.from(tokenHealthCache.values());
  const summary = {
    total: accounts.length,
    healthy: accounts.filter((a) => a.status === "healthy").length,
    expired: accounts.filter((a) => a.status === "expired").length,
    invalid: accounts.filter((a) => a.status === "invalid_grant").length,
    error: accounts.filter((a) => a.status === "auth_error" || a.status === "unknown_error").length,
    unchecked: accounts.filter((a) => a.status === "unchecked").length
  };
  return { summary, accounts };
}
export function resetTokenHealth(accountId) {
  if (tokenHealthCache.has(accountId)) {
    tokenHealthCache.delete(accountId);
    log80.info(`[TokenHealth] \u5DF2\u91CD\u7F6E\u8D26\u6237${accountId}\u7684Token\u5065\u5EB7\u72B6\u6001`);
    return true;
  }
  return false;
}
export function resetAllTokenHealth() {
  const count11 = tokenHealthCache.size;
  tokenHealthCache.clear();
  log80.info(`[TokenHealth] \u5DF2\u91CD\u7F6E\u6240\u6709${count11}\u4E2A\u8D26\u6237\u7684Token\u5065\u5EB7\u72B6\u6001`);
  return count11;
}
export function markTokenUnhealthy(accountId, accountName2, marketplace, errorType, errorMessage) {
  updateHealthStatus(accountId, accountName2, marketplace, errorType, errorMessage);
  log80.warn(`[TokenHealth] \u8D26\u6237${accountId}(${accountName2}) Token\u88AB\u6807\u8BB0\u4E3A${errorType}: ${errorMessage}`);
}
var log80, tokenHealthCache, CONFIG;
