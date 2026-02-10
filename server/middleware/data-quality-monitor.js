/**
 * 数据质量监控中间件
 * 功能：
 * 1. 监控数据库中的无效数据
 * 2. 记录数据质量问题
 * 3. 提供告警接口
 * 4. 生成数据质量报告
 */

const fs = require('fs');
const path = require('path');

class DataQualityMonitor {
  constructor(db) {
    this.db = db;
    this.logDir = path.join(__dirname, '../logs/data-quality');
    this.alertThreshold = {
      invalidAssociations: 10, // 无效关联超过10条时告警
      cleanupInterval: 24 * 60 * 60 * 1000 // 24小时清理一次
    };
    this.lastCleanupTime = null;
    
    // 确保日志目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  /**
   * 检查无效的广告活动关联
   */
  async checkInvalidCampaignAssociations() {
    try {
      const { strategyTemplateCampaigns, campaigns } = this.db.schema;
      
      // 查询所有关联记录
      const allAssociations = await this.db.select({
        id: strategyTemplateCampaigns.id,
        templateId: strategyTemplateCampaigns.templateId,
        applicationId: strategyTemplateCampaigns.applicationId,
        campaignId: strategyTemplateCampaigns.campaignId,
        createdAt: strategyTemplateCampaigns.createdAt
      }).from(strategyTemplateCampaigns);
      
      // 查询所有有效的campaignId
      const validCampaigns = await this.db.select({
        campaignId: campaigns.campaignId
      }).from(campaigns);
      
      const validCampaignIds = new Set(validCampaigns.map(c => c.campaignId));
      
      // 找出无效的关联
      const invalidAssociations = allAssociations.filter(
        assoc => !validCampaignIds.has(assoc.campaignId)
      );
      
      const result = {
        timestamp: new Date().toISOString(),
        totalAssociations: allAssociations.length,
        validAssociations: allAssociations.length - invalidAssociations.length,
        invalidAssociations: invalidAssociations.length,
        invalidRecords: invalidAssociations,
        healthScore: allAssociations.length > 0 
          ? ((allAssociations.length - invalidAssociations.length) / allAssociations.length * 100).toFixed(2)
          : 100
      };
      
      // 记录到日志
      this.logDataQualityCheck(result);
      
      // 检查是否需要告警
      if (invalidAssociations.length >= this.alertThreshold.invalidAssociations) {
        this.triggerAlert('HIGH_INVALID_ASSOCIATIONS', result);
      }
      
      return result;
    } catch (error) {
      console.error('[DataQualityMonitor] Error checking invalid associations:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * 自动清理无效数据
   */
  async autoCleanup() {
    try {
      // 检查是否需要清理
      const now = Date.now();
      if (this.lastCleanupTime && (now - this.lastCleanupTime) < this.alertThreshold.cleanupInterval) {
        return {
          skipped: true,
          reason: 'Cleanup interval not reached',
          nextCleanup: new Date(this.lastCleanupTime + this.alertThreshold.cleanupInterval).toISOString()
        };
      }
      
      const { strategyTemplateCampaigns, campaigns } = this.db.schema;
      
      // 先检查有多少无效数据
      const checkResult = await this.checkInvalidCampaignAssociations();
      
      if (checkResult.invalidAssociations === 0) {
        this.lastCleanupTime = now;
        return {
          cleaned: 0,
          message: 'No invalid data to clean',
          timestamp: new Date().toISOString()
        };
      }
      
      // 执行清理
      const invalidIds = checkResult.invalidRecords.map(r => r.id);
      
      const { sql } = require('drizzle-orm');
      const deleted = await this.db.delete(strategyTemplateCampaigns)
        .where(sql`id IN (${invalidIds.join(',')})`);
      
      const result = {
        cleaned: checkResult.invalidAssociations,
        invalidRecords: checkResult.invalidRecords,
        timestamp: new Date().toISOString()
      };
      
      // 记录清理日志
      this.logCleanup(result);
      
      // 更新最后清理时间
      this.lastCleanupTime = now;
      
      // 发送清理通知
      this.triggerAlert('AUTO_CLEANUP_COMPLETED', result);
      
      return result;
    } catch (error) {
      console.error('[DataQualityMonitor] Error during auto cleanup:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * 记录数据质量检查结果
   */
  logDataQualityCheck(result) {
    const logFile = path.join(this.logDir, `quality-check-${this.getDateString()}.log`);
    const logEntry = `[${result.timestamp}] Health Score: ${result.healthScore}% | Total: ${result.totalAssociations} | Valid: ${result.validAssociations} | Invalid: ${result.invalidAssociations}\n`;
    
    fs.appendFileSync(logFile, logEntry);
    
    // 如果有无效数据，记录详细信息
    if (result.invalidAssociations > 0) {
      const detailFile = path.join(this.logDir, `invalid-records-${this.getDateString()}.json`);
      fs.writeFileSync(detailFile, JSON.stringify(result, null, 2));
    }
  }
  
  /**
   * 记录清理操作
   */
  logCleanup(result) {
    const logFile = path.join(this.logDir, `cleanup-${this.getDateString()}.log`);
    const logEntry = `[${result.timestamp}] Cleaned ${result.cleaned} invalid records\n`;
    
    fs.appendFileSync(logFile, logEntry);
    
    // 记录详细的清理信息
    const detailFile = path.join(this.logDir, `cleanup-detail-${result.timestamp.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(detailFile, JSON.stringify(result, null, 2));
  }
  
  /**
   * 触发告警
   */
  triggerAlert(alertType, data) {
    const alert = {
      type: alertType,
      severity: this.getAlertSeverity(alertType),
      timestamp: new Date().toISOString(),
      data: data,
      message: this.getAlertMessage(alertType, data)
    };
    
    // 记录告警
    const alertFile = path.join(this.logDir, `alerts-${this.getDateString()}.log`);
    const alertEntry = `[${alert.timestamp}] [${alert.severity}] ${alert.type}: ${alert.message}\n`;
    
    fs.appendFileSync(alertFile, alertEntry);
    
    // 在控制台输出告警
    console.warn('[DataQualityMonitor] ALERT:', alert);
    
    // TODO: 可以在这里集成邮件、Slack、钉钉等告警渠道
    
    return alert;
  }
  
  /**
   * 获取告警严重程度
   */
  getAlertSeverity(alertType) {
    const severityMap = {
      'HIGH_INVALID_ASSOCIATIONS': 'WARNING',
      'AUTO_CLEANUP_COMPLETED': 'INFO',
      'CLEANUP_FAILED': 'ERROR'
    };
    
    return severityMap[alertType] || 'INFO';
  }
  
  /**
   * 获取告警消息
   */
  getAlertMessage(alertType, data) {
    const messageMap = {
      'HIGH_INVALID_ASSOCIATIONS': `检测到${data.invalidAssociations}条无效的广告活动关联，超过阈值${this.alertThreshold.invalidAssociations}条`,
      'AUTO_CLEANUP_COMPLETED': `自动清理完成，清理了${data.cleaned}条无效记录`,
      'CLEANUP_FAILED': `自动清理失败: ${data.error}`
    };
    
    return messageMap[alertType] || '未知告警类型';
  }
  
  /**
   * 获取日期字符串（用于日志文件名）
   */
  getDateString() {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }
  
  /**
   * 生成数据质量报告
   */
  async generateReport(days = 7) {
    try {
      const reports = [];
      const now = new Date();
      
      for (let i = 0; i < days; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateString = date.toISOString().split('T')[0];
        
        const logFile = path.join(this.logDir, `quality-check-${dateString}.log`);
        
        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf-8');
          const lines = content.trim().split('\n');
          
          reports.push({
            date: dateString,
            checks: lines.length,
            content: lines
          });
        }
      }
      
      return {
        period: `${days} days`,
        reports: reports,
        summary: {
          totalChecks: reports.reduce((sum, r) => sum + r.checks, 0),
          daysWithData: reports.length
        }
      };
    } catch (error) {
      console.error('[DataQualityMonitor] Error generating report:', error);
      return {
        error: error.message
      };
    }
  }
}

module.exports = DataQualityMonitor;
