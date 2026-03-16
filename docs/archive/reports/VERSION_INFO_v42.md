# Amazon Ads Optimizer - Version 42

## 版本信息
- **版本号**: v42-global-selector
- **发布日期**: 2026-02-10
- **构建时间**: 2026-02-10 06:40 GMT+8

## 主要更新

### 🎯 全局店铺/站点选择器重构

#### 核心改进
1. **分离的选择器**
   - 将原来的组合选择器拆分为独立的店铺选择器和站点选择器
   - 店铺选择器：只显示店铺名（如"ElaraFit"）
   - 站点选择器：显示国旗和站点名（如"🇨🇦 加拿大"）

2. **全局状态管理**
   - 使用localStorage持久化选择
   - 实现事件系统通知所有页面
   - 自动选择默认店铺和站点

3. **用户体验优化**
   - 清晰的视觉分离
   - 智能默认值选择
   - Toast提示选择变化

#### 技术实现
- **新组件**: `GlobalAccountSelector.tsx`
  - 独立的店铺下拉菜单
  - 独立的站点下拉菜单
  - 全局状态hooks: `useCurrentStore()`, `useCurrentMarketplace()`
  
- **修改组件**: `DashboardLayout.tsx`
  - 替换`AccountSwitcher`为`GlobalAccountSelector`
  
- **状态管理**:
  - localStorage keys: `global-selected-store`, `global-selected-marketplace`
  - 事件监听器模式，实现跨组件通信

### 📦 同步之前的优化

#### v36-v40优化同步
1. **中间件**
   - `server/middleware/data-quality-monitor.js` - 数据质量监控
   - `server/middleware/api-cache.js` - API缓存

2. **工具类**
   - `server/utils/query-optimizer.js` - 查询优化

3. **数据库脚本**
   - `migrations/database_constraints_and_cleanup.sql` - 数据库约束和清理

## 文件变更

### 新增文件
- `client/src/components/GlobalAccountSelector.tsx` (313行)
- `server/middleware/data-quality-monitor.js`
- `server/middleware/api-cache.js`
- `server/utils/query-optimizer.js`
- `migrations/database_constraints_and_cleanup.sql`

### 修改文件
- `client/src/components/DashboardLayout.tsx`
  - 导入: `AccountSwitcher` → `GlobalAccountSelector`
  - 使用: `<AccountSwitcher compact />` → `<GlobalAccountSelector compact />`

## 构建信息
- **构建工具**: Vite 7.1.9 + esbuild 0.25.10
- **构建时间**: 28.57秒
- **输出大小**: 
  - 前端: ~1.02MB (gzipped: ~293KB)
  - 后端: 1.8MB

## 部署说明

### 部署包内容
```
amazon-ads-v42-global-selector.zip
├── dist/                    # 构建输出
│   ├── public/             # 前端静态资源
│   └── index.js            # 后端入口
├── package-prod.json       # 生产依赖
├── Procfile                # 启动配置
├── .npmrc                  # npm配置
└── migrations/             # 数据库迁移脚本
```

### 部署步骤
1. 上传到S3: `s3://elasticbeanstalk-us-east-1-058264502466/`
2. 创建应用版本: `amazon-ads-optimizer / v42-global-selector`
3. 部署到环境: `amazon-ads-env-prod`

## 验证清单

### 功能验证
- [ ] 店铺选择器显示正确（只显示店铺名）
- [ ] 站点选择器显示正确（显示国旗+站点名）
- [ ] 选择店铺后自动更新站点列表
- [ ] 选择变化后页面数据自动刷新
- [ ] localStorage正确保存选择
- [ ] 页面刷新后选择保持

### 性能验证
- [ ] 页面加载速度正常
- [ ] 选择器响应迅速
- [ ] 无内存泄漏

### 兼容性验证
- [ ] 桌面端显示正常
- [ ] 移动端显示正常
- [ ] 所有页面使用全局状态

## 已知问题
- 无

## 后续计划
1. 监控用户反馈
2. 优化选择器性能
3. 添加快捷键支持
4. 考虑添加最近使用的店铺/站点列表

## 回滚方案
如果出现问题，可以回滚到v41版本：
```bash
aws elasticbeanstalk update-environment \
  --environment-name amazon-ads-env-prod \
  --version-label v41-site-selector-fix
```

## 联系信息
- 开发者: Manus AI Agent
- 部署日期: 2026-02-10
- GitHub: https://github.com/tuobayong1988/amazon-ads-optimizer
- Commit: eef303b
