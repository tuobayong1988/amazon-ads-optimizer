# Amazon Ads Optimizer v56 - 复选框和ACoS修复版本

## 版本信息
- **版本号**: v56-checkbox-acos-fix
- **构建时间**: 2026-02-11 03:40 GMT+8
- **Git提交**: 3eff33f

## 修复内容

### 1. 复选框事件冲突修复
- **问题**: PerformanceGroupDetail页面中，TableRow的onClick事件与Checkbox的onCheckedChange事件冲突，导致点击复选框时无法正确选中
- **修复**: 移除TableRow上的onClick={handleRowClick}事件处理器，只保留Checkbox的onCheckedChange事件
- **影响范围**: client/src/pages/PerformanceGroupDetail.tsx

### 2. ACoS字段类型转换修复
- **问题**: acos字段可能是字符串类型，直接调用toFixed()方法会导致TypeError
- **修复**: 在所有acos字段使用toFixed()之前，先使用Number()进行类型转换
- **修复位置**:
  - 第299行: kpiSummary.acos显示
  - 第420行: campaign列表中的acos显示
  - 第562行: 添加广告活动对话框中的acos显示
- **影响范围**: client/src/pages/PerformanceGroupDetail.tsx

## 技术细节
- **构建系统**: Vite 7.3.1 + esbuild
- **前端框架**: React 19.2.4
- **构建产物大小**:
  - 前端: ~18MB (未压缩)
  - 后端: 1.8MB
- **Node.js版本**: 22.13.0
- **包管理器**: pnpm 10.4.1

## 部署说明
此版本包含完整的构建产物（dist/目录），可直接部署到生产环境，无需在服务器上运行构建。

## 测试建议
1. 测试复选框功能：在策略管理页面，点击"添加广告活动"，验证复选框可以正常选中
2. 测试ACoS显示：确保所有ACoS数据正确显示，无JavaScript错误
