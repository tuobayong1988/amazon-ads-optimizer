# 生产环境测试发现

## 1. NextGen getStatus API — 成功
- 返回v198版本信息
- 引擎模式: unified
- 三层算法梯队正确

## 2. getCausalAnalysis API — 失败 (500)
- 错误: rl_training_logs表不存在
- SQL: select from rl_training_logs where accountId = 1
- 原因: 数据库中缺少新表（rl_training_logs等）

## 需要排查的问题
- 新增的数据库表是否已通过migration创建
- 需要检查哪些新表缺失
