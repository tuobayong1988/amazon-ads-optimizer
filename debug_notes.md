# 问题调试记录

## 当前问题

从API响应可以看到：
1. **ElaraFit** 店铺 - marketplace: "US" - 正确
2. **我的店铺** 的三个站点：
   - id: 60006, marketplace: "加拿大" - 保存的是中文名称
   - id: 60007, marketplace: "墨西哥" - 保存的是中文名称
   - id: 60008, marketplace: "美国" - 保存的是中文名称

## 问题根源

前端MARKETPLACES常量使用的是国家代码（US, CA, MX等）作为id：
```javascript
const MARKETPLACES = [
  { id: "US", name: "美国", ... },
  { id: "CA", name: "加拿大", ... },
  { id: "MX", name: "墨西哥", ... },
  ...
];
```

但后端saveMultipleProfiles保存的是中文市场名称：
```javascript
const marketplace = countryToMarketplace[profile.countryCode] || profile.countryCode;
// 这里 countryToMarketplace['CA'] = '加拿大'
```

所以前端在查找时：
```javascript
const marketplace = MARKETPLACES.find(m => m.id === account.marketplace);
// account.marketplace = "加拿大"
// 但 MARKETPLACES 的 id 是 "CA"
// 所以找不到匹配，显示 account.marketplace 原值 "加拿大"
```

但为什么显示"加拿大0"呢？需要检查前端显示逻辑...

## 进一步分析

截图显示的是"加拿大0"、"墨西哥0"、"美国0"，但API返回的是"加拿大"、"墨西哥"、"美国"。

这说明问题可能在：
1. 店铺名称分组逻辑 - storeName是"我的店铺"，但显示为"我的店铺0"
2. 需要检查分组key的生成逻辑

## 解决方案

1. 修改后端saveMultipleProfiles，保存国家代码而不是中文名称
2. 或者修改前端MARKETPLACES查找逻辑，同时支持id和name匹配
