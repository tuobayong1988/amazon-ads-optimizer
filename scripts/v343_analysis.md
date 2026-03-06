# V343 问题分析

## 问题现象
Kool Classic店铺下出现了两个US站点

## 根因分析

### Amazon API返回的profiles
Amazon Ads API的getProfiles()返回了4个profiles：
- 1657071967621439 (CA)
- 1676431685606519 (MX)  
- 773988589563608 (US) ← 新的US profile（之前不存在于系统中）
- 137803823816878 (US) ← 原有的US profile（账户90027）

Amazon为同一个卖家在同一个国家返回了两个不同的profileId，可能是seller和vendor两种类型。

### 问题链路

1. **后端回调(amazonAuthCallback)**: 按profileId匹配已有账户
   - 匹配到90025(CA), 90026(MX), 90027(US=137803823816878)
   - 773988589563608(US)没有匹配 → 跳过

2. **前端processCallback**: 调用saveMultipleProfiles，传入全部4个profiles
   - saveMultipleProfiles对773988589563608(US)没有找到profileId匹配
   - 也没有找到"同店铺+同国家"匹配（因为existingAccountByCountry找到的是90027，但profileId不同）
   - 等等！实际上existingAccountByCountry应该能找到90027（storeName=Kool Classic, marketplace=US）
   - 但是！第2层匹配的sellerId检查可能有问题 - sellerId为空

### 关键问题：为什么第2层匹配没有阻止创建？

看代码：
```
const existingAccountByCountry = existingAccounts.find(
  a => a.storeName === effectiveStoreName && a.marketplace === marketplaceCode
);
```

这里找到的是第一个匹配的账户。如果profiles按顺序处理：
1. 先处理773988589563608(US) → 找到90027(US)作为existingAccountByCountry → 但sellerId检查...
   - 如果sellerId都为空，countryMatchIsSameSeller = true → 应该更新90027
   - 但这会把90027的profileId改成773988589563608！这是错误的！
   
2. 然后处理137803823816878(US) → 此时90027的profileId已被改成773988589563608
   - 按profileId匹配找不到了
   - 按店铺+国家匹配...90027的marketplace=US → 找到了 → 又把profileId改回137803823816878

实际上从日志看，两个US都是"按profileId匹配"更新的，说明处理顺序是：
- 先处理了137803823816878(US) → 匹配到90027 → 更新
- 再处理773988589563608(US) → profileId不匹配 → 按店铺+国家匹配到90027 → 但90027已经被处理过了
  
等等，让我重新看日志：
```
[saveMultipleProfiles] 创建新账号 90031 (US), sellerId=
```

所以773988589563608(US)确实创建了新账号！为什么第2层匹配没有生效？

可能的原因：
- sellerId为空，但countryMatchIsSameSeller的检查逻辑是：
  ```
  if (existingAccountByCountry && profileSellerId && existingAccountByCountry.sellerId) {
  ```
  如果profileSellerId为空，这个if不进入，countryMatchIsSameSeller保持true
  
- 那应该走到"更新现有账号（同店铺同国家同卖家）"分支才对

让我重新分析...可能是因为第一次授权时（11:13:31），后端回调先执行，然后前端调用saveMultipleProfiles。
在第一次授权时，profiles的处理顺序可能是：
1. CA → 匹配90025
2. MX → 匹配90026  
3. US(773988589563608) → profileId不匹配 → 按店铺+国家找到90027(US) → 但sellerId...

等等！关键是effectiveStoreName。前端传入的storeName可能不是"Kool Classic"！
日志显示：`storeName: 'Kool Classic'`，所以storeName是对的。

那问题可能是：第一次授权时，90027的storeName可能不是"Kool Classic"而是其他值。

## 修复方案

### 核心原则
1. **刷新授权时**：只更新已有账户的凭证，不创建新账户
2. **首次授权时**：同一店铺下同一国家只保留一个账户（按profileId去重）
3. **后端回调已经正确处理了凭证保存**，前端不应该再重复创建账户

### 具体修复
1. 前端processCallback中，如果后端已保存凭证(backend_saved > 0)，不再调用saveMultipleProfiles
2. 如果仍需调用saveMultipleProfiles，增加"刷新授权模式"参数，只更新不创建
3. amazonAuthCallback中的profiles过滤：对于同一国家的多个profile，优先匹配已有账户的profile
