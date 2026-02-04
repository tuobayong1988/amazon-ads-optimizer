# 部署说明

## 重要：关于增强脚本

**不要在构建后的 `index.html` 中添加任何增强脚本。**

### 背景

在之前的部署中，曾经在构建后的 `index.html` 中手动添加了以下增强脚本：

- `enhancements.js`
- `strategy-center-enhancements.js`
- `strategy-center-v221.js`

这些脚本会动态修改页面DOM，在策略模板卡片上添加额外的按钮（查看详情、启用、删除）。

### 问题

这种做法存在以下问题：

1. **不可维护**：增强脚本不在源代码管理中，难以追踪和维护
2. **不一致**：与React组件的设计意图不符
3. **难以调试**：动态注入的DOM元素难以调试和测试
4. **部署风险**：每次部署都需要手动添加脚本，容易出错

### 正确做法

如果需要修改策略模板卡片的功能或外观：

1. 直接修改 `client/src/components/StrategyTemplates.tsx` 组件
2. 如果需要修改策略中心页面，修改 `client/src/pages/StrategyCenter.tsx`
3. 提交代码到Git仓库
4. 通过正常的构建和部署流程发布

### 策略模板卡片设计

每个策略模板卡片应该只有一个按钮：**"应用此策略"**

这个按钮的功能是让用户选择一个策略模板，然后创建一个新的优化目标。

### 部署检查清单

在部署前，请确认：

- [ ] 构建后的 `index.html` 没有增强脚本引用
- [ ] `public/assets/` 目录中没有 `enhancements.js`、`strategy-center-enhancements.js`、`strategy-center-v221.js` 等文件
- [ ] 所有功能修改都在源代码中完成

---

*最后更新：2026-02-04*
