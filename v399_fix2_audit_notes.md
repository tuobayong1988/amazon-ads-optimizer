# v399-fix2 生产环境审计笔记

## 部署状态确认
- **版本标签**: v399-fix2-20260310134946
- **部署ID**: 61
- **环境状态**: Ready / Green / Ok
- **实例类型**: t3.medium (2 vCPU, 4GB RAM)
- **实例数量**: 2个实例运行中
  - i-0688cea0ba48fcd63 (us-east-1c) - 启动于 2026-03-10T23:21:16Z
  - i-08456682570c1f813 (us-east-1b) - 启动于 2026-03-10T14:35:20Z
- **CPU使用率**: ~2.5% / ~1.8% (非常低)
- **负载**: 0.09 / 0.06 (非常低)
- **请求延迟**: P99 = 3ms (优秀)

## 注意事项
- EB事件日志显示曾出现vCPU限制(8 vCPU上限)，自动扩展从3到4实例失败
- 有实例频繁添加/移除的记录，可能是自动扩展策略过于敏感
- SYSTEM_VERSION 常量仍为 397，未更新到 399

## 代码版本
- HEAD: c54d7a6d - v399: fix duplicate accounts declarations
- package.json version: 3.9.9
