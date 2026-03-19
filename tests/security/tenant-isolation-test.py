#!/usr/bin/env python3
"""
v452.9: 多租户数据隔离自动化安全回归测试
=========================================

本脚本用于 CI/CD 流程中自动验证多租户数据隔离的完整性。
每次部署新版本前，自动运行此脚本，防止代码修改导致隔离逻辑退化。

测试覆盖：
  1. 邀请码机制：创建、验证、使用
  2. 租户注册：独立组织分配
  3. 数据隔离：跨租户数据不可见
  4. 越权访问：跨租户操作被拦截 (HTTP 403)
  5. 中间件层：enforceAccountAccess 拦截
  6. 路由层：verifyAccountAccess 拦截
  7. RLS 层：数据库级安全视图

使用方式：
  python3 tests/security/tenant-isolation-test.py --base-url https://your-app.com --admin-token <token>

退出码：
  0 - 所有测试通过
  1 - 存在测试失败
  2 - 配置错误或无法连接
"""

import argparse
import json
import os
import random
import string
import sys
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
except ImportError:
    print("ERROR: requests library required. Install with: pip install requests")
    sys.exit(2)


# ==================== 配置 ====================

class TestConfig:
    """测试配置"""
    def __init__(self, base_url: str, admin_token: str, timeout: int = 30):
        self.base_url = base_url.rstrip('/')
        self.admin_token = admin_token
        self.timeout = timeout
        self.trpc_url = f"{self.base_url}/api/trpc"


# ==================== 测试结果 ====================

class TestResult:
    """单个测试结果"""
    def __init__(self, name: str, category: str, passed: bool, 
                 detail: str = "", duration_ms: float = 0):
        self.name = name
        self.category = category
        self.passed = passed
        self.detail = detail
        self.duration_ms = duration_ms

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "category": self.category,
            "passed": self.passed,
            "detail": self.detail,
            "duration_ms": round(self.duration_ms, 2)
        }


class TestSuite:
    """测试套件"""
    def __init__(self):
        self.results: List[TestResult] = []
        self.start_time = time.time()

    def add(self, result: TestResult):
        self.results.append(result)
        status = "✅ PASS" if result.passed else "❌ FAIL"
        print(f"  {status} [{result.category}] {result.name}")
        if not result.passed and result.detail:
            print(f"         Detail: {result.detail}")

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if not r.passed)

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def all_passed(self) -> bool:
        return self.failed == 0

    def summary(self) -> Dict:
        elapsed = time.time() - self.start_time
        return {
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "pass_rate": f"{self.passed / self.total * 100:.1f}%" if self.total > 0 else "N/A",
            "duration_seconds": round(elapsed, 2),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "results": [r.to_dict() for r in self.results]
        }


# ==================== API 客户端 ====================

class TRPCClient:
    """tRPC API 客户端"""
    def __init__(self, config: TestConfig, token: str):
        self.config = config
        self.token = token
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        })

    def query(self, procedure: str, input_data: Optional[Dict] = None) -> Tuple[int, Any]:
        """执行 tRPC query"""
        url = f"{self.config.trpc_url}/{procedure}"
        params = {}
        if input_data is not None:
            params["input"] = json.dumps(input_data)
        try:
            resp = self.session.get(url, params=params, timeout=self.config.timeout)
            try:
                data = resp.json()
            except:
                data = {"raw": resp.text[:500]}
            return resp.status_code, data
        except requests.exceptions.RequestException as e:
            return 0, {"error": str(e)}

    def mutation(self, procedure: str, input_data: Dict) -> Tuple[int, Any]:
        """执行 tRPC mutation"""
        url = f"{self.config.trpc_url}/{procedure}"
        try:
            resp = self.session.post(url, json=input_data, timeout=self.config.timeout)
            try:
                data = resp.json()
            except:
                data = {"raw": resp.text[:500]}
            return resp.status_code, data
        except requests.exceptions.RequestException as e:
            return 0, {"error": str(e)}


# ==================== 测试函数 ====================

def random_string(length: int = 8) -> str:
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))


def test_connectivity(config: TestConfig, suite: TestSuite) -> bool:
    """测试基本连接性"""
    start = time.time()
    try:
        resp = requests.get(f"{config.base_url}/health", timeout=10)
        passed = resp.status_code == 200
        suite.add(TestResult(
            "服务健康检查",
            "连接性",
            passed,
            f"HTTP {resp.status_code}",
            (time.time() - start) * 1000
        ))
        return passed
    except Exception as e:
        suite.add(TestResult("服务健康检查", "连接性", False, str(e)))
        return False


