/**
 * SQS消费者服务 - 从Amazon Marketing Stream队列读取实时广告数据
 * 
 * 支持的队列类型 (共9个):
 * - SP: sp-traffic, sp-conversion, budget-usage
 * - SB: sb-traffic, sb-conversion, sb-budget-usage
 * - SD: sd-traffic, sd-conversion, sd-budget-usage
 * 
 * 多租户架构:
 * - 所有租户共享同一组SQS队列
 * - 根据消息中的 advertiser_id 和 marketplace_id 路由到对应租户
 */

import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import axios from 'axios';
import * as db from './db';

// SQS队列配置
export interface SQSQueueConfig {
  name: string;
  url: string;
  arn: string;
  adType: 'SP' | 'SB' | 'SD';
  dataType: 'traffic' | 'conversion' | 'budget';
}

// AMS消息结构 - 根据Amazon Marketing Stream实际格式定义
// 参考: https://advertising.amazon.com/API/docs/en-us/guides/amazon-marketing-stream/data-guide

// sp-traffic消息格式
export interface AmsTrafficMessage {
  // 标识字段
  advertiser_id: string;  // 广告主ID
  marketplace_id: string; // 市场ID (ATVPDKIKX0DER=US, A2EUQ1WTGCTBG2=CA, A1AM78C64UM0Y8=MX)
  dataset_id: string;     // 数据集ID (sp-traffic)
  idempotency_id: string; // 幂等性ID
  
  // 广告层级字段
  campaign_id?: string;
  ad_group_id?: string;
  ad_id?: string;
  keyword_id?: string;
  target_id?: string;
  
  // 流量指标
  impressions?: number;
  clicks?: number;
  cost?: number;  // 单位: 美元
  
  // 时间字段
  event_hour?: string;  // ISO 8601格式
  update_time?: string;
}

// sp-conversion消息格式
export interface AmsConversionMessage {
  // 标识字段
  advertiser_id: string;
  marketplace_id: string;
  dataset_id: string;
  idempotency_id: string;
  
  // 广告层级字段
  campaign_id?: string;
  ad_group_id?: string;
  ad_id?: string;
  keyword_id?: string;
  target_id?: string;
  
  // 转化指标 - 1天归因
  attributed_conversions_1d?: number;
  attributed_sales_1d?: number;
  attributed_sales_1d_same_sku?: number;
  
  // 转化指标 - 7天归因
  attributed_conversions_7d?: number;
  attributed_sales_7d?: number;
  attributed_sales_7d_same_sku?: number;
  units_sold_7d?: number;
  purchases_7d?: number;
  
  // 转化指标 - 14天归因
  attributed_conversions_14d?: number;
  attributed_sales_14d?: number;
  attributed_sales_14d_same_sku?: number;
  units_sold_14d?: number;
  purchases_14d?: number;
  purchases_14d_same_sku?: number;
  
  // 转化指标 - 30天归因
  multi_touch_units_sold_30d?: number;
  
  // SB特有字段
  sales?: number;
  purchases?: number;
  
  // 时间字段
  event_hour?: string;
  update_time?: string;
}

// budget-usage消息格式
export interface AmsBudgetMessage {
  // 标识字段
  advertiser_id: string;
  marketplace_id: string;
  dataset_id: string;
  idempotency_id: string;
  
  // 广告层级字段
  campaign_id?: string;
  
  // 预算指标
  budget?: number;
  budget_usage?: number;
  budget_usage_percentage?: number;
  
  // 时间字段
  event_hour?: string;
  update_time?: string;
}

// 消费者状态
export interface ConsumerStatus {
  queueName: string;
  isRunning: boolean;
  messagesProcessed: number;
  lastProcessedAt: string | null;
  errors: number;
  adType: string;
  dataType: string;
}

