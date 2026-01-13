/**
 * SQS消费者服务测试
 * 验证SQS队列连接和消息处理功能
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

describe('SQS Consumer Service', () => {
  let sqsClient: SQSClient;
  
  beforeAll(() => {
    sqsClient = new SQSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  });

  afterAll(() => {
    sqsClient.destroy();
  });

  describe('Queue Configuration', () => {
    it('should have at least one SQS queue URL configured', () => {
      const trafficUrl = process.env.AWS_SQS_QUEUE_TRAFFIC_URL;
      const conversionUrl = process.env.AWS_SQS_QUEUE_CONVERSION_URL;
      const budgetUrl = process.env.AWS_SQS_QUEUE_BUDGET_URL;
      
      const hasAtLeastOneQueue = !!(trafficUrl || conversionUrl || budgetUrl);
      expect(hasAtLeastOneQueue).toBe(true);
    });

    it('should have valid AWS credentials configured', () => {
      expect(process.env.AWS_ACCESS_KEY_ID).toBeDefined();
      expect(process.env.AWS_ACCESS_KEY_ID?.length).toBeGreaterThan(0);
      expect(process.env.AWS_SECRET_ACCESS_KEY).toBeDefined();
      expect(process.env.AWS_SECRET_ACCESS_KEY?.length).toBeGreaterThan(0);
    });
  });

  describe('Queue Connectivity', () => {
    it('should connect to traffic queue and get attributes', async () => {
      const queueUrl = process.env.AWS_SQS_QUEUE_TRAFFIC_URL;
      if (!queueUrl) {
        console.log('Traffic queue URL not configured, skipping test');
        return;
      }

      const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      });

      const response = await sqsClient.send(command);
      
      expect(response.Attributes).toBeDefined();
      console.log('Traffic queue stats:', {
        messagesAvailable: response.Attributes?.ApproximateNumberOfMessages,
        messagesInFlight: response.Attributes?.ApproximateNumberOfMessagesNotVisible,
      });
    });

    it('should connect to conversion queue and get attributes', async () => {
      const queueUrl = process.env.AWS_SQS_QUEUE_CONVERSION_URL;
      if (!queueUrl) {
        console.log('Conversion queue URL not configured, skipping test');
        return;
      }

      const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      });

      const response = await sqsClient.send(command);
      
      expect(response.Attributes).toBeDefined();
      console.log('Conversion queue stats:', {
        messagesAvailable: response.Attributes?.ApproximateNumberOfMessages,
        messagesInFlight: response.Attributes?.ApproximateNumberOfMessagesNotVisible,
      });
    });

    it('should connect to budget queue and get attributes', async () => {
      const queueUrl = process.env.AWS_SQS_QUEUE_BUDGET_URL;
      if (!queueUrl) {
        console.log('Budget queue URL not configured, skipping test');
        return;
      }

      const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      });

      const response = await sqsClient.send(command);
      
      expect(response.Attributes).toBeDefined();
      console.log('Budget queue stats:', {
        messagesAvailable: response.Attributes?.ApproximateNumberOfMessages,
        messagesInFlight: response.Attributes?.ApproximateNumberOfMessagesNotVisible,
      });
    });
  });
});
