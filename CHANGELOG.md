# 更新日志

## [v276] - 2026-02-28
### P1: 前端Dashboard交互增强
- 因果推断Tab: 搜索过滤、排序（按uplift/利润/日期）、仅显示显著效果筛选、独立时间范围选择器
- CQL模型Tab: 按训练时间排序、Loss阈值筛选
- 竞争环境Tab: 独立时间范围选择器（3/7/14/30天）
- 预算分池Tab: 独立时间范围选择器（7/14/30/60天）

### P2: 闭环A/B测试框架
#### 后端增强
- 实验统计概览API（overview）: 全局实验状态汇总
- 实验模板快速创建API（createFromTemplate）: Cascade vs Single / 融合阈值 / 探索率
- 闭环反馈API（applyWinnerStrategy）: 将获胜策略自动标记并推荐应用
- 每日趋势API（getDailyTrend）: 对照组/实验组逐日指标对比

#### 前端A/B测试管理UI
- 实验概览统计卡片（总数/运行中/已完成/草稿/置信度）
- 模板快速创建对话框（3种预设实验模板）
- 增强的实验详情面板（概览/结果分析/闭环反馈三Tab）
- 指标对比表格（对照组vs实验组，含p值和显著性标记）
- 实验进度条（基于时间范围的可视化进度）
- 闭环反馈面板（一键应用获胜策略到优化引擎）
- 最近完成实验结果概览表

## [v275] - 2026-02-28
### 透明度与可观测性增强
- 4个新Dashboard Tab: 因果推断洞察、CQL模型监控、竞争环境感知、预算分池状态
- 风险分级自动响应机制（RED/YELLOW/GREEN）
- 自进化引擎动态时间衰减权重
- 特征缓存TTL优化
- 系统健康评分从85提升至92

## [v274] - 2026-02-28
### 全面引擎增强
#### 1. 因果推断接入出价决策
- causalInferenceResults的optimalBid作为信号源融入batchCalculateNextGenBids
- 高置信度因果推断结果对出价进行±5%的微调修正
- 新增causalAdjustment字段记录因果推断修正详情

#### 2. CQL离线强化学习训练增强
- 训练数据质量验证（最低50条有效记录，奖励方差检查）
- 奖励值归一化处理（Z-score标准化）
- 模型质量评估（训练集vs验证集Q值对比）
- 冷启动探索策略（数据不足时使用epsilon-greedy探索）

#### 3. 竞争环境感知增强
- 多维信号融合：CPC波动率、曝光份额变化、CTR变化趋势、日报数据
- 7天滑动窗口的竞争强度综合评分
- 基于真实Amazon数据的竞争环境分类

#### 4. 预算分池具象化
- optimization_events的performanceData字段记录GTO决策元数据
- 预算分池分配结果可追踪、可审计

#### 5. 自动纠错闭环增强
- 因果推断辅助纠错判断：正向增量利润时降级为部分回滚
- 效果评分增加因果推断维度（5%权重）
- 多维效果评估：ROAS(35%) + ACoS(25%) + 订单量(25%) + 花费效率(10%) + 因果信号(5%)


## [v1.1.0] - 2024-02-13

### 新增功能

#### 1. Amazon Ads API集成
- 实现每日自动数据同步任务
- 添加手动触发同步API
- 支持同步状态查询和历史记录
- 完善的错误处理和重试机制

#### 2. CloudWatch监控和告警
- 一键部署CloudWatch监控配置
- 多维度系统指标监控(CPU、内存、磁盘、API响应时间)
- 智能告警规则配置
- SNS通知集成

#### 3. 数据库备份策略
- 自动化每日数据库备份
- 备份文件压缩和加密
- 智能清理过期备份
- 一键恢复脚本

#### 4. 数据可视化增强
- 新增饼图类型,展示数据占比
- 新增雷达图类型,多维度数据对比
- 支持6种图表类型切换
- 优化图表交互体验

#### 5. 趋势预测功能
- 线性回归预测算法
- 移动平均预测算法
- 组合预测模型
- 7天趋势预测和置信区间
- 趋势方向和强度分析
- 季节性检测

#### 6. 异常检测功能
- Z-Score统计检测
- IQR四分位距检测
- 移动平均异常检测
- 突变点检测
- 异常严重程度分级
- 异常统计报告

#### 7. 批量导出功能
- 支持批量选择多个优化目标
- Excel多工作表导出
- CSV ZIP压缩包导出
- 自定义时间范围导出
- 实时导出进度显示

#### 8. 图片导出功能
- PNG高清图片导出
- SVG矢量图导出
- 自定义分辨率和质量
- 批量图表导出
- 水印添加功能

#### 9. 对比分析功能
- 支持最多5个目标对比
- 多指标对比(花费、销售额、ACoS、ROAS)
- 多图表类型(折线图、柱状图、雷达图)
- 统计分析(平均值、最大值、最小值、趋势)
- 实时统计计算

### 技术改进

#### 前端
- 添加趋势预测工具库 (`client/src/lib/trendPrediction.ts`)
- 添加异常检测工具库 (`client/src/lib/anomalyDetection.ts`)
- 添加图表导出工具库 (`client/src/lib/chartExport.ts`)
- 新增批量导出组件 (`client/src/components/BatchExport.tsx`)
- 新增对比分析组件 (`client/src/components/ComparisonAnalysis.tsx`)
- 优化PerformanceGroupDetail页面,集成新功能

#### 后端
- 添加每日同步任务 (`server/daily-sync-task.ts`)
- 添加同步API路由 (`server/routes/dailySync.ts`)
- 集成Amazon Ads API SDK
- 优化数据库查询性能

#### 基础设施
- CloudWatch监控配置脚本 (`aws-cloudwatch-setup.sh`)
- 数据库备份脚本 (`scripts/backup-database.sh`)
- 自动化部署脚本 (`scripts/deploy.sh`)

#### 文档
- 部署指南 (`docs/deployment-guide.md`)
- CloudWatch监控文档 (`docs/cloudwatch-monitoring.md`)
- 数据库备份文档 (`docs/database-backup.md`)
- 功能验证清单 (`docs/feature-verification-checklist.md`)
- 优化报告 (`docs/optimization-report.md`)

### 依赖更新
- 新增 `jszip@3.10.1` - 用于ZIP文件打包

### Bug修复
- 修复图表数据为空时的渲染问题
- 修复导出功能的编码问题
- 优化大数据量场景的性能

### 性能优化
- 图表渲染性能优化
- 数据查询优化,添加索引
- 批量操作优化
- 前端代码分割和懒加载

### 安全加固
- 移除代码中的敏感信息
- 加强API认证和授权
- 添加请求限流
- 完善日志审计

---

## [v1.0.0] - 2024-01-15

### 初始版本
- 基础的广告优化功能
- 绩效组管理
- 广告活动管理
- 基础数据可视化
- 用户认证和授权

---

## 版本规范

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范:

- **主版本号(MAJOR)**: 不兼容的API修改
- **次版本号(MINOR)**: 向下兼容的功能性新增
- **修订号(PATCH)**: 向下兼容的问题修正

---

## 贡献指南

欢迎提交Issue和Pull Request!

### 提交规范
- `feat`: 新功能
- `fix`: Bug修复
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 代码重构
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具相关

---

## 许可证

MIT License