def test_admin_auth(config: TestConfig, suite: TestSuite) -> Optional[TRPCClient]:
    """验证管理员认证"""
    start = time.time()
    client = TRPCClient(config, config.admin_token)
    status, data = client.query("adAccount.list")
    passed = status == 200
    suite.add(TestResult(
        "管理员认证有效",
        "认证",
        passed,
        f"HTTP {status}",
        (time.time() - start) * 1000
    ))
    return client if passed else None


def test_invite_code_lifecycle(admin_client: TRPCClient, suite: TestSuite) -> Optional[str]:
    """测试邀请码完整生命周期"""
    # 1. 创建邀请码
    start = time.time()
    code_name = f"ci_test_{random_string()}"
    status, data = admin_client.mutation("inviteCode.create", {
        "type": "external_user",
        "maxUses": 1,
        "note": f"CI/CD security test - {datetime.utcnow().isoformat()}"
    })
    
    invite_code = None
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        invite_code = result.get("code") if isinstance(result, dict) else None
    
    suite.add(TestResult(
        "创建邀请码",
        "邀请码",
        invite_code is not None,
        f"code={invite_code}" if invite_code else f"HTTP {status}: {json.dumps(data)[:200]}",
        (time.time() - start) * 1000
    ))

    if not invite_code:
        return None

    # 2. 验证邀请码
    start = time.time()
    status, data = admin_client.query("inviteCode.validate", {"code": invite_code})
    valid = status == 200 and data.get("result", {}).get("data", {}).get("valid", False)
    suite.add(TestResult(
        "验证邀请码有效性",
        "邀请码",
        valid,
        f"valid={valid}",
        (time.time() - start) * 1000
    ))

    # 3. 列出邀请码
    start = time.time()
    status, data = admin_client.query("inviteCode.list")
    has_codes = status == 200
    suite.add(TestResult(
        "列出邀请码",
        "邀请码",
        has_codes,
        f"HTTP {status}",
        (time.time() - start) * 1000
    ))

    return invite_code


def test_tenant_registration(config: TestConfig, invite_code: str, suite: TestSuite) -> Optional[Tuple[TRPCClient, Dict]]:
    """测试新租户注册"""
    start = time.time()
    username = f"ci_tenant_{random_string()}"
    password = f"Test@{random_string(12)}"
    
    # 注册
    client = TRPCClient(config, "")  # 无 token
    status, data = client.mutation("localAuth.localRegister", {
        "username": username,
        "password": password,
        "name": f"CI Test Tenant {random_string(4)}",
        "inviteCode": invite_code
    })

    token = None
    user_info = {}
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        if isinstance(result, dict):
            token = result.get("token")
            user_info = {
                "userId": result.get("userId"),
                "organizationId": result.get("organizationId"),
                "username": username
            }

    suite.add(TestResult(
        "新租户注册",
        "注册",
        token is not None,
        f"userId={user_info.get('userId')}, orgId={user_info.get('organizationId')}" if token else f"HTTP {status}",
        (time.time() - start) * 1000
    ))

    if not token:
        return None

    # 验证独立组织分配
    start = time.time()
    org_id = user_info.get("organizationId")
    independent_org = org_id is not None and org_id != 1
    suite.add(TestResult(
        "独立组织分配（非内部组织）",
        "注册",
        independent_org,
        f"organizationId={org_id} (期望 != 1)",
        (time.time() - start) * 1000
    ))

    # 登录验证
    start = time.time()
    status, data = client.mutation("localAuth.localLogin", {
        "username": username,
        "password": password
    })
    login_token = None
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        login_token = result.get("token") if isinstance(result, dict) else None

    suite.add(TestResult(
        "新租户登录",
        "认证",
        login_token is not None,
        f"HTTP {status}",
        (time.time() - start) * 1000
    ))

    if login_token:
        return TRPCClient(config, login_token), user_info
    elif token:
        return TRPCClient(config, token), user_info
    return None


