# 前端巨型页面拆分指南 (v360)

## 背景

三个巨型页面文件需要拆分为更小的、可复用的子组件，以提高可维护性。

| 页面文件 | 行数 | 建议拆分方案 |
| :--- | :--- | :--- |
| `AmazonApiSettings.tsx` | 4543 | 按Tab拆分为5个子组件 |
| `CampaignDetail.tsx` | 3642 | 按功能区域拆分为4个子组件 |
| `Campaigns.tsx` | 2963 | 按表格/筛选/操作拆分为3个子组件 |

## AmazonApiSettings.tsx 拆分方案

建议拆分为以下子组件，放在 `components/settings/` 目录下：

| 子组件 | 职责 |
| :--- | :--- |
| `AccountsTab.tsx` | 广告账户列表、添加/编辑/删除 |
| `AuthorizationTab.tsx` | OAuth授权流程、凭证管理 |
| `SyncStatusTab.tsx` | 同步状态监控、手动触发 |
| `BatchAuthTab.tsx` | 批量授权管理 |
| `SettingsTab.tsx` | 系统设置、通知配置 |

## CampaignDetail.tsx 拆分方案

建议拆分为以下子组件，放在 `components/campaign/` 目录下：

| 子组件 | 职责 |
| :--- | :--- |
| `CampaignOverview.tsx` | 广告活动概览、KPI卡片 |
| `CampaignKeywords.tsx` | 关键词列表、出价管理 |
| `CampaignTargets.tsx` | 投放目标管理 |
| `CampaignPerformance.tsx` | 绩效图表、趋势分析 |

## Campaigns.tsx 拆分方案

建议拆分为以下子组件，放在 `components/campaign/` 目录下：

| 子组件 | 职责 |
| :--- | :--- |
| `CampaignFilters.tsx` | 筛选条件、搜索框 |
| `CampaignTable.tsx` | 广告活动表格、排序 |
| `CampaignActions.tsx` | 批量操作、导出 |

## 迁移步骤

1. 创建子组件目录结构
2. 提取状态管理逻辑到自定义hooks
3. 将UI渲染逻辑移动到子组件
4. 在主页面中组合子组件
5. 确保所有功能正常工作
