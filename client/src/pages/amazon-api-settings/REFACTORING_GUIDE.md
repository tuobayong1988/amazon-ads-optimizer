# AmazonApiSettings 拆分指南

## 当前结构 (v361)

AmazonApiSettings.tsx (4,546行) 包含5个Tab页面：

| Tab | 行范围 | 行数 | 拆分建议 |
| :--- | :--- | :--- | :--- |
| accounts | 1832-2079 | 247 | 可拆分为 `AccountsTab.tsx` |
| api-config | 2082-3232 | 1,150 | **优先拆分** → `ApiConfigTab.tsx` |
| sync | 3235-4256 | 1,021 | **优先拆分** → `SyncTab.tsx` |
| dual-track | 4259-4261 | 2 | 太小，保留 |
| guide | 4264-4332 | 68 | 可拆分为 `GuideTab.tsx` |
| header/state | 1-1832 | 1,832 | 状态管理需提取到Context |

## 拆分策略

1. 创建 `AmazonApiSettingsContext.tsx` 提供共享状态
2. 将每个Tab内容提取为独立组件
3. 主组件只负责Tab切换和Context提供

## 注意事项

- 各Tab之间共享大量状态（selectedAccountId, credentials等）
- 需要先创建Context再拆分Tab组件
- 拆分后主组件应降至500行以内