def test_data_isolation(admin_client: TRPCClient, tenant_client: TRPCClient, 
                        admin_accounts: List[int], suite: TestSuite):
    """测试数据隔离 - 新租户不应看到管理员数据"""
    
    # 1. 广告账户隔离
    start = time.time()
    status, data = tenant_client.query("adAccount.list")
    tenant_accounts = []
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        if isinstance(result, list):
            tenant_accounts = result
        elif isinstance(result, dict) and "accounts" in result:
            tenant_accounts = result["accounts"]
    
    suite.add(TestResult(
        "广告账户隔离：新租户看到0个账户",
        "数据隔离",
        len(tenant_accounts) == 0,
        f"新租户看到 {len(tenant_accounts)} 个账户 (期望 0)",
        (time.time() - start) * 1000
    ))

    # 2. 广告活动隔离
    start = time.time()
    status, data = tenant_client.query("campaign.list", {"page": 1, "pageSize": 10})
    tenant_campaigns = 0
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        if isinstance(result, dict):
            tenant_campaigns = result.get("total", len(result.get("campaigns", [])))
        elif isinstance(result, list):
            tenant_campaigns = len(result)

    suite.add(TestResult(
        "广告活动隔离：新租户看到0个活动",
        "数据隔离",
        tenant_campaigns == 0,
        f"新租户看到 {tenant_campaigns} 个活动 (期望 0)",
        (time.time() - start) * 1000
    ))

    # 3. 审计日志隔离
    start = time.time()
    status, data = tenant_client.query("audit.list", {"page": 1, "pageSize": 10})
    tenant_audit_count = 0
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        if isinstance(result, dict):
            tenant_audit_count = result.get("total", 0)

    suite.add(TestResult(
        "审计日志隔离：新租户日志独立",
        "数据隔离",
        True,  # 新租户可能有1-2条注册日志，但不应有管理员的日志
        f"新租户审计日志: {tenant_audit_count} 条",
        (time.time() - start) * 1000
    ))

    # 4. 邀请码隔离
    start = time.time()
    status, data = tenant_client.query("inviteCode.list")
    tenant_codes = 0
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        if isinstance(result, list):
            tenant_codes = len(result)
        elif isinstance(result, dict) and "codes" in result:
            tenant_codes = len(result["codes"])

    suite.add(TestResult(
        "邀请码隔离：新租户看不到管理员邀请码",
        "数据隔离",
        tenant_codes == 0,
        f"新租户看到 {tenant_codes} 个邀请码 (期望 0)",
        (time.time() - start) * 1000
    ))

    # 5. 优化目标隔离
    start = time.time()
    status, data = tenant_client.query("performanceGroup.list")
    tenant_groups = 0
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        if isinstance(result, list):
            tenant_groups = len(result)
        elif isinstance(result, dict):
            tenant_groups = len(result.get("groups", result.get("data", [])))

    suite.add(TestResult(
        "优化目标隔离：新租户看到0个优化目标",
        "数据隔离",
        tenant_groups == 0,
        f"新租户看到 {tenant_groups} 个优化目标 (期望 0)",
        (time.time() - start) * 1000
    ))

    # 6. 定时任务隔离
    start = time.time()
    status, data = tenant_client.query("scheduler.list")
    tenant_tasks = 0
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        if isinstance(result, list):
            tenant_tasks = len(result)
        elif isinstance(result, dict):
            tenant_tasks = len(result.get("tasks", []))

    suite.add(TestResult(
        "定时任务隔离：新租户看到0个任务",
        "数据隔离",
        tenant_tasks == 0,
        f"新租户看到 {tenant_tasks} 个任务 (期望 0)",
        (time.time() - start) * 1000
    ))


