# 授权流程问题分析和修复方案

## 问题根源

### 前端问题
在 `AmazonApiSettings.tsx` 第1478行：
```javascript
const storeName = selectedAccount?.storeName || formData.storeName || '我的店铺';
```

问题：
1. `selectedAccount` 是通过 `selectedAccountId` 从 `accounts` 列表中查找的
2. 但 `selectedAccountId` 可能没有正确设置，导致 `selectedAccount` 为 null
3. `formData.storeName` 也可能为空
4. 最终回退到默认值 '我的店铺'

### 后端问题
在 `server/routers.ts` 的 `saveMultipleProfiles` 中：
- 后端直接使用传入的 `storeName` 创建新账号
- 没有检查是否应该将站点添加到已有店铺

## 修复方案

### 方案1：前端确保传递正确的店铺名称
1. 在API配置Tab中，用户必须先选择一个店铺才能进行授权
2. 授权时强制使用 `selectedAccount.storeName`
3. 如果没有选择店铺，禁用授权按钮

### 方案2：后端支持按店铺名称关联
1. 后端接收 `storeName` 后，先查找是否已存在该名称的店铺
2. 如果存在，将新站点添加到该店铺下
3. 如果不存在，创建新店铺

### 选择方案2
因为方案2更健壮，即使前端传递了错误的店铺名称，后端也能正确处理。

## 具体修改

### 1. 前端修改 (AmazonApiSettings.tsx)
- 在授权前检查是否已选择店铺
- 确保使用 `selectedAccount.storeName`
- 添加日志输出便于调试

### 2. 后端修改 (server/routers.ts)
- `saveMultipleProfiles` 接收额外参数 `existingStoreId`（可选）
- 如果提供了 `existingStoreId`，将站点添加到该店铺
- 如果没有提供，按 `storeName` 查找或创建店铺
