/**
 * SQS消费者服务 - 从Amazon Marketing Stream队列读取实时广告数据
 * 
 * 支持的队列类型:
 * - sp-traffic: SP广告流量数据（展示、点击、花费）
 * - sp-conversion: SP广告转化数据（销售、订单）
 * - budget-usage: 预算使用数据
 */

import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import * as db from './db';

// SQS队列配置
export interface SQSQueueConfig {
  name: string;
  url: string;
  arn: string;
  type: 'traffic' | 'conversion' | 'budget';
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
  cost?: number;  // 单位: 美分
  
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
    this.loadQueueConfigs();
  }

  /**
   * 从环境变量加载SQS队列配置
   */
  private loadQueueConfigs(): void {
    // 支持多队列配置
    // 格式: AWS_SQS_QUEUE_TRAFFIC_URL, AWS_SQS_QUEUE_CONVERSION_URL, AWS_SQS_QUEUE_BUDGET_URL
    
    const trafficQueueUrl = process.env.AWS_SQS_QUEUE_TRAFFIC_URL;
    const conversionQueueUrl = process.env.AWS_SQS_QUEUE_CONVERSION_URL;
    const budgetQueueUrl = process.env.AWS_SQS_QUEUE_BUDGET_URL;
    
    // 如果没有单独配置，尝试从主队列ARN推断
    const mainQueueArn = process.env.AWS_SQS_QUEUE_ARN;
    
    if (trafficQueueUrl) {
      this.queues.push({
        name: 'AmzStream-NA-sp-traffic-IngressQueue',
        url: trafficQueueUrl,
        arn: this.urlToArn(trafficQueueUrl),
        type: 'traffic',
      });
    }
    
    if (conversionQueueUrl) {
      this.queues.push({
        name: 'AmzStream-NA-sp-conversion-IngressQueue',
        url: conversionQueueUrl,
        arn: this.urlToArn(conversionQueueUrl),
        type: 'conversion',
      });
    }
    
    if (budgetQueueUrl) {
      this.queues.push({
        name: 'AmzStream-NA-budget-usage-IngressQueue',
        url: budgetQueueUrl,
        arn: this.urlToArn(budgetQueueUrl),
        type: 'budget',
      });
    }

    // 如果没有配置任何队列，记录警告
    if (this.queues.length === 0) {
      console.warn('[SQS Consumer] 未配置任何SQS队列URL，请设置以下环境变量:');
      console.warn('  - AWS_SQS_QUEUE_TRAFFIC_URL');
      console.warn('  - AWS_SQS_QUEUE_CONVERSION_URL');
      console.warn('  - AWS_SQS_QUEUE_BUDGET_URL');
    } else {
      console.log(`[SQS Consumer] 已加载 ${this.queues.length} 个队列配置`);
      this.queues.forEach(q => console.log(`  - ${q.name}: ${q.type}`));
    }
  }

  /**
   * 将SQS URL转换为ARN
   */
  private urlToArn(url: string): string {
    // URL格式: https://sqs.{region}.amazonaws.com/{accountId}/{queueName}
    const match = url.match(/sqs\.([^.]+)\.amazonaws\.com\/(\d+)\/(.+)/);
    if (match) {
      const [, region, accountId, queueName] = match;
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
      console.log(`[SQS Consumer] 添加队列: ${config.name} (${config.type})`);
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
      console.error('[SQS Consumer] 没有配置任何队列，无法启动');
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
    
    // 调试日志：打印消息结构
    console.log(`[SQS Consumer] 收到${queue.type}消息，结构:`, JSON.stringify(body).substring(0, 500));
    
    // 根据队列类型处理不同的消息
    switch (queue.type) {
      case 'traffic':
        await this.processTrafficMessage(body);
        break;
      case 'conversion':
        await this.processConversionMessage(body);
        break;
      case 'budget':
        await this.processBudgetMessage(body);
        break;
      default:
        console.warn(`[SQS Consumer] 未知队列类型: ${queue.type}`);
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
  private async processTrafficMessage(data: AmsTrafficMessage): Promise<void> {
    const impressions = data.impressions || 0;
    const clicks = data.clicks || 0;
    const cost = (data.cost || 0) / 100; // 从micro转换为美元
    const campaignId = data.campaign_id;
    const eventHour = data.event_hour;
    
    console.log(`[SQS Consumer] 处理流量消息: advertiser_id=${data.advertiser_id}, marketplace=${data.marketplace_id}, campaignId=${campaignId}, impressions=${impressions}, clicks=${clicks}, cost=$${cost.toFixed(2)}`);
    
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
      });
      console.log(`[SQS Consumer] 流量数据已保存: accountId=${account.id}, date=${date}`);
    } catch (error: any) {
      console.error(`[SQS Consumer] 保存流量数据失败:`, error.message);
    }
  }

  /**
   * 处理转化消息（销售、订单）
   */
  private async processConversionMessage(data: AmsConversionMessage): Promise<void> {
    // 使用 14天归因窗口的数据（与Amazon后台一致）
    const sales = (data.attributed_sales_14d || data.attributed_sales_7d || 0) / 100; // 从micro转换为美元
    const orders = data.attributed_conversions_14d || data.attributed_conversions_7d || data.purchases_14d || data.purchases_7d || 0;
    const campaignId = data.campaign_id;
    const eventHour = data.event_hour;
    
    console.log(`[SQS Consumer] 处理转化消息: advertiser_id=${data.advertiser_id}, marketplace=${data.marketplace_id}, campaignId=${campaignId}, sales=$${sales.toFixed(2)}, orders=${orders}`);
    
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
      });
      console.log(`[SQS Consumer] 转化数据已保存: accountId=${account.id}, date=${date}`);
    } catch (error: any) {
      console.error(`[SQS Consumer] 保存转化数据失败:`, error.message);
    }
  }

  /**
   * 处理预算消息
   */
  private async processBudgetMessage(data: AmsBudgetMessage): Promise<void> {
    const budgetUsage = data.budget_usage || 0;
    const budgetPercentage = data.budget_usage_percentage || 0;
    const campaignId = data.campaign_id;
    
    console.log(`[SQS Consumer] 处理预算消息: advertiser_id=${data.advertiser_id}, campaignId=${campaignId}, usage=${budgetUsage}, percentage=${budgetPercentage}%`);
    
    // 预算消息可以用于实时预算监控和告警
    if (budgetPercentage > 80) {
      console.warn(`[SQS Consumer] 预算告警: campaignId=${campaignId} 已使用 ${budgetPercentage}%`);
      // TODO: 发送预算告警通知
    }
  }

  /**
   * 根据advertiser_id和marketplace_id查找账户
   * 
   * 数据库字段说明:
   * - accountId: Amazon Ads profile ID (如 "599502392622991")
   * - marketplace: 国家代码 (如 "US", "CA", "MX")
   * 
   * AMS消息字段说明:
   * - advertiser_id: Amazon卖家ID (如 "A2IDI0O8158CRH")
   * - marketplace_id: Amazon市场ID (如 "ATVPDKIKX0DER" = US)
   */
  private async findAccountByAdvertiserId(advertiserId: string, marketplaceId: string): Promise<{ id: number } | null> {
    try {
      const accounts = await db.getAdAccounts();
      const country = this.marketplaceIdToCountry[marketplaceId];
      
      console.log(`[SQS Consumer] 查找账户: advertiserId=${advertiserId}, marketplaceId=${marketplaceId}, country=${country}`);
      console.log(`[SQS Consumer] 数据库中的账户: ${accounts.map(a => `${a.marketplace}(id=${a.id})`).join(', ')}`);
      
      // 通过marketplace字段匹配国家代码
      // 数据库中的marketplace字段存储的是国家代码 (US, CA, MX等)
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
    type: string;
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
          type: queue.type,
          messagesAvailable: parseInt(response.Attributes?.ApproximateNumberOfMessages || '0'),
          messagesInFlight: parseInt(response.Attributes?.ApproximateNumberOfMessagesNotVisible || '0'),
        });
      } catch (error: any) {
        console.error(`[SQS Consumer] 获取队列 ${queue.name} 统计失败:`, error.message);
        stats.push({
          name: queue.name,
          type: queue.type,
          messagesAvailable: -1,
          messagesInFlight: -1,
        });
      }
    }
    
    return stats;
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
