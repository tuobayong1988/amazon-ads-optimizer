# V342 授权凭证保存机制完整分析

## 一、系统中的所有授权场景

### 场景A: OAuth自动回调流程（标准浏览器）
1. 用户点击"授权"按钮 → 跳转Amazon OAuth页面
2. 用户在Amazon页面授权 → Amazon重定向到 `/api/auth/callback?code=XXX`
3. **后端** `amazonAuthCallback.ts`: 用code换取tokens（包含新refresh_token）
4. 后端将refresh_token和profiles通过URL参数传递给前端 `/amazon-api?auth_success=true&refresh_token=XXX&profiles=XXX`
5. **前端** `AmazonApiSettings.tsx` useEffect检测URL参数 → 设置oauthCallbackData
6. **前端** 另一个useEffect检测oauthCallbackData → 调用saveMultipleProfilesMutation或saveCredentialsMutation
7. **后端** `saveMultipleProfiles`或`saveCredentials` → 调用 `db.saveAmazonApiCredentials()` 保存到数据库

### 场景B: 紫鸟浏览器手动授权流程
1. 用户在紫鸟浏览器中手动完成授权，复制回调URL
2. 用户粘贴URL到前端输入框
3. **前端** 提取code → 调用 `exchangeCodeMutation` (后端exchangeCode方法)
4. **后端** `exchangeCode`: 用code换取tokens，返回refresh_token和profiles给前端
5. **前端** 收到结果后 → 调用saveMultipleProfilesMutation或saveCredentialsMutation
6. **后端** 保存到数据库（同场景A步骤7）

### 场景C: 手动填写凭证
1. 用户手动填写clientId, clientSecret, refreshToken, profileId
2. 点击"保存凭证" → 调用saveCredentialsMutation
3. **后端** `saveCredentials` → 验证凭证 → 保存到数据库

### 场景D: 批量授权（BatchAuthorization页面）
1. 多区域授权码同时处理
2. 后端 `batchAuthorize` 方法处理每个区域的code
3. 为每个profile保存凭证到数据库

## 二、发现的关键缺陷

### 缺陷1: ⚠️ OAuth回调流程中，refresh_token通过URL参数传递存在丢失风险
- **问题**: 后端在amazonAuthCallback.ts中成功获取了新的refresh_token，但只是通过URL重定向参数传给前端
- **风险**: 如果前端页面加载失败、JS错误、用户刷新页面等，refresh_token就会丢失
- **关键**: URL参数在被读取后立即被清除（window.history.replaceState），如果前端处理失败，没有重试机制

### 缺陷2: ⚠️ 前端processCallback中clientSecret为空字符串
- **位置**: AmazonApiSettings.tsx 第502行
- **代码**: `const clientSecret = '';`
- **问题**: 前端OAuth回调处理时，clientSecret被硬编码为空字符串
- **影响**: 调用saveMultipleProfilesMutation时clientSecret为空，后端saveMultipleProfiles不验证凭证（不像saveCredentials那样调用validateCredentials），所以不会报错
- **但**: 后续初始化和同步时使用的clientSecret来自数据库，如果数据库中已有正确的clientSecret则不受影响（因为saveAmazonApiCredentials使用onDuplicateKeyUpdate，空字符串会覆盖已有值！）

### 缺陷3: 🔴 saveAmazonApiCredentials的onDuplicateKeyUpdate会用空clientSecret覆盖已有值
- **位置**: db.ts 第1276行
- **代码**: `onDuplicateKeyUpdate: { set: { clientId: data.clientId, clientSecret: data.clientSecret, refreshToken: data.refreshToken, ... } }`
- **问题**: 如果传入的clientSecret为空字符串，会覆盖数据库中已有的有效clientSecret
- **场景**: OAuth回调流程(场景A)中，前端传入的clientSecret为空，会破坏已有凭证

### 缺陷4: 🔴 后端回调不直接保存凭证到数据库
- **问题**: amazonAuthCallback.ts获取到新的refresh_token后，不直接保存到数据库，而是通过URL参数传给前端，依赖前端来触发保存
- **这是最大的架构缺陷**: 后端已经有了所有需要的信息（refresh_token, profiles, clientId, clientSecret），完全可以直接保存到数据库
- **用户重新授权LERUCCI US后仍然401的根本原因可能就是这个**: 如果前端处理链路中任何环节出错，新的refresh_token就不会被保存

### 缺陷5: ⚠️ 共享Refresh Token的账户没有批量更新机制
- **问题**: 账户90021-90027共享同一个Refresh Token，但saveAmazonApiCredentials只更新单个accountId的记录
- **影响**: 当用户重新授权获得新的Refresh Token时，只有当前操作的账户会被更新，其他共享同一Token的账户仍使用旧Token

### 缺陷6: ⚠️ doRefreshToken不保存Amazon返回的新refresh_token
- **问题**: Amazon OAuth在刷新access_token时可能返回新的refresh_token（虽然Amazon Ads API通常不会）
- **当前代码**: doRefreshToken只保存access_token和过期时间到内存，不检查也不保存可能的新refresh_token

## 三、账户90027持续401的根因分析

用户重新授权后仍然401，最可能的原因链：
1. 用户在Amazon端重新授权 → Amazon生成新的authorization code
2. 回调到 `/api/auth/callback?code=XXX` → 后端成功换取新的refresh_token
3. 后端通过URL参数重定向到前端 `/amazon-api?refresh_token=NEW_TOKEN&profiles=...`
4. **前端处理时**:
   a. 如果用户没有登录系统 → 前端无法调用saveCredentials/saveMultipleProfiles
   b. 如果前端JS报错 → processCallback不执行
   c. 如果clientSecret为空 → saveAmazonApiCredentials会用空值覆盖数据库中的clientSecret
   d. 如果saveMultipleProfiles成功但只更新了部分账户 → 共享Token的其他账户仍用旧Token

## 四、修复方案

### 修复1: 后端回调直接保存凭证（最关键）
在amazonAuthCallback.ts中，获取到新tokens后，直接查找并更新数据库中所有使用相同profileId的凭证记录

### 修复2: 共享Token批量更新
当一个账户的refresh_token被更新时，自动更新所有共享同一旧refresh_token的账户

### 修复3: 保护性更新
saveAmazonApiCredentials中，不用空字符串覆盖已有的有效值

### 修复4: 前端兜底
即使前端处理失败，由于后端已直接保存，凭证不会丢失
