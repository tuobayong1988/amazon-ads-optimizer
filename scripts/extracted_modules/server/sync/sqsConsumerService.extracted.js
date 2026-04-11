// Extracted from production dist/index.js
// Original module: server/sync/sqsConsumerService.ts
// Lines: 783

function getSQSConsumer() {
  if (!sqsConsumerInstance) {
    sqsConsumerInstance = new SQSConsumerService();
  }
  return sqsConsumerInstance;
}
async function startSQSConsumer() {
  const consumer = getSQSConsumer();
  await consumer.start();
}
function stopSQSConsumer() {
  if (sqsConsumerInstance) {
    sqsConsumerInstance.stop();
  }
}
var import_client_sqs, log81, SQSConsumerService, sqsConsumerInstance;
var init_sqsConsumerService = __esm({
  "server/sync/sqsConsumerService.ts"() {
    "use strict";
    import_client_sqs = require("@aws-sdk/client-sqs");
    init_axios2();
    init_db2();
    init_logger();
    init_opsLogger();
    log81 = createModuleLogger("SQSConsumer");
    SQSConsumerService = class {
      static {
        __name(this, "SQSConsumerService");
      }
      sqsClient;
      queues = [];
      isRunning = false;
      pollIntervalMs = 5e3;
      // 5秒轮询间隔
      maxMessagesPerPoll = 10;
      consumerStatuses = /* @__PURE__ */ new Map();
      pollTimers = /* @__PURE__ */ new Map();
      constructor() {
        const sqsConfig = {
          region: process.env.AWS_REGION || "us-east-1"
        };
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
          sqsConfig.credentials = {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
          };
          log81.info("[SQS Consumer] \u4F7F\u7528\u663E\u5F0FAWS\u51ED\u8BC1\u521D\u59CB\u5316SQS\u5BA2\u6237\u7AEF");
        } else {
          log81.info("[SQS Consumer] \u4F7F\u7528IAM\u89D2\u8272\u9ED8\u8BA4\u51ED\u8BC1\u94FE\u521D\u59CB\u5316SQS\u5BA2\u6237\u7AEF");
        }
        this.sqsClient = new import_client_sqs.SQSClient(sqsConfig);
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
      loadAllQueueConfigs() {
        const spTrafficUrl = process.env.AWS_SQS_QUEUE_TRAFFIC_URL;
        const spConversionUrl = process.env.AWS_SQS_QUEUE_CONVERSION_URL;
        const spBudgetUrl = process.env.AWS_SQS_QUEUE_BUDGET_URL;
        const sbTrafficUrl = process.env.AWS_SQS_QUEUE_SB_TRAFFIC_URL;
        const sbConversionUrl = process.env.AWS_SQS_QUEUE_SB_CONVERSION_URL;
        const sbBudgetUrl = process.env.AWS_SQS_QUEUE_SB_BUDGET_URL;
        const sdTrafficUrl = process.env.AWS_SQS_QUEUE_SD_TRAFFIC_URL;
        const sdConversionUrl = process.env.AWS_SQS_QUEUE_SD_CONVERSION_URL;
        const sdBudgetUrl = process.env.AWS_SQS_QUEUE_SD_BUDGET_URL;
        if (spTrafficUrl) {
          this.queues.push({
            name: "AmzStream-NA-sp-traffic-IngressQueue",
            url: spTrafficUrl,
            arn: this.urlToArn(spTrafficUrl),
            adType: "SP",
            dataType: "traffic"
          });
        }
        if (spConversionUrl) {
          this.queues.push({
            name: "AmzStream-NA-sp-conversion-IngressQueue",
            url: spConversionUrl,
            arn: this.urlToArn(spConversionUrl),
            adType: "SP",
            dataType: "conversion"
          });
        }
        if (spBudgetUrl) {
          this.queues.push({
            name: "AmzStream-NA-budget-usage-IngressQueue",
            url: spBudgetUrl,
            arn: this.urlToArn(spBudgetUrl),
            adType: "SP",
            dataType: "budget"
          });
        }
        if (sbTrafficUrl) {
          this.queues.push({
            name: "AmzStream-NA-sb-traffic-IngressQueue",
            url: sbTrafficUrl,
            arn: this.urlToArn(sbTrafficUrl),
            adType: "SB",
            dataType: "traffic"
          });
        }
        if (sbConversionUrl) {
          this.queues.push({
            name: "AmzStream-NA-sb-conversion-IngressQueue",
            url: sbConversionUrl,
            arn: this.urlToArn(sbConversionUrl),
            adType: "SB",
            dataType: "conversion"
          });
        }
        if (sbBudgetUrl) {
          this.queues.push({
            name: "AmzStream-NA-sb-budget-usage-IngressQueue",
            url: sbBudgetUrl,
            arn: this.urlToArn(sbBudgetUrl),
            adType: "SB",
            dataType: "budget"
          });
        }
        if (sdTrafficUrl) {
          this.queues.push({
            name: "AmzStream-NA-sd-traffic-IngressQueue",
            url: sdTrafficUrl,
            arn: this.urlToArn(sdTrafficUrl),
            adType: "SD",
            dataType: "traffic"
          });
        }
        if (sdConversionUrl) {
          this.queues.push({
            name: "AmzStream-NA-sd-conversion-IngressQueue",
            url: sdConversionUrl,
            arn: this.urlToArn(sdConversionUrl),
            adType: "SD",
            dataType: "conversion"
          });
        }
        if (sdBudgetUrl) {
          this.queues.push({
            name: "AmzStream-NA-sd-budget-usage-IngressQueue",
            url: sdBudgetUrl,
            arn: this.urlToArn(sdBudgetUrl),
            adType: "SD",
            dataType: "budget"
          });
        }
        if (this.queues.length === 0) {
          log81.info("[SQS Consumer] \u672A\u914D\u7F6ESQS\u961F\u5217URL\uFF0C\u8DF3\u8FC7AMS\u6D88\u8D39\u8005\u542F\u52A8");
          log81.debug("[SQS Consumer] \u5982\u9700\u542F\u7528AMS\u5B9E\u65F6\u6570\u636E\u6D41\uFF0C\u8BF7\u914D\u7F6E\u4EE5\u4E0B\u73AF\u5883\u53D8\u91CF:");
          log81.debug("  SP\u961F\u5217:");
          log81.debug("    - AWS_SQS_QUEUE_TRAFFIC_URL");
          log81.debug("    - AWS_SQS_QUEUE_CONVERSION_URL");
          log81.debug("    - AWS_SQS_QUEUE_BUDGET_URL");
          log81.debug("  SB\u961F\u5217:");
          log81.debug("    - AWS_SQS_QUEUE_SB_TRAFFIC_URL");
          log81.debug("    - AWS_SQS_QUEUE_SB_CONVERSION_URL");
          log81.debug("    - AWS_SQS_QUEUE_SB_BUDGET_URL");
          log81.debug("  SD\u961F\u5217:");
          log81.debug("    - AWS_SQS_QUEUE_SD_TRAFFIC_URL");
          log81.debug("    - AWS_SQS_QUEUE_SD_CONVERSION_URL");
          log81.debug("    - AWS_SQS_QUEUE_SD_BUDGET_URL");
        } else {
          log81.info(`[SQS Consumer] \u5DF2\u52A0\u8F7D ${this.queues.length} \u4E2A\u961F\u5217\u914D\u7F6E:`);
          this.queues.forEach((q) => log81.debug(`  - ${q.name}: ${q.adType} ${q.dataType}`));
        }
      }
      /**
       * 将SQS URL转换为ARN
       */
      urlToArn(url3) {
        let match = url3.match(/sqs\.([^.]+)\.amazonaws\.com\/(\d+)\/(.+)/);
        if (match) {
          const [, region, accountId, queueName] = match;
          return `arn:aws:sqs:${region}:${accountId}:${queueName}`;
        }
        match = url3.match(/queue\.amazonaws\.com\/(\d+)\/(.+)/);
        if (match) {
          const [, accountId, queueName] = match;
          const region = process.env.AWS_REGION || "us-east-1";
          return `arn:aws:sqs:${region}:${accountId}:${queueName}`;
        }
        return url3;
      }
      /**
       * 手动添加队列配置
       */
      addQueue(config2) {
        const existing = this.queues.find((q) => q.url === config2.url);
        if (!existing) {
          this.queues.push(config2);
          log81.debug(`[SQS Consumer] \u6DFB\u52A0\u961F\u5217: ${config2.name} (${config2.adType} ${config2.dataType})`);
        }
      }
      /**
       * 启动所有队列的消费者
       */
      async start() {
        if (this.isRunning) {
          log81.debug("[SQS Consumer] \u6D88\u8D39\u8005\u5DF2\u5728\u8FD0\u884C\u4E2D");
          return;
        }
        if (this.queues.length === 0) {
          log81.info("[SQS Consumer] \u6CA1\u6709\u914D\u7F6E\u4EFB\u4F55\u961F\u5217\uFF0C\u8DF3\u8FC7\u542F\u52A8");
          return;
        }
        this.isRunning = true;
        log81.info(`[SQS Consumer] \u542F\u52A8\u6D88\u8D39\u8005\uFF0C\u76D1\u542C ${this.queues.length} \u4E2A\u961F\u5217...`);
        logSystem("SQSConsumer", `\u542F\u52A8\u6D88\u8D39\u8005\uFF0C\u76D1\u542C ${this.queues.length} \u4E2A\u961F\u5217`, {
          queues: this.queues.map((q) => ({ name: q.name, adType: q.adType, dataType: q.dataType }))
        });
        for (const queue of this.queues) {
          this.consumerStatuses.set(queue.name, {
            queueName: queue.name,
            isRunning: true,
            messagesProcessed: 0,
            lastProcessedAt: null,
            errors: 0,
            adType: queue.adType,
            dataType: queue.dataType
          });
          this.startPolling(queue);
        }
      }
      /**
       * 停止所有消费者
       */
      stop() {
        this.isRunning = false;
        for (const [queueName, timer] of this.pollTimers) {
          clearTimeout(timer);
          const status = this.consumerStatuses.get(queueName);
          if (status) {
            status.isRunning = false;
          }
        }
        this.pollTimers.clear();
        log81.debug("[SQS Consumer] \u6240\u6709\u6D88\u8D39\u8005\u5DF2\u505C\u6B62");
        logSystem("SQSConsumer", "\u6240\u6709\u6D88\u8D39\u8005\u5DF2\u505C\u6B62");
      }
      /**
       * 启动单个队列的轮询
       */
      async startPolling(queue) {
        const poll = /* @__PURE__ */ __name(async () => {
          if (!this.isRunning) return;
          try {
            await this.pollQueue(queue);
          } catch (error48) {
            const errMsg = error48.message || "Unknown error";
            const errName = error48.name || "Error";
            const statusCode = error48.$metadata?.httpStatusCode || error48.statusCode || "";
            log81.warn(`[SQS Consumer] \u961F\u5217 ${queue.name} \u8F6E\u8BE2\u9519\u8BEF: [${errName}${statusCode ? ` HTTP ${statusCode}` : ""}] ${errMsg}`);
            logSyncError("SQSConsumer", `\u961F\u5217${queue.name}\u8F6E\u8BE2\u9519\u8BEF`, { queue: queue.name, errorName: errName, statusCode, error: errMsg });
            const status = this.consumerStatuses.get(queue.name);
            if (status) {
              status.errors++;
            }
          }
          if (this.isRunning) {
            const timer = setTimeout(() => poll(), this.pollIntervalMs);
            this.pollTimers.set(queue.name, timer);
          }
        }, "poll");
        poll();
      }
      /**
       * 轮询单个队列
       */
      async pollQueue(queue) {
        const command = new import_client_sqs.ReceiveMessageCommand({
          QueueUrl: queue.url,
          MaxNumberOfMessages: this.maxMessagesPerPoll,
          WaitTimeSeconds: 20,
          // 长轮询
          MessageAttributeNames: ["All"]
        });
        const response = await this.sqsClient.send(command);
        if (!response.Messages || response.Messages.length === 0) {
          return;
        }
        log81.info(`[SQS Consumer] ${queue.adType}-${queue.dataType}: \u6536\u5230${response.Messages.length}\u6761\u6D88\u606F\uFF0C\u5F00\u59CB\u5904\u7406`);
        for (const message2 of response.Messages) {
          try {
            await this.processMessage(queue, message2);
            if (message2.ReceiptHandle) {
              await this.sqsClient.send(new import_client_sqs.DeleteMessageCommand({
                QueueUrl: queue.url,
                ReceiptHandle: message2.ReceiptHandle
              }));
            }
            const status = this.consumerStatuses.get(queue.name);
            if (status) {
              status.messagesProcessed++;
              status.lastProcessedAt = (/* @__PURE__ */ new Date()).toISOString();
            }
          } catch (error48) {
            log81.warn(`[SQS Consumer] \u5904\u7406\u6D88\u606F\u5931\u8D25:`, error48.message);
            logSyncError("SQSConsumer", `\u5904\u7406\u6D88\u606F\u5931\u8D25`, { queue: queue.name, error: error48.message });
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
      // @ts-ignore
      async processMessage(queue, message2) {
        if (!message2.Body) {
          log81.warn("[SQS Consumer] \u6D88\u606F\u4F53\u4E3A\u7A7A");
          return;
        }
        let body;
        try {
          body = JSON.parse(message2.Body);
        } catch (e) {
          log81.warn("[SQS Consumer] JSON\u89E3\u6790\u5931\u8D25:", message2.Body.substring(0, 200));
          logSyncError("SQSConsumer", "JSON\u89E3\u6790\u5931\u8D25", { preview: message2.Body.substring(0, 200) });
          return;
        }
        if (body.Type === "SubscriptionConfirmation") {
          await this.handleSubscriptionConfirmation(body);
          return;
        }
        let amsData = body;
        if (body.Type === "Notification" && body.Message) {
          try {
            amsData = JSON.parse(body.Message);
          } catch (e) {
            log81.warn("[SQS Consumer] \u89E3\u6790SNS\u6D88\u606F\u5185\u5BB9\u5931\u8D25");
            return;
          }
        }
        log81.debug(`[SQS Consumer] \u6536\u5230${queue.adType} ${queue.dataType}\u6D88\u606F\uFF0C\u7ED3\u6784:`, JSON.stringify(amsData).substring(0, 500));
        switch (queue.dataType) {
          case "traffic":
            await this.processTrafficMessage(amsData, queue.adType);
            break;
          case "conversion":
            await this.processConversionMessage(amsData, queue.adType);
            break;
          case "budget":
            await this.processBudgetMessage(amsData, queue.adType);
            break;
          default:
            log81.warn(`[SQS Consumer] \u672A\u77E5\u6570\u636E\u7C7B\u578B: ${queue.dataType}`);
        }
      }
      /**
       * 处理SNS订阅确认消息
       */
      async handleSubscriptionConfirmation(body) {
        const subscribeUrl = body.SubscribeURL;
        const topicArn = body.TopicArn;
        log81.debug(`[SQS Consumer] \u6536\u5230SNS\u8BA2\u9605\u786E\u8BA4\u8BF7\u6C42: TopicArn=${topicArn}`);
        if (subscribeUrl) {
          try {
            const response = await axios_default.get(subscribeUrl, {
              timeout: 3e4,
              headers: { "User-Agent": "AmazonAdsOptimizer/1.0" }
            });
            if (response.status === 200) {
              log81.info(`[SQS Consumer] SNS\u8BA2\u9605\u786E\u8BA4\u6210\u529F: TopicArn=${topicArn}`);
            } else {
              log81.warn(`[SQS Consumer] SNS\u8BA2\u9605\u786E\u8BA4\u5931\u8D25: status=${response.status}`);
            }
          } catch (error48) {
            log81.warn(`[SQS Consumer] SNS\u8BA2\u9605\u786E\u8BA4\u8BF7\u6C42\u5931\u8D25:`, error48.message);
          }
        }
      }
      // 市场ID到国家代码的映射
      marketplaceIdToCountry = {
        "ATVPDKIKX0DER": "US",
        // 美国
        "A2EUQ1WTGCTBG2": "CA",
        // 加拿大
        "A1AM78C64UM0Y8": "MX",
        // 墨西哥
        "A1PA6795UKMFR9": "DE",
        // 德国
        "A1RKKUPIHCS9HS": "ES",
        // 西班牙
        "A13V1IB3VIYBER": "FR",
        // 法国
        "A1F83G8C2ARO7P": "UK",
        // 英国
        "APJ6JRA9NG5V4": "IT",
        // 意大利
        "A1805IZSGTT6HS": "NL",
        // 荷兰
        "A1C3SOZRARQ6R3": "PL",
        // 波兰
        "A2NODRKZP88ZB9": "SE",
        // 瑞典
        "A33AVAJ2PDY3EV": "TR",
        // 土耳其
        "A21TJRUUN4KGV": "IN",
        // 印度
        "A19VAU5U5O7RUS": "SG",
        // 新加坡
        "A39IBJ37TRP1C6": "AU",
        // 澳大利亚
        "A1VC38T7YXB528": "JP"
        // 日本
      };
      /**
       * 处理流量消息（展示、点击、花费）
       */
      async processTrafficMessage(data, adType) {
        const impressions = data.impressions || 0;
        const clicks = data.clicks || 0;
        const cost = data.cost || 0;
        const campaignId = data.campaign_id;
        const eventHour = data.event_hour;
        log81.debug(`[SQS Consumer] \u5904\u7406${adType}\u6D41\u91CF\u6D88\u606F: advertiser_id=${data.advertiser_id}, marketplace=${data.marketplace_id}, campaignId=${campaignId}, impressions=${impressions}, clicks=${clicks}, cost=$${cost.toFixed(4)}`);
        const account = await this.findAccountByAdvertiserId(data.advertiser_id, data.marketplace_id);
        if (!account) {
          log81.warn(`[SQS Consumer] \u672A\u627E\u5230advertiser_id\u5BF9\u5E94\u7684\u8D26\u6237: ${data.advertiser_id}, marketplace: ${data.marketplace_id}`);
          return;
        }
        const date6 = eventHour ? eventHour.split("T")[0] : (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        let amazonCampaignId = null;
        if (campaignId) {
          const candidateId = String(campaignId);
          if (/^\d{9,20}$/.test(candidateId)) {
            amazonCampaignId = candidateId;
          } else {
            log81.warn(`[SQS Consumer] \u6D41\u91CF\u6D88\u606FcampaignId\u683C\u5F0F\u5F02\u5E38\uFF0C\u7591\u4F3C\u975EAmazon ID: ${candidateId}`);
            try {
              const dbModule = await Promise.resolve().then(() => (init_db2(), db_exports));
              const campaign = await dbModule.getCampaignByAmazonId(account.id, candidateId);
              if (campaign) amazonCampaignId = campaign.campaignId;
            } catch (e) {
            }
          }
        }
        try {
          await upsertDailyPerformanceFromAms({
            accountId: account.id,
            date: date6,
            impressions,
            clicks,
            cost,
            adType,
            campaignId: amazonCampaignId,
            idempotencyId: data.idempotency_id,
            // v442: AMS消息幂等性ID，用于去重
            datasetId: data.dataset_id
            // v442: 数据集ID
          });
          log81.debug(`[SQS Consumer] ${adType}\u6D41\u91CF\u6570\u636E\u5DF2\u4FDD\u5B58: accountId=${account.id}, campaignId=${amazonCampaignId || "N/A(account-level)"}, date=${date6}`);
        } catch (error48) {
          log81.warn(`[SQS Consumer] \u4FDD\u5B58${adType}\u6D41\u91CF\u6570\u636E\u5931\u8D25:`, error48.message);
        }
        if (amazonCampaignId && adType === "SP" && (data.keyword_id || data.target_id)) {
          try {
            await this.upsertKeywordPlacementHourlyData({
              accountId: account.id,
              campaignId: amazonCampaignId,
              amazonAdGroupId: data.ad_group_id || null,
              amazonKeywordId: data.keyword_id || null,
              amazonTargetId: data.target_id || null,
              placement: this.mapPlacementType(data.campaign_placement_type),
              date: date6,
              eventHour: eventHour || "",
              impressions,
              clicks,
              spend: cost,
              sales: 0,
              orders: 0,
              dataType: "traffic"
            });
          } catch (err) {
            log81.warn(`[SQS Consumer] v183: \u5199\u5165\u4EA4\u53C9\u7EF4\u5EA6\u6D41\u91CF\u6570\u636E\u5931\u8D25: ${err.message}`);
          }
        }
      }
      /**
       * 处理转化消息（销售、订单）
       */
      async processConversionMessage(data, adType) {
        let sales = 0;
        let orders = 0;
        if (adType === "SP" || adType === "SD") {
          sales = data.attributed_sales_14d || data.attributed_sales_7d || 0;
          orders = data.attributed_conversions_14d || data.attributed_conversions_7d || data.purchases_14d || data.purchases_7d || 0;
        } else if (adType === "SB") {
          sales = data.sales || data.attributed_sales_14d || data.attributed_sales_7d || 0;
          orders = data.purchases || data.attributed_conversions_14d || data.attributed_conversions_7d || 0;
        }
        const campaignId = data.campaign_id;
        const eventHour = data.event_hour;
        log81.debug(`[SQS Consumer] \u5904\u7406${adType}\u8F6C\u5316\u6D88\u606F: advertiser_id=${data.advertiser_id}, marketplace=${data.marketplace_id}, campaignId=${campaignId}, sales=$${sales.toFixed(4)}, orders=${orders}`);
        const account = await this.findAccountByAdvertiserId(data.advertiser_id, data.marketplace_id);
        if (!account) {
          log81.warn(`[SQS Consumer] \u672A\u627E\u5230advertiser_id\u5BF9\u5E94\u7684\u8D26\u6237: ${data.advertiser_id}, marketplace: ${data.marketplace_id}`);
          return;
        }
        const date6 = eventHour ? eventHour.split("T")[0] : (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        let amazonCampaignId = null;
        if (campaignId) {
          const candidateId = String(campaignId);
          if (/^\d{9,20}$/.test(candidateId)) {
            amazonCampaignId = candidateId;
          } else {
            log81.warn(`[SQS Consumer] \u8F6C\u5316\u6D88\u606FcampaignId\u683C\u5F0F\u5F02\u5E38\uFF0C\u7591\u4F3C\u975EAmazon ID: ${candidateId}`);
            try {
              const dbModule = await Promise.resolve().then(() => (init_db2(), db_exports));
              const campaign = await dbModule.getCampaignByAmazonId(account.id, candidateId);
              if (campaign) amazonCampaignId = campaign.campaignId;
            } catch (e) {
            }
          }
        }
        try {
          await updateDailyPerformanceConversion({
            accountId: account.id,
            date: date6,
            sales,
            orders,
            adType,
            campaignId: amazonCampaignId,
            idempotencyId: data.idempotency_id,
            // v442: AMS消息幂等性ID，用于去重
            datasetId: data.dataset_id
            // v442: 数据集ID
          });
          log81.debug(`[SQS Consumer] ${adType}\u8F6C\u5316\u6570\u636E\u5DF2\u4FDD\u5B58: accountId=${account.id}, campaignId=${amazonCampaignId || "N/A(account-level)"}, date=${date6}`);
        } catch (error48) {
          log81.warn(`[SQS Consumer] \u4FDD\u5B58${adType}\u8F6C\u5316\u6570\u636E\u5931\u8D25:`, error48.message);
        }
        if (amazonCampaignId && adType === "SP" && (data.keyword_id || data.target_id)) {
          try {
            await this.upsertKeywordPlacementHourlyData({
              accountId: account.id,
              campaignId: amazonCampaignId,
              amazonAdGroupId: data.ad_group_id || null,
              amazonKeywordId: data.keyword_id || null,
              amazonTargetId: data.target_id || null,
              placement: this.mapPlacementType(data.campaign_placement_type),
              date: date6,
              eventHour: eventHour || "",
              impressions: 0,
              clicks: 0,
              spend: 0,
              sales,
              orders,
              dataType: "conversion"
            });
          } catch (err) {
            log81.warn(`[SQS Consumer] v183: \u5199\u5165\u4EA4\u53C9\u7EF4\u5EA6\u8F6C\u5316\u6570\u636E\u5931\u8D25: ${err.message}`);
          }
        }
      }
      /**
       * 处理预算消息
       */
      async processBudgetMessage(data, adType) {
        const budget = data.budget || 0;
        const budgetUsage = data.budget_usage || 0;
        const budgetPercentage = data.budget_usage_percentage || 0;
        const campaignId = data.campaign_id;
        log81.debug(`[SQS Consumer] \u5904\u7406${adType}\u9884\u7B97\u6D88\u606F: advertiser_id=${data.advertiser_id}, campaignId=${campaignId}, budget=${budget}, usage=${budgetUsage}, percentage=${budgetPercentage}%`);
        if (campaignId) {
          try {
            await updateCampaignBudgetUsage(campaignId, {
              budgetUsage,
              budgetUsagePercentage: budgetPercentage,
              lastBudgetUpdateAt: (/* @__PURE__ */ new Date()).toISOString()
            });
            log81.info(`[SQS Consumer] ${adType}\u9884\u7B97\u72B6\u6001\u5DF2\u66F4\u65B0: campaignId=${campaignId}`);
          } catch (error48) {
            log81.warn(`[SQS Consumer] \u66F4\u65B0${adType}\u9884\u7B97\u72B6\u6001\u5931\u8D25:`, error48.message);
          }
        }
        if (budgetPercentage > 80) {
          log81.warn(`[SQS Consumer] \u9884\u7B97\u544A\u8B66: campaignId=${campaignId} \u5DF2\u4F7F\u7528 ${budgetPercentage}%`);
        }
      }
      /**
       * 根据advertiser_id和marketplace_id查找账户
       * 
       * 多租户路由逻辑:
       * 1. 将marketplace_id转换为国家代码
       * 2. 在数据库中查找匹配的账户
       */
      async findAccountByAdvertiserId(advertiserId, marketplaceId) {
        try {
          const accounts = await getAdAccounts();
          const country = this.marketplaceIdToCountry[marketplaceId];
          let account = accounts.find((a) => a.profileId === advertiserId);
          if (!account) {
            account = accounts.find((a) => a.accountId === advertiserId);
          }
          if (!account && country) {
            account = accounts.find((a) => a.marketplace === country);
          }
          if (account) {
            log81.debug(`[SQS Consumer] \u627E\u5230\u5339\u914D\u8D26\u6237: id=${account.id}, marketplace=${account.marketplace}, profileId=${account.profileId}`);
          } else {
            log81.warn(`[SQS Consumer] \u672A\u627E\u5230\u5339\u914D\u8D26\u6237: advertiserId=${advertiserId}, country=${country}`);
          }
          return account ? { id: account.id } : null;
        } catch (error48) {
          log81.warn(`[SQS Consumer] \u67E5\u627E\u8D26\u6237\u5931\u8D25:`, error48.message);
          return null;
        }
      }
      /**
       * 获取所有消费者状态
       */
      getStatus() {
        return Array.from(this.consumerStatuses.values());
      }
      /**
       * 获取队列统计信息
       */
      async getQueueStats() {
        const stats4 = [];
        for (const queue of this.queues) {
          try {
            const command = new import_client_sqs.GetQueueAttributesCommand({
              QueueUrl: queue.url,
              AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"]
            });
            const response = await this.sqsClient.send(command);
            stats4.push({
              name: queue.name,
              adType: queue.adType,
              dataType: queue.dataType,
              messagesAvailable: parseInt(response.Attributes?.ApproximateNumberOfMessages || "0"),
              messagesInFlight: parseInt(response.Attributes?.ApproximateNumberOfMessagesNotVisible || "0")
            });
          } catch (error48) {
            log81.warn(`[SQS Consumer] \u83B7\u53D6\u961F\u5217 ${queue.name} \u7EDF\u8BA1\u5931\u8D25:`, error48.message);
            stats4.push({
              name: queue.name,
              adType: queue.adType,
              dataType: queue.dataType,
              messagesAvailable: -1,
              messagesInFlight: -1
            });
          }
        }
        return stats4;
      }
      /**
       * 获取已配置的队列数量
       */
      getQueueCount() {
        return this.queues.length;
      }
      /**
       * 检查消费者是否正在运行
       */
      isConsumerRunning() {
        return this.isRunning;
      }
      // ==================== v183: 交叉维度数据写入 ====================
      /**
       * 将AMS的placement类型映射到我们的枚举值
       * AMS使用: TOP_OF_SEARCH, DETAIL_PAGE, OTHER
       * 我们使用: top_of_search, product_page, rest_of_search
       */
      mapPlacementType(amsPlacement) {
        if (!amsPlacement) return "rest_of_search";
        const upper = amsPlacement.toUpperCase();
        if (upper === "TOP_OF_SEARCH" || upper.includes("TOP")) return "top_of_search";
        if (upper === "DETAIL_PAGE" || upper.includes("DETAIL") || upper.includes("PRODUCT")) return "product_page";
        return "rest_of_search";
      }
      /**
       * 写入或更新交叉维度绩效数据
       * 使用覆盖写入逻辑（与AMS的快照模式一致）
       */
      async upsertKeywordPlacementHourlyData(params) {
        const { keywordPlacementHourlyPerformance: keywordPlacementHourlyPerformance2 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
        const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const { eq: eq12, and: and14, sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        const dbConn = await getDb3();
        if (!dbConn) return;
        let hour2 = 0;
        if (params.eventHour) {
          const match = params.eventHour.match(/T(\d{2})/);
          if (match) hour2 = parseInt(match[1]);
        }
        const dateObj = /* @__PURE__ */ new Date(params.date + "T00:00:00");
        const dayOfWeek = dateObj.getDay();
        let localKeywordId = null;
        let localTargetId = null;
        let localAdGroupId = null;
        const dbModule = await Promise.resolve().then(() => (init_db2(), db_exports));
        if (params.amazonKeywordId) {
          try {
            const result = await dbConn.select({ id: (await Promise.resolve().then(() => (init_schema2(), schema_exports))).keywords.id }).from((await Promise.resolve().then(() => (init_schema2(), schema_exports))).keywords).where(eq12((await Promise.resolve().then(() => (init_schema2(), schema_exports))).keywords.keywordId, params.amazonKeywordId)).limit(1);
            if (result[0]) localKeywordId = result[0].id;
          } catch (e) {
            log81.debug(`\u5173\u952E\u8BCDID\u6620\u5C04\u5931\u8D25: ${e.message}`);
          }
        }
        if (params.amazonTargetId) {
          try {
            const result = await dbConn.select({ id: (await Promise.resolve().then(() => (init_schema2(), schema_exports))).productTargets.id }).from((await Promise.resolve().then(() => (init_schema2(), schema_exports))).productTargets).where(eq12((await Promise.resolve().then(() => (init_schema2(), schema_exports))).productTargets.targetId, params.amazonTargetId)).limit(1);
            if (result[0]) localTargetId = result[0].id;
          } catch (e) {
            log81.debug(`\u76EE\u6807ID\u6620\u5C04\u5931\u8D25: ${e.message}`);
          }
        }
        if (!localKeywordId && !localTargetId) {
          return;
        }
        const existing = await dbConn.select().from(keywordPlacementHourlyPerformance2).where(and14(
          eq12(keywordPlacementHourlyPerformance2.accountId, params.accountId),
          eq12(keywordPlacementHourlyPerformance2.campaignId, params.campaignId),
          localKeywordId ? eq12(keywordPlacementHourlyPerformance2.keywordId, localKeywordId) : sql15`${keywordPlacementHourlyPerformance2.keywordId} IS NULL`,
          localTargetId ? eq12(keywordPlacementHourlyPerformance2.targetId, localTargetId) : sql15`${keywordPlacementHourlyPerformance2.targetId} IS NULL`,
          eq12(keywordPlacementHourlyPerformance2.placement, params.placement),
          eq12(keywordPlacementHourlyPerformance2.date, params.date),
          eq12(keywordPlacementHourlyPerformance2.hour, hour2)
        )).limit(1);
        if (existing.length > 0) {
          const updateData = {};
          if (params.dataType === "traffic") {
            updateData.impressions = params.impressions;
            updateData.clicks = params.clicks;
            updateData.spend = String(params.spend);
          } else {
            updateData.sales = String(params.sales);
            updateData.orders = params.orders;
          }
          const row = existing[0];
          const totalSpend = params.dataType === "traffic" ? params.spend : parseFloat(String(row.spend || "0"));
          const totalSales = params.dataType === "conversion" ? params.sales : parseFloat(String(row.sales || "0"));
          const totalClicks = params.dataType === "traffic" ? params.clicks : row.clicks || 0;
          const totalOrders = params.dataType === "conversion" ? params.orders : row.orders || 0;
          if (totalSpend > 0 && totalSales > 0) {
            updateData.acos = String((totalSpend / totalSales * 100).toFixed(4));
            updateData.roas = String((totalSales / totalSpend).toFixed(2));
          }
          if (totalClicks > 0) {
            updateData.ctr = String(((row.impressions || 0) > 0 ? totalClicks / (row.impressions || 1) : 0).toFixed(6));
            updateData.cvr = String((totalOrders / totalClicks).toFixed(6));
            updateData.cpc = String((totalSpend / totalClicks).toFixed(4));
          }
          await dbConn.update(keywordPlacementHourlyPerformance2).set(updateData).where(eq12(keywordPlacementHourlyPerformance2.id, existing[0].id));
        } else {
          await dbConn.insert(keywordPlacementHourlyPerformance2).values({
            accountId: params.accountId,
            campaignId: params.campaignId,
            internalAdGroupId: localAdGroupId,
            // v418: ID体系重构
            keywordId: localKeywordId,
            targetId: localTargetId,
            placement: params.placement,
            date: params.date,
            hour: hour2,
            dayOfWeek,
            impressions: params.impressions,
            clicks: params.clicks,
            spend: String(params.spend),
            sales: String(params.sales),
            orders: params.orders,
            dataSource: "ams"
          });
        }
      }
    };
    sqsConsumerInstance = null;
    __name(getSQSConsumer, "getSQSConsumer");
    __name(startSQSConsumer, "startSQSConsumer");
    __name(stopSQSConsumer, "stopSQSConsumer");
  }
});

