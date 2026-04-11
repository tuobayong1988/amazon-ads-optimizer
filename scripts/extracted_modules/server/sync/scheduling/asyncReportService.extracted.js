// Extracted from production dist/index.js
// Original module: server/sync/scheduling/asyncReportService.ts
// Lines: 735

var log83, REPORT_CONFIG, SLICE_CONFIG, AsyncReportService, asyncReportService;
var init_asyncReportService = __esm({
  "server/sync/scheduling/asyncReportService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_amazonAdsApi();
    init_logger();
    log83 = createModuleLogger("AsyncReport");
    REPORT_CONFIG = {
      SP: {
        attributionDays: 14,
        reportType: "spCampaigns",
        adProduct: "SPONSORED_PRODUCTS"
      },
      SB: {
        attributionDays: 30,
        reportType: "sbCampaigns",
        adProduct: "SPONSORED_BRANDS"
      },
      SD: {
        attributionDays: 30,
        reportType: "sdCampaigns",
        adProduct: "SPONSORED_DISPLAY"
      }
    };
    SLICE_CONFIG = {
      hotData: {
        days: 90,
        sliceSize: 3
        // 3天一个切片（降低单个任务数据量）
      },
      coldData: {
        startDay: 91,
        endDay: 365,
        sliceSize: 14
        // 14天一个切片（降低单个任务数据量）
      }
    };
    AsyncReportService = class {
      static {
        __name(this, "AsyncReportService");
      }
      apiClient = null;
      /**
       * 初始化API客户端
       */
      async initApiClient(accountId) {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const [credentials] = await db.select().from(amazonApiCredentials).where(eq(amazonApiCredentials.accountId, accountId)).limit(1);
        if (!credentials) {
          throw new Error(`No API credentials found for account ${accountId}`);
        }
        const { safeDecrypt: safeDecrypt2 } = await Promise.resolve().then(() => (init_cryptoService(), cryptoService_exports));
        const decryptedCreds = {
          ...credentials,
          clientSecret: safeDecrypt2(credentials.clientSecret),
          refreshToken: safeDecrypt2(credentials.refreshToken)
        };
        return new AmazonAdsApiClient(decryptedCreds);
      }
      /**
       * 生成日期切片
       */
      generateDateSlices(totalDays, sliceSize, startOffset = 1) {
        const slices = [];
        const now = /* @__PURE__ */ new Date();
        for (let i = startOffset; i <= totalDays; i += sliceSize) {
          const endOffset = i;
          const sliceStartOffset = Math.min(i + sliceSize - 1, totalDays);
          const endDate = new Date(now);
          endDate.setDate(endDate.getDate() - endOffset);
          const startDate = new Date(now);
          startDate.setDate(startDate.getDate() - sliceStartOffset);
          slices.push({
            startDate: startDate.toISOString().split("T")[0],
            endDate: endDate.toISOString().split("T")[0]
          });
        }
        return slices;
      }
      /**
       * 创建报告任务
       */
      async createReportJob(input) {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const config2 = REPORT_CONFIG[input.adType];
        const [result] = await db.insert(reportJobs).values({
          accountId: input.accountId,
          profileId: input.profileId,
          reportType: config2.reportType,
          adProduct: config2.adProduct,
          status: "pending",
          startDate: input.startDate,
          endDate: input.endDate,
          requestPayload: JSON.stringify({
            adType: input.adType,
            startDate: input.startDate,
            endDate: input.endDate
          }),
          retryCount: 0,
          maxRetries: 3
        });
        return result.insertId;
      }
      /**
       * 创建报告任务（扩展版，用于初始化服务）
       */
      async createReportJobExtended(input) {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const [result] = await db.insert(reportJobs).values({
          accountId: input.accountId,
          profileId: input.profileId,
          reportType: input.reportType,
          adProduct: input.adProduct,
          status: "pending",
          startDate: input.startDate,
          endDate: input.endDate,
          requestPayload: JSON.stringify({
            reportType: input.reportType,
            adProduct: input.adProduct,
            startDate: input.startDate,
            endDate: input.endDate,
            priority: input.priority || "low",
            metadata: input.metadata || {}
          }),
          retryCount: 0,
          maxRetries: 3
        });
        return result.insertId;
      }
      /**
       * 批量创建报告任务（用于新店铺初始化）
       */
      async createInitializationJobs(accountId, profileId) {
        const jobIds = [];
        for (const adType of ["SP", "SB", "SD"]) {
          const hotSlices = this.generateDateSlices(
            SLICE_CONFIG.hotData.days,
            SLICE_CONFIG.hotData.sliceSize
          );
          for (const slice of hotSlices) {
            const jobId = await this.createReportJob({
              accountId,
              profileId,
              adType,
              startDate: slice.startDate,
              endDate: slice.endDate
            });
            jobIds.push(jobId);
          }
          const coldSlices = this.generateDateSlices(
            SLICE_CONFIG.coldData.endDay,
            SLICE_CONFIG.coldData.sliceSize,
            SLICE_CONFIG.coldData.startDay
          );
          for (const slice of coldSlices) {
            const jobId = await this.createReportJob({
              accountId,
              profileId,
              adType,
              startDate: slice.startDate,
              endDate: slice.endDate
            });
            jobIds.push(jobId);
          }
        }
        log83.info(`[AsyncReportService v587] Created ${jobIds.length} initialization jobs for account ${accountId} (P2异步报告管道)`);
        return jobIds;
      }
      /**
       * 创建归因回溯任务（每日运行）
       */
      async createAttributionJobs(accountId, profileId) {
        const jobIds = [];
        for (const adType of ["SP", "SB", "SD"]) {
          const config2 = REPORT_CONFIG[adType];
          const slices = this.generateDateSlices(config2.attributionDays, 7);
          for (const slice of slices) {
            const jobId = await this.createReportJob({
              accountId,
              profileId,
              adType,
              startDate: slice.startDate,
              endDate: slice.endDate
            });
            jobIds.push(jobId);
          }
        }
        log83.debug(`[AsyncReportService] Created ${jobIds.length} attribution jobs for account ${accountId}`);
        return jobIds;
      }
      /**
       * 提交待处理的报告任务
       */
      async submitPendingJobs(limit = 10) {
        const db = await getDb();
        if (!db) {
          log83.info("[AsyncReportService v587] Database not available, skipping submit (P2异步管道)");
          return 0;
        }
        const pendingJobs = await db.select().from(reportJobs).where(eq(reportJobs.status, "pending")).orderBy(reportJobs.createdAt).limit(limit);
        let submittedCount = 0;
        for (const job of pendingJobs) {
          try {
            const apiClient = await this.initApiClient(job.accountId);
            // P5c: Use job.profileId if available, otherwise keep the profileId from credentials
            if (job.profileId && job.profileId.length > 0) {
              apiClient.setProfileId(job.profileId);
            } else {
              log83.debug(`[AsyncReportService] P5c: Job ${job.id} has empty profileId, using credentials default: ${apiClient.getProfileId()}`);
            }
            let reportId;
            let payload = {};
            if (job.requestPayload) {
              if (typeof job.requestPayload === "string") {
                try {
                  payload = JSON.parse(job.requestPayload);
                } catch (e) {
                  log83.warn(`[AsyncReportService] Failed to parse requestPayload for job ${job.id}, using adProduct`);
                }
              } else if (typeof job.requestPayload === "object") {
                payload = job.requestPayload;
              }
            }
            const rawAdType = payload.adType || job.adProduct || "";
            const adTypeMap = {
              "SP": "SP",
              "SB": "SB",
              "SD": "SD",
              "SPONSORED_PRODUCTS": "SP",
              "SPONSORED_BRANDS": "SB",
              "SPONSORED_DISPLAY": "SD"
            };
            const adType = adTypeMap[rawAdType?.toUpperCase?.() || ""];
            if (!adType) {
              throw new Error(`Unknown ad type: ${rawAdType} (reportType: ${job.reportType})`);
            }
            const reportType = payload.reportType || job.reportType || "";
            switch (reportType) {
              // SP 类型
              case "spCampaigns":
                reportId = await apiClient.requestSpCampaignReport(job.startDate, job.endDate);
                break;
              case "spKeywords":
                reportId = await apiClient.requestSpKeywordReport(job.startDate, job.endDate);
                break;
              case "spAdGroups":
                reportId = await apiClient.requestSpAdGroupReport(job.startDate, job.endDate);
                break;
              case "spTargets":
                reportId = await apiClient.requestSpAutoTargetingReport(job.startDate, job.endDate);
                break;
              case "spSearchTerms":
                reportId = await apiClient.requestSpSearchTermReport(job.startDate, job.endDate);
                break;
              // SB 类型
              case "sbCampaigns":
                reportId = await apiClient.requestSbCampaignReport(job.startDate, job.endDate);
                break;
              case "sbKeywords":
                reportId = await apiClient.requestSbTargetingReport(job.startDate, job.endDate);
                break;
              case "sbAdGroups":
                reportId = await apiClient.requestSbAdGroupReport(job.startDate, job.endDate);
                break;
              case "sbTargets":
                reportId = await apiClient.requestSbTargetingReport(job.startDate, job.endDate);
                break;
              case "sbSearchTerms":
                reportId = await apiClient.requestSbSearchTermReport(job.startDate, job.endDate);
                break;
              // SD 类型
              case "sdCampaigns":
                reportId = await apiClient.requestSdCampaignReport(job.startDate, job.endDate);
                break;
              case "sdAdGroups":
                reportId = await apiClient.requestSdAdGroupReport(job.startDate, job.endDate);
                break;
              case "sdTargets":
                reportId = await apiClient.requestSdTargetingReport(job.startDate, job.endDate);
                break;
              default:
                if (adType === "SP") reportId = await apiClient.requestSpCampaignReport(job.startDate, job.endDate);
                else if (adType === "SB") reportId = await apiClient.requestSbCampaignReport(job.startDate, job.endDate);
                else reportId = await apiClient.requestSdCampaignReport(job.startDate, job.endDate);
                log83.warn(`[AsyncReportService v530] Unknown reportType '${reportType}', fallback to ${adType} campaign report`);
            }
            await db.update(reportJobs).set({
              status: "submitted",
              reportId,
              submittedAt: (/* @__PURE__ */ new Date()).toISOString()
            }).where(eq(reportJobs.id, job.id));
            submittedCount++;
            log83.debug(`[AsyncReportService] Submitted job ${job.id} with reportId ${reportId}`);
          } catch (error48) {
            const errorMessage = error48.message || "Unknown error";
            const statusCode = error48.response?.status || error48.status;
            log83.warn(`[AsyncReportService] Failed to submit job ${job.id}:`, {
              message: errorMessage,
              statusCode,
              accountId: job.accountId,
              profileId: job.profileId
            });
            let newStatus = "pending";
            let shouldRetry = true;
            if (statusCode === 403) {
              newStatus = "failed";
              shouldRetry = false;
              log83.warn(`[AsyncReportService] Job ${job.id} failed with 403 - API authorization issue, marking as failed`);
            } else if (statusCode === 429) {
              log83.warn(`[AsyncReportService] Job ${job.id} hit rate limit, will retry later`);
            } else if (statusCode === 401) {
              log83.warn(`[AsyncReportService] Job ${job.id} token expired, will retry with refreshed token`);
            } else if (statusCode >= 500) {
              log83.warn(`[AsyncReportService] Job ${job.id} server error, will retry`);
            }
            const newRetryCount = (job.retryCount || 0) + 1;
            if (shouldRetry && newRetryCount >= (job.maxRetries || 3)) {
              newStatus = "failed";
            }
            await db.update(reportJobs).set({
              retryCount: newRetryCount,
              status: newStatus,
              errorMessage: `[${statusCode || "N/A"}] ${errorMessage}`
            }).where(eq(reportJobs.id, job.id));
          }
        }
        return submittedCount;
      }
      /**
       * 检查已提交报告的状态
       */
      async checkSubmittedJobs(limit = 20) {
        const db = await getDb();
        if (!db) {
          log83.info("[AsyncReportService] Database not available, skipping check");
          return { completed: 0, failed: 0, pending: 0 };
        }
        const submittedJobs = await db.select().from(reportJobs).where(
          or(
            eq(reportJobs.status, "submitted"),
            eq(reportJobs.status, "processing")
          )
        ).orderBy(reportJobs.submittedAt).limit(limit);
        let completed = 0;
        let failed = 0;
        let pending = 0;
        for (const job of submittedJobs) {
          if (!job.reportId) {
            // v595: Jobs without reportId should be reset to pending for resubmission
            try {
              await db.update(reportJobs).set({
                status: "pending",
                retryCount: (job.retryCount || 0) + 1
              }).where(eq(reportJobs.id, job.id));
              log83.debug(`[AsyncReportService] v595: Job ${job.id} has no reportId, reset to pending for resubmission`);
            } catch (resetErr) {
              log83.warn(`[AsyncReportService] v595: Failed to reset job ${job.id}: ${resetErr.message}`);
            }
            continue;
          }
          // P3v10: Auto-expire jobs submitted more than 24 hours ago
          if (job.submittedAt) {
            const submittedTime = new Date(job.submittedAt).getTime();
            const now = Date.now();
            const hoursSinceSubmit = (now - submittedTime) / (1000 * 60 * 60);
            if (hoursSinceSubmit > 2) {
              try {
                await db.update(reportJobs).set({ status: "expired", errorMessage: "P3v10: Auto-expired after 2h" }).where(eq(reportJobs.id, job.id));
                log83.debug(`[AsyncReportService] P3v10: Job ${job.id} auto-expired (submitted ${hoursSinceSubmit.toFixed(1)}h ago)`);
              } catch (_expErr) {}
              failed++;
              continue;
            }
          }
          try {
            const apiClient = await this.initApiClient(job.accountId);
            // P5c: Use job.profileId if available, otherwise keep the profileId from credentials
            if (job.profileId && job.profileId.length > 0) {
              apiClient.setProfileId(job.profileId);
            } else {
              log83.debug(`[AsyncReportService] P5c: Job ${job.id} has empty profileId, using credentials default: ${apiClient.getProfileId()}`);
            }
            // v596: Redis缓存报告状态，避免重复查询Amazon API
            let status;
            try {
              const { getRedis: _rds4, isRedisAvailable: _rdsOk4 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
              if (_rdsOk4() && _rds4()) {
                const cachedStatus = await _rds4().get(`report:status:${job.reportId}`);
                if (cachedStatus) {
                  status = JSON.parse(cachedStatus);
                  log83.debug(`[AsyncReportService] v596: 使用Redis缓存的报告状态: ${job.reportId} = ${status.status}`);
                }
              }
            } catch(_cacheErr) {}
            if (!status) {
              status = await apiClient.getReportStatus(job.reportId);
              // v596: 缓存非终态的报告状态到Redis (TTL 60秒)
              try {
                const { getRedis: _rds5, isRedisAvailable: _rdsOk5 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
                if (_rdsOk5() && _rds5()) {
                  const ttl = status.status === "COMPLETED" || status.status === "FAILED" ? 300 : 60;
                  await _rds5().set(`report:status:${job.reportId}`, JSON.stringify(status), "EX", ttl);
                }
              } catch(_cacheErr2) {}
            }
            if (status.status === "COMPLETED") {
              await db.update(reportJobs).set({
                status: "completed",
                downloadUrl: status.url,
                completedAt: (/* @__PURE__ */ new Date()).toISOString()
              }).where(eq(reportJobs.id, job.id));
              completed++;
              log83.debug(`[AsyncReportService] v596: Job ${job.id} completed, URL: ${status.url?.substring(0, 50)}...`);
              // v596: 发布Redis事件通知处理器立即处理
              try {
                const { getRedis: _rds6, isRedisAvailable: _rdsOk6 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
                if (_rdsOk6() && _rds6()) {
                  await _rds6().publish("report:jobs:completed", JSON.stringify({ jobId: job.id, accountId: job.accountId })).catch(() => {});
                }
              } catch(_pubErr) {}
            } else if (status.status === "FAILED") {
              await db.update(reportJobs).set({
                status: "failed",
                errorMessage: status.failureReason || "Report generation failed"
              }).where(eq(reportJobs.id, job.id));
              failed++;
              log83.warn(`[AsyncReportService] Job ${job.id} failed: ${status.failureReason}`);
            } else {
              await db.update(reportJobs).set({ status: "processing" }).where(eq(reportJobs.id, job.id));
              pending++;
            }
          } catch (error48) {
            const errBody = error48?.response?.data ? JSON.stringify(error48.response.data).slice(0, 300) : '';
            const errStatus = error48?.response?.status || '';
            log83.warn(`[AsyncReportService] Error checking job ${job.id}: status=${errStatus} ${error48?.message || error48?.code || 'unknown'} ${errBody}`);
            failed++;
          }
        }
        return { completed, failed, pending };
      }
      /**
       * 下载并处理完成的报告
       */
      async processCompletedJobs(limit = 5) {
        const db = await getDb();
        if (!db) {
          log83.info("[AsyncReportService] Database not available, skipping process");
          return 0;
        }
        const completedJobs = await db.select().from(reportJobs).where(
          and(
            eq(reportJobs.status, "completed"),
            isNull(reportJobs.processedAt)
          )
        ).orderBy(reportJobs.completedAt).limit(limit);
        let processedCount = 0;
        for (const job of completedJobs) {
          if (!job.downloadUrl) {
            continue;
          }
          try {
            const apiClient = await this.initApiClient(job.accountId);
            const reportData = await apiClient.downloadReport(job.downloadUrl);
            if (!reportData || reportData.length === 0) {
              log83.debug(`[AsyncReportService] Job ${job.id} has no data`);
              await db.update(reportJobs).set({
                processedAt: (/* @__PURE__ */ new Date()).toISOString(),
                recordsProcessed: 0
              }).where(eq(reportJobs.id, job.id));
              continue;
            }
            const payload = JSON.parse(job.requestPayload || "{}");
            // P5: Set current job payload for processReportData to detect async queue jobs
            this._currentJobPayload = payload;
            const recordsProcessed = await this.processReportData(
              job.accountId,
              payload.adType || (job.adProduct === "SPONSORED_PRODUCTS" ? "SP" : job.adProduct === "SPONSORED_BRANDS" ? "SB" : "SD"),
              reportData
            );
            this._currentJobPayload = null;
            await db.update(reportJobs).set({
              processedAt: (/* @__PURE__ */ new Date()).toISOString(),
              recordsProcessed
            }).where(eq(reportJobs.id, job.id));
            processedCount++;
            log83.debug(`[AsyncReportService] Job ${job.id} processed ${recordsProcessed} records`);
          } catch (error48) {
            log83.warn(`[AsyncReportService] Error processing job ${job.id}:`, error48.message);
            await db.update(reportJobs).set({
              errorMessage: error48.message
            }).where(eq(reportJobs.id, job.id));
          }
        }
        return processedCount;
      }
      /**
       * 处理报告数据并存储到数据库
       */

      /**
       * P5: Flush a batch of performance data to daily_performance table
       */
      async _flushPerfBatch(db, batch) {
        if (!batch || batch.length === 0) return 0;
        let count = 0;
        const { dailyPerformance: _dp } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
        for (const row of batch) {
          try {
            await db.insert(_dp).values({
              accountId: row.accountId,
              campaignId: row.campaignId,
              amazonCampaignId: String(row.amazonCampaignId),
              date: row.date,
              adType: row.adType,
              impressions: row.impressions,
              clicks: row.clicks,
              spend: String(row.spend),
              sales: String(row.sales),
              orders: row.orders,
              dataSource: row.dataSource
            }).onDuplicateKeyUpdate({
              set: {
                impressions: row.impressions,
                clicks: row.clicks,
                spend: String(row.spend),
                sales: String(row.sales),
                orders: row.orders,
                dataSource: row.dataSource
              }
            });
            count++;
          } catch (upsertErr) {
            // Ignore duplicate key errors
            if (!upsertErr.message?.includes("Duplicate")) {
              log83.debug(`[P5:FlushBatch] Upsert error: ${upsertErr.message?.substring(0, 100)}`);
            }
            count++; // Count as processed even if duplicate
          }
        }
        return count;
      }

      async processReportData(accountId, adType, data) {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        let processedCount = 0;
        
        // P5: Check if this is a performance report from async queue
        const payload = this._currentJobPayload || {};
        if (payload.syncType === "performance" || payload.source === "P5_async_queue") {
          log83.info(`[P5:AsyncProcess] Processing performance report: accountId=${accountId}, adType=${adType}, records=${data.length}`);
          try {
            // P5: Use the SyncService's processReportData for proper campaign matching
            const { AmazonSyncService: _SyncSvc } = await Promise.resolve().then(() => (init_syncService ? (init_syncService(), syncService_exports) : {}));
            // Fallback: process inline with campaign matching
            const { campaigns: _camps } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
            const allCampaigns = await db.select().from(_camps).where(eq(_camps.accountId, accountId));
            const campaignByIdMap = new Map();
            for (const c of allCampaigns) {
              campaignByIdMap.set(String(c.campaignId), c);
            }
            
            const batchSize = 500;
            const perfBatch = [];
            for (const row of data) {
              const date6 = row.date;
              const campaignId = row.campaignId;
              if (!date6 || !campaignId) continue;
              
              const campaign = campaignByIdMap.get(String(campaignId));
              perfBatch.push({
                accountId,
                campaignId: campaign?.id || null,
                amazonCampaignId: campaignId,
                date: date6,
                adType: adType || "SP",
                impressions: parseInt(row.impressions) || 0,
                clicks: parseInt(row.clicks) || 0,
                spend: parseFloat(row.cost || row.spend) || 0,
                sales: parseFloat(row.sales14d || row.attributedSales14d || row.sales7d || row.sales) || 0,
                orders: parseInt(row.purchases14d || row.attributedConversions14d || row.purchases7d || row.orders) || 0,
                dataSource: "api_async"
              });
              
              if (perfBatch.length >= batchSize) {
                processedCount += await this._flushPerfBatch(db, perfBatch);
                perfBatch.length = 0;
              }
            }
            if (perfBatch.length > 0) {
              processedCount += await this._flushPerfBatch(db, perfBatch);
            }
            log83.info(`[P5:AsyncProcess] Performance data processed: ${processedCount} records for account ${accountId}`);
            return processedCount;
          } catch (perfErr) {
            log83.warn(`[P5:AsyncProcess] Performance processing error: ${perfErr.message}, falling back to default`);
            // Fall through to default processing below
          }
        }
        
        for (const row of data) {
          try {
            const date6 = row.date;
            const campaignId = row.campaignId;
            if (!date6 || !campaignId) {
              continue;
            }
            const [campaign] = await db.select().from(campaigns).where(
              and(
                eq(campaigns.accountId, accountId),
                eq(campaigns.campaignId, campaignId)
              )
            ).limit(1);
            const internalCampaignId = campaign?.id;
            const performanceData = {
              accountId,
              campaignId: internalCampaignId || null,
              amazonCampaignId: campaignId,
              // @ts-ignore
              date: date6,
              // @ts-ignore
              adType,
              // @ts-ignore
              impressions: parseInt(row.impressions) || 0,
              // @ts-ignore
              clicks: parseInt(row.clicks) || 0,
              // @ts-ignore
              spend: parseFloat(row.cost || row.spend) || 0,
              // @ts-ignore
              sales: parseFloat(row.sales14d || row.attributedSales14d || row.sales7d || row.attributedSales7d || row.sales) || 0,
              // @ts-ignore
              orders: parseInt(row.purchases14d || row.attributedConversions14d || row.purchases7d || row.attributedConversions7d || row.orders) || 0,
              dataSource: "api"
            };
            const existingRecord = await db.select().from(amsPerformanceData).where(
              and(
                eq(amsPerformanceData.accountId, accountId),
                eq(amsPerformanceData.campaignId, String(campaignId)),
                eq(amsPerformanceData.reportDate, date6)
              )
            ).limit(1);
            if (existingRecord.length > 0) {
              await db.update(amsPerformanceData).set({
                impressions: performanceData.impressions,
                clicks: performanceData.clicks,
                spend: performanceData.spend.toString(),
                sales: performanceData.sales.toString(),
                orders: performanceData.orders,
                dataSource: "api"
              }).where(eq(amsPerformanceData.id, existingRecord[0].id));
            } else {
              await db.insert(amsPerformanceData).values({
                accountId: performanceData.accountId,
                campaignId,
                // 使用Amazon Campaign ID
                reportDate: performanceData.date,
                dataSetId: `api-${adType.toLowerCase()}`,
                // 标识数据来源
                impressions: performanceData.impressions,
                clicks: performanceData.clicks,
                spend: performanceData.spend.toString(),
                sales: performanceData.sales.toString(),
                orders: performanceData.orders,
                dataSource: "api"
              });
            }
            if (campaign) {
              await db.update(campaigns).set({
                impressions: sql`${campaigns.impressions} + ${performanceData.impressions}`,
                clicks: sql`${campaigns.clicks} + ${performanceData.clicks}`,
                spend: sql`${campaigns.spend} + ${performanceData.spend}`,
                sales: sql`${campaigns.sales} + ${performanceData.sales}`,
                orders: sql`${campaigns.orders} + ${performanceData.orders}`
              }).where(eq(campaigns.id, campaign.id));
            }
            processedCount++;
          } catch (error48) {
            log83.warn(`[AsyncReportService] Error processing row:`, error48.message);
          }
        }
        return processedCount;
      }
      /**
       * 获取任务统计
       */
      async getJobStats() {
        const db = await getDb();
        if (!db) {
          return { pending: 0, submitted: 0, processing: 0, completed: 0, failed: 0 };
        }
        const stats4 = await db.select({
          status: reportJobs.status,
          count: sql`count(*)`
        }).from(reportJobs).groupBy(reportJobs.status);
        const result = {
          pending: 0,
          submitted: 0,
          processing: 0,
          completed: 0,
          failed: 0
        };
        for (const stat of stats4) {
          if (stat.status in result) {
            result[stat.status] = Number(stat.count);
          }
        }
        return result;
      }
      /**
       * 清理过期任务
       */
      async cleanupExpiredJobs(daysOld = 7) {
        const db = await getDb();
        if (!db) return 0;
        const cutoffDate = /* @__PURE__ */ new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);
        const result = await db.delete(reportJobs).where(
          and(
            inArray(reportJobs.status, ["completed", "failed", "expired"]),
            sql`${reportJobs.createdAt} < ${cutoffDate.toISOString()}`
          )
        );
        return result.rowsAffected || 0;
      }
    };
    asyncReportService = new AsyncReportService();
  }
});

