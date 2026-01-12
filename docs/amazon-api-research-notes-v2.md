# Amazon Ads API 文档研究笔记

## 研究目标
获取广告活动的创建日期(startDate)信息

## 发现的资源

### 1. Amazon Ads API Postman Collection
- 位置: https://github.com/amzn/ads-advanced-tools-docs/tree/main/postman
- 支持的功能:
  - Authentication
  - GET profiles
  - GET manager accounts
  - Sponsored Products campaign management (version 3)
  - Sponsored Brands campaign management (version 4)
  - Sponsored ads reporting (v2 & v3)
  - DSP reporting
  - Sponsored ads snapshots
  - Test accounts
  - Amazon Marketing Stream
  - Amazon Marketing Cloud
  - Product metadata
  - Sponsored ads budget usage
  - Sponsored ads budget rules
  - Sponsored Brands campaigns, ads, and ad groups
  - Creative asset library
  - Stores
  - Locations
  - Sponsored Display
  - Sponsored TV
  - Exports
  - Partner opportunities

### 2. 待研究的API端点
- SP Campaign List API: POST /sp/campaigns/list
- SP Campaign Extended API: 需要确认是否存在
- SD Campaign Extended API: GET /sd/campaigns/extended (已知支持creationDate)
- SB Campaign List API: POST /sb/v4/campaigns/list

## 下一步
1. 下载Postman Collection查看具体的API请求格式
2. 研究SP Campaign API的响应字段
3. 研究Report API v3的可用列
