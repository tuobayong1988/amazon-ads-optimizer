# 账户90027 决定性根因分析

## 发现时间: 2026-03-06 10:30 UTC

## 决定性证据

### 1. Amazon API返回的错误消息（非Token问题！）

```
Unauthorized exception while handling 3P Request: 
Unauthorized exception while calling AuthorizeThirdPartyAccess: 
Customer: A2IDI0O8158CRH does not have access to profile: 137803823816878 
for advertiser: A3D1NBVQTVBRO3 and entity: ENTITY3GWLGPAR3A18M. 
Missing rights: null
```

### 2. 根因确认

**这不是Token过期问题，而是Amazon广告账户的第三方访问权限问题！**

- Customer `A2IDI0O8158CRH` 没有权限访问 profile `137803823816878`
- advertiser `A3D1NBVQTVBRO3` (LERUCCI) 的实体 `ENTITY3GWLGPAR3A18M` 缺少必要的授权
- `Missing rights: null` 表示完全没有授权

### 3. V341 Token刷新机制验证

V341的401自动重刷新机制**工作正常**：
- `v341: 收到401，清除Token缓存并强制重刷新 (profileId=137803823816878)`
- `v341: Token重刷新成功，重试请求 (profileId=137803823816878)`
- 但重试后仍然401，因为问题不在Token，而在**账户授权权限**

### 4. 同时存在403 Forbidden

```
profileId=137803823816878缺少必要的API权限。请检查广告账户授权范围。
URL=/sb/v4/keywords/list
```

SB(Sponsored Brands)的关键词API返回403，说明该profile可能没有SB广告的API权限。

## 结论

**LERUCCI美国站(90027)的Amazon广告API第三方授权已被撤销或从未正确授予。**

需要用户在Amazon Advertising Console中重新授权第三方应用访问该广告账户。

## 修复方案

1. **用户操作**: 在Amazon Advertising Console中重新授权我们的应用访问LERUCCI美国站
2. **系统操作**: 授权完成后，系统会自动获取新的Refresh Token，然后触发全量同步
