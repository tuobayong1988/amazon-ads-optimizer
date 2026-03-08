# v358: 重复模块标记

## 已识别的重复模块

### bidOperations.ts
- `server/services/sync/bidOperations.ts` (336行) - 通过prototype扩展注入
- `server/sync/bidOperations.ts` (296行) - 独立导出函数

**状态**: 两个文件功能重叠，`server/sync/bidOperations.ts` 是独立版本，
`server/services/sync/bidOperations.ts` 是prototype扩展版本。
建议后续统一为独立函数版本，移除prototype扩展模式。

### performanceSync
- `server/services/sync/syncPerformance.ts` (1593行) - prototype扩展版本
- `server/sync/performanceSync.ts` (1033行) - 独立函数版本

**状态**: 两个版本并存，建议统一为独立函数版本。

## 注意
本次v358改造不删除这些文件，仅做标记。
完整的重复模块清理需要在后续版本中进行，
因为需要逐一验证所有调用方的兼容性。