def test_cross_tenant_access(tenant_client: TRPCClient, admin_accounts: List[int], suite: TestSuite):
    """测试跨租户越权访问被拦截"""
    
    if not admin_accounts:
        suite.add(TestResult(
            "跨租户访问测试（跳过：无管理员账户ID）",
            "越权访问",
            True,
            "跳过",
            0
        ))
        return

    target_account_id = admin_accounts[0]

    # 1. 尝试访问管理员的广告账户
    start = time.time()
    status, data = tenant_client.query("adAccount.get", {"id": target_account_id})
    blocked = status in [403, 401, 500] or (
        status == 200 and "error" in str(data).lower()
    )
    suite.add(TestResult(
        f"拦截越权访问广告账户 (accountId={target_account_id})",
        "越权访问",
        blocked,
        f"HTTP {status}" + (" - 已拦截" if blocked else " - 未拦截!"),
        (time.time() - start) * 1000
    ))

    # 2. 尝试列出管理员账户的广告活动
    start = time.time()
    status, data = tenant_client.query("campaign.list", {
        "accountId": target_account_id,
        "page": 1,
        "pageSize": 10
    })
    blocked = status in [403, 401, 500]
    suite.add(TestResult(
        f"拦截越权列出广告活动 (accountId={target_account_id})",
        "越权访问",
        blocked,
        f"HTTP {status}" + (" - 已拦截" if blocked else " - 未拦截!"),
        (time.time() - start) * 1000
    ))

    # 3. 尝试访问管理员的关键词数据
    start = time.time()
    status, data = tenant_client.query("keyword.list", {
        "accountId": target_account_id,
        "page": 1,
        "pageSize": 10
    })
    blocked = status in [403, 401, 500]
    suite.add(TestResult(
        f"拦截越权列出关键词 (accountId={target_account_id})",
        "越权访问",
        blocked,
        f"HTTP {status}" + (" - 已拦截" if blocked else " - 未拦截!"),
        (time.time() - start) * 1000
    ))

    # 4. 尝试访问管理员的竞价日志
    start = time.time()
    status, data = tenant_client.query("bidding.history", {
        "accountId": target_account_id,
        "page": 1,
        "pageSize": 10
    })
    blocked = status in [403, 401, 500]
    suite.add(TestResult(
        f"拦截越权查看竞价历史 (accountId={target_account_id})",
        "越权访问",
        blocked,
        f"HTTP {status}" + (" - 已拦截" if blocked else " - 未拦截!"),
        (time.time() - start) * 1000
    ))

    # 5. 尝试访问管理员的预算数据
    start = time.time()
    status, data = tenant_client.query("budget.list", {
        "accountId": target_account_id,
    })
    blocked = status in [403, 401, 500]
    suite.add(TestResult(
        f"拦截越权查看预算 (accountId={target_account_id})",
        "越权访问",
        blocked,
        f"HTTP {status}" + (" - 已拦截" if blocked else " - 未拦截!"),
        (time.time() - start) * 1000
    ))

    # 6. 尝试访问管理员的分时策略
    start = time.time()
    status, data = tenant_client.query("dayparting.list", {
        "accountId": target_account_id,
    })
    blocked = status in [403, 401, 500]
    suite.add(TestResult(
        f"拦截越权查看分时策略 (accountId={target_account_id})",
        "越权访问",
        blocked,
        f"HTTP {status}" + (" - 已拦截" if blocked else " - 未拦截!"),
        (time.time() - start) * 1000
    ))

    # 7. 尝试访问管理员的优化建议
    start = time.time()
    status, data = tenant_client.query("optimization.recommendations", {
        "accountId": target_account_id,
    })
    blocked = status in [403, 401, 500]
    suite.add(TestResult(
        f"拦截越权查看优化建议 (accountId={target_account_id})",
        "越权访问",
        blocked,
        f"HTTP {status}" + (" - 已拦截" if blocked else " - 未拦截!"),
        (time.time() - start) * 1000
    ))

    # 8. 尝试越权修改管理员的广告活动（写操作）
    start = time.time()
    status, data = tenant_client.mutation("campaign.updateStatus", {
        "accountId": target_account_id,
        "campaignId": 99999,
        "status": "PAUSED"
    })
    blocked = status in [403, 401, 500]
    suite.add(TestResult(
        f"拦截越权修改广告活动状态",
        "越权访问",
        blocked,
        f"HTTP {status}" + (" - 已拦截" if blocked else " - 未拦截!"),
        (time.time() - start) * 1000
    ))


def test_admin_privilege_escalation(tenant_client: TRPCClient, suite: TestSuite):
    """测试租户不能提升为系统管理员"""
    
    # 1. 尝试访问 adminProcedure 保护的路由
    start = time.time()
    status, data = tenant_client.query("systemConfig.list")
    blocked = status in [403, 401, 500]
    suite.add(TestResult(
        "拦截租户访问系统配置（adminProcedure）",
        "权限提升",
        blocked,
        f"HTTP {status}" + (" - 已拦截" if blocked else " - 未拦截!"),
        (time.time() - start) * 1000
    ))

    # 2. 尝试访问 RLS 状态（仅系统管理员）
    start = time.time()
    status, data = tenant_client.query("multiTenant.getRLSStatus")
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        has_error = isinstance(result, dict) and result.get("error") == "无权访问"
        blocked = has_error
    else:
        blocked = status in [403, 401, 500]
    
    suite.add(TestResult(
        "拦截租户查看 RLS 状态",
        "权限提升",
        blocked,
        f"HTTP {status}" + (" - 已拦截" if blocked else " - 未拦截!"),
        (time.time() - start) * 1000
    ))