// SQS消费者服务类
export class SQSConsumerService {
  private sqsClient: SQSClient;
  private queues: SQSQueueConfig[] = [];
  private isRunning: boolean = false;
  private pollIntervalMs: number = 5000; // 5秒轮询间隔
  private maxMessagesPerPoll: number = 10;
  private consumerStatuses: Map<string, ConsumerStatus> = new Map();
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    // 初始化SQS客户端
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });

    // 从环境变量加载队列配置
    this.loadAllQueueConfigs();
  }

  /**
   * 从环境变量加载所有9个SQS队列配置
   * 
   * 环境变量格式:
   * - SP队列: AWS_SQS_QUEUE_TRAFFIC_URL, AWS_SQS_QUEUE_CONVERSION_URL, AWS_SQS_QUEUE_BUDGET_URL
   * - SB队列: AWS_SQS_QUEUE_SB_TRAFFIC_URL, AWS_SQS_QUEUE_SB_CONVERSION_URL, AWS_SQS_QUEUE_SB_BUDGET_URL
   * - SD队列: AWS_SQS_QUEUE_SD_TRAFFIC_URL, AWS_SQS_QUEUE_SD_CONVERSION_URL, AWS_SQS_QUEUE_SD_BUDGET_URL
   */
  private loadAllQueueConfigs(): void {
    // SP队列配置
    const spTrafficUrl = process.env.AWS_SQS_QUEUE_TRAFFIC_URL;
    const spConversionUrl = process.env.AWS_SQS_QUEUE_CONVERSION_URL;
    const spBudgetUrl = process.env.AWS_SQS_QUEUE_BUDGET_URL;
    
    // SB队列配置
    const sbTrafficUrl = process.env.AWS_SQS_QUEUE_SB_TRAFFIC_URL;
    const sbConversionUrl = process.env.AWS_SQS_QUEUE_SB_CONVERSION_URL;
    const sbBudgetUrl = process.env.AWS_SQS_QUEUE_SB_BUDGET_URL;
    
    // SD队列配置
    const sdTrafficUrl = process.env.AWS_SQS_QUEUE_SD_TRAFFIC_URL;
    const sdConversionUrl = process.env.AWS_SQS_QUEUE_SD_CONVERSION_URL;
    const sdBudgetUrl = process.env.AWS_SQS_QUEUE_SD_BUDGET_URL;
    
    // SP队列
    if (spTrafficUrl) {
      this.queues.push({
        name: 'AmzStream-NA-sp-traffic-IngressQueue',
        url: spTrafficUrl,
        arn: this.urlToArn(spTrafficUrl),
        adType: 'SP',
        dataType: 'traffic',
      });
    }
    
    if (spConversionUrl) {
      this.queues.push({
        name: 'AmzStream-NA-sp-conversion-IngressQueue',
        url: spConversionUrl,
        arn: this.urlToArn(spConversionUrl),
        adType: 'SP',
        dataType: 'conversion',
      });
    }
    
    if (spBudgetUrl) {
      this.queues.push({
        name: 'AmzStream-NA-budget-usage-IngressQueue',
        url: spBudgetUrl,
        arn: this.urlToArn(spBudgetUrl),
        adType: 'SP',
        dataType: 'budget',
      });
    }
    
    // SB队列
    if (sbTrafficUrl) {
      this.queues.push({
        name: 'AmzStream-NA-sb-traffic-IngressQueue',
        url: sbTrafficUrl,
        arn: this.urlToArn(sbTrafficUrl),
        adType: 'SB',
        dataType: 'traffic',
      });
    }
    
    if (sbConversionUrl) {
      this.queues.push({
        name: 'AmzStream-NA-sb-conversion-IngressQueue',
        url: sbConversionUrl,
        arn: this.urlToArn(sbConversionUrl),
        adType: 'SB',
        dataType: 'conversion',
      });
    }
    
    if (sbBudgetUrl) {
      this.queues.push({
        name: 'AmzStream-NA-sb-budget-usage-IngressQueue',
        url: sbBudgetUrl,
        arn: this.urlToArn(sbBudgetUrl),
        adType: 'SB',
        dataType: 'budget',
      });
    }
    
    // SD队列
    if (sdTrafficUrl) {
      this.queues.push({
        name: 'AmzStream-NA-sd-traffic-IngressQueue',
        url: sdTrafficUrl,
        arn: this.urlToArn(sdTrafficUrl),
        adType: 'SD',
        dataType: 'traffic',
      });
    }
    
    if (sdConversionUrl) {
      this.queues.push({
        name: 'AmzStream-NA-sd-conversion-IngressQueue',
        url: sdConversionUrl,
        arn: this.urlToArn(sdConversionUrl),
        adType: 'SD',
        dataType: 'conversion',
      });
    }
    
    if (sdBudgetUrl) {
      this.queues.push({
        name: 'AmzStream-NA-sd-budget-usage-IngressQueue',
        url: sdBudgetUrl,
        arn: this.urlToArn(sdBudgetUrl),
        adType: 'SD',
        dataType: 'budget',
      });
    }

    // 记录加载结果
    if (this.queues.length === 0) {
      console.log('[SQS Consumer] 未配置SQS队列URL，跳过AMS消费者启动');
      console.log('[SQS Consumer] 如需启用AMS实时数据流，请配置以下环境变量:');
      console.log('  SP队列:');
      console.log('    - AWS_SQS_QUEUE_TRAFFIC_URL');
      console.log('    - AWS_SQS_QUEUE_CONVERSION_URL');
      console.log('    - AWS_SQS_QUEUE_BUDGET_URL');
      console.log('  SB队列:');
      console.log('    - AWS_SQS_QUEUE_SB_TRAFFIC_URL');
      console.log('    - AWS_SQS_QUEUE_SB_CONVERSION_URL');
      console.log('    - AWS_SQS_QUEUE_SB_BUDGET_URL');
      console.log('  SD队列:');
      console.log('    - AWS_SQS_QUEUE_SD_TRAFFIC_URL');
      console.log('    - AWS_SQS_QUEUE_SD_CONVERSION_URL');
      console.log('    - AWS_SQS_QUEUE_SD_BUDGET_URL');
    } else {
      console.log(`[SQS Consumer] 已加载 ${this.queues.length} 个队列配置:`);
      this.queues.forEach(q => console.log(`  - ${q.name}: ${q.adType} ${q.dataType}`));
    }
  }

  /**
   * 将SQS URL转换为ARN
   */
  private urlToArn(url: string): string {
    // URL格式: https://sqs.{region}.amazonaws.com/{accountId}/{queueName}
    // 或: https://queue.amazonaws.com/{accountId}/{queueName}
    let match = url.match(/sqs\.([^.]+)\.amazonaws\.com\/(\d+)\/(.+)/);
    if (match) {
      const [, region, accountId, queueName] = match;
      return `arn:aws:sqs:${region}:${accountId}:${queueName}`;
    }
    
    // 处理 queue.amazonaws.com 格式
    match = url.match(/queue\.amazonaws\.com\/(\d+)\/(.+)/);
    if (match) {
      const [, accountId, queueName] = match;
      const region = process.env.AWS_REGION || 'us-east-1';
      return `arn:aws:sqs:${region}:${accountId}:${queueName}`;
    }
    
    return url;
  }

  /**
   * 手动添加队列配置
   */
  addQueue(config: SQSQueueConfig): void {
    // 检查是否已存在
    const existing = this.queues.find(q => q.url === config.url);
    if (!existing) {
      this.queues.push(config);
      console.log(`[SQS Consumer] 添加队列: ${config.name} (${config.adType} ${config.dataType})`);
    }
  }

  /**
   * 启动所有队列的消费者
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[SQS Consumer] 消费者已在运行中');
      return;
    }

    if (this.queues.length === 0) {
      console.log('[SQS Consumer] 没有配置任何队列，跳过启动');
      return;
    }

    this.isRunning = true;
    console.log(`[SQS Consumer] 启动消费者，监听 ${this.queues.length} 个队列...`);

    // 为每个队列启动轮询
    for (const queue of this.queues) {
      this.consumerStatuses.set(queue.name, {
        queueName: queue.name,
        isRunning: true,
        messagesProcessed: 0,
        lastProcessedAt: null,
        errors: 0,
        adType: queue.adType,
        dataType: queue.dataType,
      });
      
      this.startPolling(queue);
    }
  }

  /**
   * 停止所有消费者
   */
  stop(): void {
    this.isRunning = false;
    
    // 清除所有轮询定时器
    for (const [queueName, timer] of this.pollTimers) {
      clearTimeout(timer);
      const status = this.consumerStatuses.get(queueName);
      if (status) {
        status.isRunning = false;
      }
    }
    this.pollTimers.clear();
    
    console.log('[SQS Consumer] 所有消费者已停止');
  }

  /**
   * 启动单个队列的轮询
   */
  private async startPolling(queue: SQSQueueConfig): Promise<void> {
    const poll = async () => {
      if (!this.isRunning) return;

      try {
        await this.pollQueue(queue);
      } catch (error: any) {
        console.error(`[SQS Consumer] 队列 ${queue.name} 轮询错误:`, error.message);
        const status = this.consumerStatuses.get(queue.name);
        if (status) {
          status.errors++;
        }
      }

      // 继续下一次轮询
      if (this.isRunning) {
        const timer = setTimeout(() => poll(), this.pollIntervalMs);
        this.pollTimers.set(queue.name, timer);
      }
    };

    // 开始轮询
    poll();
  }

  /**
   * 轮询单个队列
   */
  private async pollQueue(queue: SQSQueueConfig): Promise<void> {
    const command = new ReceiveMessageCommand({
      QueueUrl: queue.url,
      MaxNumberOfMessages: this.maxMessagesPerPoll,
      WaitTimeSeconds: 20, // 长轮询
      MessageAttributeNames: ['All'],
    });

    const response = await this.sqsClient.send(command);
    
    if (!response.Messages || response.Messages.length === 0) {
      return;
    }

    console.log(`[SQS Consumer] 从 ${queue.name} 收到 ${response.Messages.length} 条消息`);

    for (const message of response.Messages) {
      try {
        await this.processMessage(queue, message);
        
        // 删除已处理的消息
        if (message.ReceiptHandle) {
          await this.sqsClient.send(new DeleteMessageCommand({
            QueueUrl: queue.url,
            ReceiptHandle: message.ReceiptHandle,
          }));
        }

        // 更新状态
        const status = this.consumerStatuses.get(queue.name);
        if (status) {
          status.messagesProcessed++;
          status.lastProcessedAt = new Date().toISOString();
        }
      } catch (error: any) {
        console.error(`[SQS Consumer] 处理消息失败:`, error.message);
        const status = this.consumerStatuses.get(queue.name);
        if (status) {
          status.errors++;
        }
      }
    }
  }

  /**
   * 处理单条消息
   */
  private async processMessage(queue: SQSQueueConfig, message: any): Promise<void> {
    if (!message.Body) {
      console.warn('[SQS Consumer] 消息体为空');
      return;
    }

    let body: any;
    try {
      body = JSON.parse(message.Body);
    } catch (e) {
      console.error('[SQS Consumer] JSON解析失败:', message.Body.substring(0, 200));
      return;
    }
    
    // 处理SNS订阅确认消息
    if (body.Type === 'SubscriptionConfirmation') {
      await this.handleSubscriptionConfirmation(body);
      return;
    }
    
    // 解析SNS通知中的实际数据
    let amsData = body;
    if (body.Type === 'Notification' && body.Message) {
      try {
        amsData = JSON.parse(body.Message);
      } catch (e) {
        console.error('[SQS Consumer] 解析SNS消息内容失败');
        return;
      }
    }
    
    // 调试日志：打印消息结构
    console.log(`[SQS Consumer] 收到${queue.adType} ${queue.dataType}消息，结构:`, JSON.stringify(amsData).substring(0, 500));
    
    // 根据数据类型路由到不同的处理器
    switch (queue.dataType) {
      case 'traffic':
        await this.processTrafficMessage(amsData, queue.adType);
        break;
      case 'conversion':
        await this.processConversionMessage(amsData, queue.adType);
        break;
      case 'budget':
        await this.processBudgetMessage(amsData, queue.adType);
        break;
      default:
        console.warn(`[SQS Consumer] 未知数据类型: ${queue.dataType}`);
    }
  }

  /**
   * 处理SNS订阅确认消息
   */
  private async handleSubscriptionConfirmation(body: any): Promise<void> {
    const subscribeUrl = body.SubscribeURL;
    const topicArn = body.TopicArn;
    
    console.log(`[SQS Consumer] 收到SNS订阅确认请求: TopicArn=${topicArn}`);
    
    if (subscribeUrl) {
      try {
        const response = await axios.get(subscribeUrl, {
          timeout: 30000,
          headers: { 'User-Agent': 'AmazonAdsOptimizer/1.0' },
        });
        
        if (response.status === 200) {
          console.log(`[SQS Consumer] SNS订阅确认成功: TopicArn=${topicArn}`);
        } else {
          console.error(`[SQS Consumer] SNS订阅确认失败: status=${response.status}`);
        }
      } catch (error: any) {
        console.error(`[SQS Consumer] SNS订阅确认请求失败:`, error.message);
      }
    }
  }

  // 市场ID到国家代码的映射
  private marketplaceIdToCountry: Record<string, string> = {
    'ATVPDKIKX0DER': 'US',  // 美国
    'A2EUQ1WTGCTBG2': 'CA', // 加拿大
    'A1AM78C64UM0Y8': 'MX', // 墨西哥
    'A1PA6795UKMFR9': 'DE', // 德国
    'A1RKKUPIHCS9HS': 'ES', // 西班牙
    'A13V1IB3VIYBER': 'FR', // 法国
    'A1F83G8C2ARO7P': 'UK', // 英国
    'APJ6JRA9NG5V4': 'IT',  // 意大利
    'A1805IZSGTT6HS': 'NL', // 荷兰
    'A1C3SOZRARQ6R3': 'PL', // 波兰
    'A2NODRKZP88ZB9': 'SE', // 瑞典
    'A33AVAJ2PDY3EV': 'TR', // 土耳其
    'A21TJRUUN4KGV': 'IN',  // 印度
    'A19VAU5U5O7RUS': 'SG', // 新加坡
    'A39IBJ37TRP1C6': 'AU', // 澳大利亚
    'A1VC38T7YXB528': 'JP', // 日本
  };

  /**
   * 处理流量消息（展示、点击、花费）
   */
  private async processTrafficMessage(data: AmsTrafficMessage, adType: string): Promise<void> {
    const impressions = data.impressions || 0;
    const clicks = data.clicks || 0;
    // AMS的cost已经是美元单位，不需要转换
    const cost = data.cost || 0;
    const campaignId = data.campaign_id;
    const eventHour = data.event_hour;
    
    console.log(`[SQS Consumer] 处理${adType}流量消息: advertiser_id=${data.advertiser_id}, marketplace=${data.marketplace_id}, campaignId=${campaignId}, impressions=${impressions}, clicks=${clicks}, cost=$${cost.toFixed(4)}`);
    
    // 根据advertiser_id和marketplace_id查找对应的账户
    const account = await this.findAccountByAdvertiserId(data.advertiser_id, data.marketplace_id);
    if (!account) {
      console.warn(`[SQS Consumer] 未找到advertiser_id对应的账户: ${data.advertiser_id}, marketplace: ${data.marketplace_id}`);
      return;
    }

    // 从 event_hour 提取日期
    const date = eventHour ? eventHour.split('T')[0] : new Date().toISOString().split('T')[0];

    // 更新数据库
    try {
      await db.upsertDailyPerformanceFromAms({
        accountId: account.id,
        date: date,
        impressions: impressions,
        clicks: clicks,
        cost: cost,
        adType: adType,
      });
      console.log(`[SQS Consumer] ${adType}流量数据已保存: accountId=${account.id}, date=${date}`);
    } catch (error: any) {
      console.error(`[SQS Consumer] 保存${adType}流量数据失败:`, error.message);
    }
  }

  /**
   * 处理转化消息（销售、订单）
   */
  private async processConversionMessage(data: AmsConversionMessage, adType: string): Promise<void> {
    // 根据广告类型选择正确的字段
    let sales = 0;
    let orders = 0;
    
    if (adType === 'SP' || adType === 'SD') {
      // SP和SD使用14天归因窗口
      sales = data.attributed_sales_14d || data.attributed_sales_7d || 0;
      orders = data.attributed_conversions_14d || data.attributed_conversions_7d || data.purchases_14d || data.purchases_7d || 0;
    } else if (adType === 'SB') {
      // SB可能使用不同的字段名
      sales = data.sales || data.attributed_sales_14d || data.attributed_sales_7d || 0;
      orders = data.purchases || data.attributed_conversions_14d || data.attributed_conversions_7d || 0;
    }
    
    const campaignId = data.campaign_id;
    const eventHour = data.event_hour;
    
    console.log(`[SQS Consumer] 处理${adType}转化消息: advertiser_id=${data.advertiser_id}, marketplace=${data.marketplace_id}, campaignId=${campaignId}, sales=$${sales.toFixed(4)}, orders=${orders}`);
    
    // 根据advertiser_id和marketplace_id查找对应的账户
    const account = await this.findAccountByAdvertiserId(data.advertiser_id, data.marketplace_id);
    if (!account) {
      console.warn(`[SQS Consumer] 未找到advertiser_id对应的账户: ${data.advertiser_id}, marketplace: ${data.marketplace_id}`);
      return;
    }

    // 从 event_hour 提取日期
    const date = eventHour ? eventHour.split('T')[0] : new Date().toISOString().split('T')[0];

    // 更新数据库
    try {
      await db.updateDailyPerformanceConversion({
        accountId: account.id,
        date: date,
        sales: sales,
        orders: orders,
        adType: adType,
      });
      console.log(`[SQS Consumer] ${adType}转化数据已保存: accountId=${account.id}, date=${date}`);
    } catch (error: any) {
      console.error(`[SQS Consumer] 保存${adType}转化数据失败:`, error.message);
    }
  }

  /**
   * 处理预算消息
   */
  private async processBudgetMessage(data: AmsBudgetMessage, adType: string): Promise<void> {
    const budget = data.budget || 0;
    const budgetUsage = data.budget_usage || 0;
    const budgetPercentage = data.budget_usage_percentage || 0;
    const campaignId = data.campaign_id;
    
    console.log(`[SQS Consumer] 处理${adType}预算消息: advertiser_id=${data.advertiser_id}, campaignId=${campaignId}, budget=${budget}, usage=${budgetUsage}, percentage=${budgetPercentage}%`);
    
    // 预算数据是快照(Snapshot)，不是累加
    // 直接覆盖数据库中的值
    
    if (campaignId) {
      try {
        // 更新广告活动的预算使用情况
        await db.updateCampaignBudgetUsage(campaignId, {
          budgetUsage: budgetUsage,
          budgetUsagePercentage: budgetPercentage,
          lastBudgetUpdateAt: new Date().toISOString(),
        });
        console.log(`[SQS Consumer] ${adType}预算状态已更新: campaignId=${campaignId}`);
      } catch (error: any) {
        console.error(`[SQS Consumer] 更新${adType}预算状态失败:`, error.message);
      }
    }
    
    // 预算告警逻辑
    if (budgetPercentage > 80) {
      console.warn(`[SQS Consumer] 预算告警: campaignId=${campaignId} 已使用 ${budgetPercentage}%`);
      // TODO: 发送预算告警通知
    }
  }

  /**
   * 根据advertiser_id和marketplace_id查找账户
   * 
   * 多租户路由逻辑:
   * 1. 将marketplace_id转换为国家代码
   * 2. 在数据库中查找匹配的账户
   */
  private async findAccountByAdvertiserId(advertiserId: string, marketplaceId: string): Promise<{ id: number } | null> {
    try {
      const accounts = await db.getAdAccounts();
      const country = this.marketplaceIdToCountry[marketplaceId];
      
      console.log(`[SQS Consumer] 查找账户: advertiserId=${advertiserId}, marketplaceId=${marketplaceId}, country=${country}`);
      console.log(`[SQS Consumer] 数据库中的账户: ${accounts.map(a => `${a.marketplace}(id=${a.id})`).join(', ')}`);
      
      // 通过marketplace字段匹配国家代码
      let account = accounts.find(a => a.marketplace === country);
      
      if (account) {
        console.log(`[SQS Consumer] 找到匹配账户: id=${account.id}, marketplace=${account.marketplace}`);
      } else {
        console.warn(`[SQS Consumer] 未找到匹配账户，country=${country}`);
      }
      
      return account ? { id: account.id } : null;
    } catch (error: any) {
      console.error(`[SQS Consumer] 查找账户失败:`, error.message);
      return null;
    }
  }

  /**
   * 获取所有消费者状态
   */
  getStatus(): ConsumerStatus[] {
    return Array.from(this.consumerStatuses.values());
  }

  /**
   * 获取队列统计信息
   */
  async getQueueStats(): Promise<Array<{
    name: string;
    adType: string;
    dataType: string;
    messagesAvailable: number;
    messagesInFlight: number;
  }>> {
    const stats = [];
    
    for (const queue of this.queues) {
      try {
        const command = new GetQueueAttributesCommand({
          QueueUrl: queue.url,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
        });
        
        const response = await this.sqsClient.send(command);
        
        stats.push({
          name: queue.name,
          adType: queue.adType,
          dataType: queue.dataType,
          messagesAvailable: parseInt(response.Attributes?.ApproximateNumberOfMessages || '0'),
          messagesInFlight: parseInt(response.Attributes?.ApproximateNumberOfMessagesNotVisible || '0'),
        });
      } catch (error: any) {
        console.error(`[SQS Consumer] 获取队列 ${queue.name} 统计失败:`, error.message);
        stats.push({
          name: queue.name,
          adType: queue.adType,
          dataType: queue.dataType,
          messagesAvailable: -1,
          messagesInFlight: -1,
        });
      }
    }
    
    return stats;
  }
  
  /**
   * 获取已配置的队列数量
   */
  getQueueCount(): number {
    return this.queues.length;
  }
  
  /**
   * 检查消费者是否正在运行
   */
  isConsumerRunning(): boolean {
    return this.isRunning;
  }
}

// 单例实例
let sqsConsumerInstance: SQSConsumerService | null = null;

/**
 * 获取SQS消费者服务实例
 */
export function getSQSConsumer(): SQSConsumerService {
  if (!sqsConsumerInstance) {
    sqsConsumerInstance = new SQSConsumerService();
  }
  return sqsConsumerInstance;
}

/**
 * 启动SQS消费者
 */
export async function startSQSConsumer(): Promise<void> {
  const consumer = getSQSConsumer();
  await consumer.start();
}

/**
 * 停止SQS消费者
 */
export function stopSQSConsumer(): void {
  if (sqsConsumerInstance) {
    sqsConsumerInstance.stop();
  }
}