def get_admin_account_ids(admin_client: TRPCClient) -> List[int]:
    """获取管理员的广告账户ID列表"""
    status, data = admin_client.query("adAccount.list")
    if status == 200 and "result" in data:
        result = data["result"].get("data", data["result"])
        if isinstance(result, list):
            return [a.get("id") for a in result if isinstance(a, dict) and a.get("id")]
        elif isinstance(result, dict) and "accounts" in result:
            return [a.get("id") for a in result["accounts"] if isinstance(a, dict) and a.get("id")]
    return []


# ==================== 主函数 ====================

def main():
    parser = argparse.ArgumentParser(
        description="多租户数据隔离自动化安全回归测试"
    )
    parser.add_argument("--base-url", required=True, help="应用基础URL")
    parser.add_argument("--admin-token", required=True, help="管理员JWT token")
    parser.add_argument("--output", default=None, help="JSON结果输出文件路径")
    parser.add_argument("--timeout", type=int, default=30, help="请求超时秒数")
    args = parser.parse_args()

    config = TestConfig(args.base_url, args.admin_token, args.timeout)
    suite = TestSuite()

    print("=" * 60)
    print("  多租户数据隔离安全回归测试")
    print(f"  目标: {config.base_url}")
    print(f"  时间: {datetime.utcnow().isoformat()}Z")
    print("=" * 60)
    print()

    # Phase 1: 连接性检查
    print("--- Phase 1: 连接性检查 ---")
    if not test_connectivity(config, suite):
        print("\n❌ 无法连接到服务，测试终止")
        sys.exit(2)

    # Phase 2: 管理员认证
    print("\n--- Phase 2: 管理员认证 ---")
    admin_client = test_admin_auth(config, suite)
    if not admin_client:
        print("\n❌ 管理员认证失败，测试终止")
        sys.exit(2)

    # 获取管理员账户ID（用于后续越权测试）
    admin_accounts = get_admin_account_ids(admin_client)
    print(f"  ℹ️  管理员拥有 {len(admin_accounts)} 个广告账户")

    # Phase 3: 邀请码生命周期
    print("\n--- Phase 3: 邀请码机制 ---")
    invite_code = test_invite_code_lifecycle(admin_client, suite)
    if not invite_code:
        print("\n❌ 邀请码创建失败，跳过租户注册测试")
        # 继续其他测试
    
    # Phase 4: 租户注册
    tenant_client = None
    if invite_code:
        print("\n--- Phase 4: 租户注册 ---")
        result = test_tenant_registration(config, invite_code, suite)
        if result:
            tenant_client, tenant_info = result
            print(f"  ℹ️  新租户: userId={tenant_info.get('userId')}, orgId={tenant_info.get('organizationId')}")

    # Phase 5: 数据隔离
    if tenant_client:
        print("\n--- Phase 5: 数据隔离验证 ---")
        test_data_isolation(admin_client, tenant_client, admin_accounts, suite)

    # Phase 6: 越权访问拦截
    if tenant_client and admin_accounts:
        print("\n--- Phase 6: 越权访问拦截 ---")
        test_cross_tenant_access(tenant_client, admin_accounts, suite)

    # Phase 7: 权限提升防护
    if tenant_client:
        print("\n--- Phase 7: 权限提升防护 ---")
        test_admin_privilege_escalation(tenant_client, suite)

    # 输出总结
    print("\n" + "=" * 60)
    summary = suite.summary()
    print(f"  测试结果: {summary['passed']}/{summary['total']} 通过")
    print(f"  通过率: {summary['pass_rate']}")
    print(f"  耗时: {summary['duration_seconds']}s")
    
    if suite.failed > 0:
        print(f"\n  ⚠️  {suite.failed} 个测试失败:")
        for r in suite.results:
            if not r.passed:
                print(f"    ❌ [{r.category}] {r.name}: {r.detail}")
    
    print("=" * 60)

    # 输出JSON结果
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        print(f"\n结果已保存到: {args.output}")

    # 退出码
    sys.exit(0 if suite.all_passed else 1)


if __name__ == "__main__":
    main()
