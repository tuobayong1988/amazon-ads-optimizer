// Extracted from production dist/index.js
// Original module: server/sync/syncPerformance.ts
// Lines: 1676

async function flushDailyPerfBatch(db, batch, currencyBatch) {
  if (batch.length === 0) return;
  const enrichedBatch = batch.map((row, i) => {
    const cur = currencyBatch[i];
    return {
      // @ts-ignore
      ...row,
      // @ts-ignore
      currency: cur?.currency || null,
      exchangeRate: cur?.exchangeRate ? String(cur.exchangeRate) : null,
      spendUsd: cur?.spendUsd || null,
      salesUsd: cur?.salesUsd || null
    };
  });
  await db.insert(dailyPerformance).values(enrichedBatch).onDuplicateKeyUpdate({
    set: {
      impressions: sql`VALUES(${dailyPerformance.impressions})`,
      clicks: sql`VALUES(${dailyPerformance.clicks})`,
      spend: sql`VALUES(${dailyPerformance.spend})`,
      sales: sql`VALUES(${dailyPerformance.sales})`,
      orders: sql`VALUES(${dailyPerformance.orders})`,
      dailyAcos: sql`VALUES(${dailyPerformance.dailyAcos})`,
      dailyRoas: sql`VALUES(${dailyPerformance.dailyRoas})`,
      ctr: sql`VALUES(${dailyPerformance.ctr})`,
      cvr: sql`VALUES(${dailyPerformance.cvr})`,
      cpc: sql`VALUES(${dailyPerformance.cpc})`,
      unitsSold: sql`VALUES(${dailyPerformance.unitsSold})`,
      dpv: sql`VALUES(${dailyPerformance.dpv})`,
      addToCart: sql`VALUES(${dailyPerformance.addToCart})`,
      ntbOrders: sql`VALUES(${dailyPerformance.ntbOrders})`,
      ntbSales: sql`VALUES(${dailyPerformance.ntbSales})`,
      viewableImpressions: sql`VALUES(${dailyPerformance.viewableImpressions})`,
      attributionWindow: sql`VALUES(${dailyPerformance.attributionWindow})`,
      isFinalized: sql`VALUES(${dailyPerformance.isFinalized})`,
      dataSource: sql`VALUES(${dailyPerformance.dataSource})`,
      // v383: 货币字段合并到主UPSERT，消除N+1
      // @ts-ignore
      currency: sql`VALUES(${dailyPerformance.currency})`,
      exchangeRate: sql`VALUES(${dailyPerformance.exchangeRate})`,
      spendUsd: sql`VALUES(${dailyPerformance.spendUsd})`,
      salesUsd: sql`VALUES(${dailyPerformance.salesUsd})`
    }
  });
}
var log211;
var init_syncPerformance = __esm({
  "server/sync/syncPerformance.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_logger();
    init_timezone();
    init_exchangeRateService();
    init_amazonSyncService();
    init_idTypes();
    log211 = createModuleLogger("syncPerformance");
    AmazonSyncService.prototype.syncPerformanceData = async function(days = 14) {
      // v596: 断点续传 - 检查Redis中是否有上次失败的批次需要重试
      let v596ResumeFailedBatches = null;
      try {
        const { getRedis: _rds11, isRedisAvailable: _rdsOk11 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
        if (_rdsOk11() && _rds11()) {
          const resumeKey = `sync:perf_resume:${this.accountId}`;
          const resumeData = await _rds11().get(resumeKey);
          if (resumeData) {
            const parsed = JSON.parse(resumeData);
            const savedAt = new Date(parsed.savedAt);
            const ageMinutes = (Date.now() - savedAt.getTime()) / 60000;
            if (ageMinutes < 60 && parsed.failedBatches?.length > 0) {
              v596ResumeFailedBatches = parsed.failedBatches;
              log211.info(`[v596] 断点续传: 发现${v596ResumeFailedBatches.length}个上次失败的批次需要重试 (${Math.round(ageMinutes)}分钟前保存)`);
            }
            // 清除已读取的断点数据
            await _rds11().del(resumeKey);
          }
        }
      } catch(_resumeReadErr) {
        log211.debug(`[v596] 读取断点续传数据失败: ${_resumeReadErr.message}`);
      }
      const db = await getDb();
      if (!db) {
        log211.warn('[v358] \u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25 - \u8FD9\u662F\u4E00\u4E2A\u771F\u5B9E\u9519\u8BEF\uFF0C\u4E0D\u662F"0\u6761\u6570\u636E"');
        throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
      }
      try {
        const MAX_DAYS_PER_REQUEST = 31;
        const totalDays = Math.min(days, 90);
        let totalSynced = 0;
        const failedBatches = [];
        const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
        log211.debug(`\u7AD9\u70B9${this.marketplace}\u5F53\u524D\u65E5\u671F: ${getMarketplaceCurrentDate(this.marketplace)}`);
        log211.info(`API\u540C\u6B65\u8303\u56F4: ${rangeStartDate} - ${rangeEndDate} (\u6392\u9664\u4ECA\u5929\uFF0C\u4ECA\u65E5\u6570\u636E\u7531AMS\u63D0\u4F9B)`);
        const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
        log211.info(`\u5F00\u59CB\u540C\u6B65\u7EE9\u6548\u6570\u636E: \u5171${totalDays}\u5929\uFF0C\u5206${batches}\u6279\u8BF7\u6C42 (\u7AD9\u70B9: ${this.marketplace})`);
        // v587: P1 - 大账户增量同步策略
        const isLargeAccountSync = (this._campaignCount || 0) >= 1000;
        if (isLargeAccountSync) {
          log211.info(`[v587] P1大账户增量同步: campaigns=${this._campaignCount}, 启用按天+按广告类型拆分策略`);
        }
        const INCREMENTAL_DAYS_PER_REQUEST = isLargeAccountSync ? 7 : MAX_DAYS_PER_REQUEST;
        const incrementalBatches = Math.ceil(totalDays / INCREMENTAL_DAYS_PER_REQUEST);
        for (let batch = 0; batch < incrementalBatches; batch++) {
          const endDateObj = new Date(rangeEndDate);
          endDateObj.setDate(endDateObj.getDate() - batch * INCREMENTAL_DAYS_PER_REQUEST);
          const startDateObj = new Date(endDateObj);
          const daysInBatch = Math.min(INCREMENTAL_DAYS_PER_REQUEST, totalDays - batch * INCREMENTAL_DAYS_PER_REQUEST);
          startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
          const startDateStr = startDateObj.toISOString().split("T")[0];
          const endDateStr = endDateObj.toISOString().split("T")[0];
          log211.debug(`\u7B2C${batch + 1}/${batches}\u6279: ${startDateStr} - ${endDateStr} (\u5171${daysInBatch}\u5929)`);
          try {
            const batchSynced = await this.syncPerformanceDataBatch(startDateStr, endDateStr);
            totalSynced += batchSynced;
            log211.info(`\u7B2C${batch + 1}\u6279\u540C\u6B65\u5B8C\u6210: ${batchSynced}\u6761\u8BB0\u5F55`);
            if (batch < batches - 1) {
              await new Promise((resolve) => setTimeout(resolve, 2e3));
            }
          } catch (batchError) {
            const errMsg = batchError.message || "";
            if (errMsg.includes("retention") || errMsg.includes("startDate") || errMsg.includes("configuration date")) {
              log211.warn(`[v474] \u7B2C${batch + 1}/${batches}\u6279\u8D85\u51FA\u6570\u636E\u4FDD\u7559\u671F\uFF0C\u8DF3\u8FC7: ${startDateStr}~${endDateStr}`);
            } else {
              log211.warn(`[v358] \u7B2C${batch + 1}/${batches}\u6279\u540C\u6B65\u5931\u8D25: ${errMsg}`);
              failedBatches.push({
                batch: batch + 1,
                startDate: startDateStr,
                endDate: endDateStr,
                error: errMsg
              });
            }
          }
        }
        await this.updateCampaignPerformanceSummary();
        try {
          const hourlyGenerated = await this.generateHourlyFromDaily(rangeStartDate, rangeEndDate);
          log211.info(`v195: hourly_performance\u81EA\u52A8\u751F\u6210\u5B8C\u6210: ${hourlyGenerated}\u6761`);
        } catch (hourlyErr) {
          log211.warn(`v195: hourly_performance\u751F\u6210\u5931\u8D25: ${hourlyErr.message}`);
        }
        if (failedBatches.length > 0) {
          const failSummary = failedBatches.map((fb) => `\u6279\u6B21${fb.batch}(${fb.startDate}~${fb.endDate}): ${fb.error}`).join("; ");
          log211.warn(`[v358] \u7EE9\u6548\u6570\u636E\u540C\u6B65\u90E8\u5206\u5931\u8D25: ${failedBatches.length}/${batches}\u6279\u5931\u8D25, \u6210\u529F\u540C\u6B65${totalSynced}\u6761. \u5931\u8D25\u8BE6\u60C5: ${failSummary}`);
          // v578: 部分成功机制 - 如果有成功同步的数据，不再抛出异常阻塞后续步骤
          if (totalSynced > 0) {
            log211.info(`[v596] 绩效数据部分同步成功: ${totalSynced}条已入库, ${failedBatches.length}/${batches}批失败将在下次同步时重试`);
            // v596: 记录失败批次到Redis，用于断点续传
            try {
              const { getRedis: _rds10, isRedisAvailable: _rdsOk10 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
              if (_rdsOk10() && _rds10()) {
                const resumeKey = `sync:perf_resume:${this.accountId}`;
                const resumeData = JSON.stringify({
                  failedBatches: failedBatches.map(fb => ({ startDate: fb.startDate, endDate: fb.endDate })),
                  savedAt: new Date().toISOString(),
                  totalSynced
                });
                await _rds10().set(resumeKey, resumeData, "EX", 3600); // 1小时过期
                log211.info(`[v596] 失败批次已保存到Redis断点续传: ${failedBatches.length}个批次, key=${resumeKey}`);
              }
            } catch(_resumeErr) {}
          } else {
            throw new Error(`PARTIAL_SYNC_FAILURE: ${failedBatches.length}/${batches}\u6279\u5931\u8D25, \u6210\u529F${totalSynced}\u6761. ${failSummary}`);
          }
        }
        log211.info(`\u7EE9\u6548\u6570\u636E\u540C\u6B65\u5B8C\u6210: \u5171${totalSynced}\u6761\u8BB0\u5F55`);
        return totalSynced;
      } catch (error48) {
        if (error48.message?.startsWith("PARTIAL_SYNC_FAILURE:")) {
          throw error48;
        }
        log211.warn(`[v242] \u540C\u6B65\u7EE9\u6548\u6570\u636E\u5931\u8D25: ${JSON.stringify({ message: error48.message, status: error48.status || error48.response?.status, code: error48.code })}`);
        log211.warn("[v242] \u8BE6\u7EC6\u9519\u8BEF:", error48.stack?.substring(0, 500));
        if (error48.message?.includes("timeout") || error48.message?.includes("PENDING") || error48.message?.includes("Report generation")) {
          log211.warn("v148: \u62A5\u544A\u8D85\u65F6\u6216\u751F\u6210\u5931\u8D25\uFF0C\u5C06\u5728\u4E0B\u6B21\u540C\u6B65\u5468\u671F\u91CD\u8BD5\u3002\u4E0D\u518D\u751F\u6210\u6A21\u62DF\u6570\u636E\u3002");
        }
        throw error48;
      }
    };
    AmazonSyncService.prototype.syncPerformanceDataBatch = async function(startDateStr, endDateStr) {
      const db = await getDb();
      if (!db) throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
      let totalSynced = 0;
      const clampStartDateForRetention = /* @__PURE__ */ __name((adType, originalStartDate) => {
        const now = /* @__PURE__ */ new Date();
        const retentionDays = {
          "SP": 90,
          // SP支持95天，留5天缓冲
          "SB": 55,
          // SB保留约60天，留5天缓冲
          "SD": 58
          // SD保留约65天，留7天缓冲
        };
        const maxDays = retentionDays[adType] || 90;
        const safeStartDate = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1e3);
        const safeStartStr = safeStartDate.toISOString().split("T")[0];
        if (originalStartDate < safeStartStr) {
          log211.info(`[v351] [${adType}] startDate ${originalStartDate} \u8D85\u51FA\u6570\u636E\u4FDD\u7559\u671F\uFF0C\u81EA\u52A8\u8C03\u6574\u4E3A ${safeStartStr}`);
          return safeStartStr;
        }
        return originalStartDate;
      }, "clampStartDateForRetention");
      const retryReport = /* @__PURE__ */ __name(async (name2, adType, requestFn, maxRetries = 3) => {
        let effectiveStartDate = clampStartDateForRetention(adType, startDateStr);
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            log211.info(`[${name2}] \u8BF7\u6C42\u62A5\u544A (\u5C1D\u8BD5${attempt}/${maxRetries}): ${effectiveStartDate} - ${endDateStr}`);
            const reportId = await requestFn(effectiveStartDate, endDateStr);
            log211.info(`[${name2}] \u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${reportId}`);
            const data = await this.client.waitAndDownloadReport(reportId, 6e5);
            log211.info(`[${name2}] \u62A5\u544A\u4E0B\u8F7D\u5B8C\u6210, \u6570\u636E\u6761\u6570: ${data?.length || 0}`);
            return data;
          } catch (err) {
            const errMsg = err.message || "";
            const errData = err.response?.data;
            const errDetail = typeof errData === "string" ? errData : JSON.stringify(errData || "");
            const retentionMatch = errDetail.match(/retention start date \((\d{4}-\d{2}-\d{2})\)/);
            if (retentionMatch) {
              const retentionStartDate = retentionMatch[1];
              log211.warn(`[v351] [${name2}] Amazon\u6570\u636E\u4FDD\u7559\u671F\u8D77\u59CB\u65E5: ${retentionStartDate}\uFF0C\u81EA\u52A8\u8C03\u6574startDate`);
              const retentionDate = new Date(retentionStartDate);
              retentionDate.setDate(retentionDate.getDate() + 1);
              effectiveStartDate = retentionDate.toISOString().split("T")[0];
              if (attempt < maxRetries) {
                log211.info(`[v351] [${name2}] \u4F7F\u7528\u8C03\u6574\u540E\u7684startDate\u91CD\u8BD5: ${effectiveStartDate} - ${endDateStr}`);
                await new Promise((r) => setTimeout(r, 2e3));
                continue;
              }
            }
            const isRetryable = !errMsg.includes("401") && !errMsg.includes("403") && !errMsg.includes("not enabled");
            if (attempt < maxRetries && isRetryable) {
              const delay2 = attempt * 5e3;
              log211.warn(`[${name2}] \u5C1D\u8BD5${attempt}\u5931\u8D25: ${errMsg}, ${delay2 / 1e3}\u79D2\u540E\u91CD\u8BD5...`);
              await new Promise((r) => setTimeout(r, delay2));
            } else {
              log211.warn(`[${name2}] \u62A5\u544A\u540C\u6B65\u6700\u7EC8\u5931\u8D25 (${attempt}\u6B21\u5C1D\u8BD5): ${errMsg}`);
              return null;
            }
          }
        }
        return null;
      }, "retryReport");
      const spStartDate = clampStartDateForRetention("SP", startDateStr);
      const sbStartDate = clampStartDateForRetention("SB", startDateStr);
      const sdStartDate = clampStartDateForRetention("SD", startDateStr);
      // v587: P1 - 大账户按广告类型串行请求，减少并发压力
      const isLargeAcctBatch = (this._campaignCount || 0) >= 1000;
      if (isLargeAcctBatch) {
        log211.info(`[v587] P1大账户批量模式: 按广告类型串行请求 (campaigns=${this._campaignCount})`);
      }
      const reportRequestList = [];
      const reportAdTypes = [];
      if (spStartDate <= endDateStr) {
        reportRequestList.push({ name: "SP\u7EE9\u6548", requestFn: /* @__PURE__ */ __name(() => this.client.requestSpCampaignReport(spStartDate, endDateStr), "requestFn") });
        reportAdTypes.push("SP");
      } else {
        log211.info(`[v523.3] \u8DF3\u8FC7SP\u7EE9\u6548\u62A5\u544A: clamp\u540EstartDate(${spStartDate}) > endDate(${endDateStr})\uFF0C\u8BE5\u6279\u6B21\u8D85\u51FASP\u6570\u636E\u4FDD\u7559\u671F`);
      }
      if (sbStartDate <= endDateStr) {
        reportRequestList.push({ name: "SB\u7EE9\u6548", requestFn: /* @__PURE__ */ __name(() => this.client.requestSbCampaignReport(sbStartDate, endDateStr), "requestFn") });
        reportAdTypes.push("SB");
      } else {
        log211.info(`[v523.3] \u8DF3\u8FC7SB\u7EE9\u6548\u62A5\u544A: clamp\u540EstartDate(${sbStartDate}) > endDate(${endDateStr})\uFF0C\u8BE5\u6279\u6B21\u8D85\u51FASB\u6570\u636E\u4FDD\u7559\u671F`);
      }
      if (sdStartDate <= endDateStr) {
        reportRequestList.push({ name: "SD\u7EE9\u6548", requestFn: /* @__PURE__ */ __name(() => this.client.requestSdCampaignReport(sdStartDate, endDateStr), "requestFn") });
        reportAdTypes.push("SD");
      } else {
        log211.info(`[v523.3] \u8DF3\u8FC7SD\u7EE9\u6548\u62A5\u544A: clamp\u540EstartDate(${sdStartDate}) > endDate(${endDateStr})\uFF0C\u8BE5\u6279\u6B21\u8D85\u51FASD\u6570\u636E\u4FDD\u7559\u671F`);
      }
      log211.info(`[v413] \u5F00\u59CB\u6279\u91CF\u63D0\u4EA4\u62A5\u544A: SP(${spStartDate}), SB(${sbStartDate}), SD(${sdStartDate}) - ${endDateStr}, \u5B9E\u9645\u63D0\u4EA4${reportRequestList.length}\u4E2A`);
      if (reportRequestList.length === 0) {
        log211.info(`[v523.3] \u5F53\u524D\u6279\u6B21\u6240\u6709\u5E7F\u544A\u7C7B\u578B\u5747\u8D85\u51FA\u6570\u636E\u4FDD\u7559\u671F\uFF0C\u8DF3\u8FC7`);
        return totalSynced;
      }
      // P5: Async Report Queue - submit reports and return immediately
      // ReportJobScheduler will handle polling, downloading, and data processing
      const useAsyncQueue = process.env.P5_ASYNC_REPORTS !== "false"; // Default: enabled
      
      if (useAsyncQueue) {
        log211.info(`[P5] Async mode: submitting ${reportRequestList.length} performance reports to queue`);
        try {
          const asyncResult = await this.client.submitReportsToAsyncQueue(reportRequestList, {
            accountId: this.accountId,
            profileId: this.client.getProfileId(),
            startDate: startDateStr,
            endDate: endDateStr,
            syncType: "performance"
          });
          log211.info(`[P5] Performance reports queued: ${asyncResult.queued} queued, ${asyncResult.failed} failed, jobIds=[${asyncResult.jobIds.join(",")}]`);
          
          // P5: For reports that returned immediate data (e.g., retention errors returning []), process them
          for (let i = 0; i < asyncResult.results.length; i++) {
            const result = asyncResult.results[i];
            if (result && result.data && result.data.length > 0) {
              totalSynced += await this.processReportData(db, result.data, reportAdTypes[i]);
              log211.info(`[P5] Immediate data processed: ${result.name} = ${result.data.length} records`);
            }
          }
          
          // P5: Store queued job info in Redis for progress tracking
          try {
            const { getRedis: _rds11, isRedisAvailable: _rdsOk11 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
            if (_rdsOk11() && _rds11()) {
              await _rds11().set(
                `sync:perf_async:${this.accountId}:${startDateStr}`,
                JSON.stringify({ jobIds: asyncResult.jobIds, queuedAt: new Date().toISOString(), adTypes: reportAdTypes }),
                "EX", 7200
              );
            }
          } catch (_redisErr) {}
          
          // P5: Return 0 for now - actual data will be processed by ReportJobScheduler
          // The sync step is considered "successful" as reports are queued
          return totalSynced;
        } catch (asyncErr) {
          log211.warn(`[P5] Async queue failed, falling back to sync mode: ${asyncErr.message}`);
          // Fall through to synchronous mode below
        }
      }
      
      // Fallback: Original synchronous mode (when P5_ASYNC_REPORTS=false or async fails)
      let reportResults;
      if (isLargeAcctBatch && reportRequestList.length > 1) {
        log211.info(`[P5-fallback] Large account serial mode: ${reportRequestList.length} reports`);
        reportResults = [];
        for (let ri = 0; ri < reportRequestList.length; ri++) {
          const singleResult = await this.client.submitAndWaitMultipleReports([reportRequestList[ri]], 12e5, 2e3);
          reportResults.push(singleResult[0]);
          if (ri < reportRequestList.length - 1) {
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      } else {
        reportResults = await this.client.submitAndWaitMultipleReports(reportRequestList, 12e5, 2e3);
      }
      for (let i = 0; i < reportResults.length; i++) {
        const result = reportResults[i];
        if (result.data && result.data.length > 0) {
          totalSynced += await this.processReportData(db, result.data, reportAdTypes[i]);
          log211.info(`[P5-fallback] ${result.name} processed: ${result.data.length} records`);
        } else if (result.error) {
          log211.warn(`[P5-fallback] ${result.name} failed: ${result.error}`);
        }
      }
      const resultSummary = reportAdTypes.map((t2, i) => `${t2}=${reportResults[i]?.data?.length || 0}`).join(", ");
      log211.info(`[P5-fallback] Performance sync complete: ${resultSummary}, total=${totalSynced}`);
      return totalSynced;
    };
    __name(flushDailyPerfBatch, "flushDailyPerfBatch");
    AmazonSyncService.prototype.processReportData = async function(db, reportData, adType) {
      try {
        log211.info(`\u5F00\u59CB\u5904\u7406${adType}\u62A5\u544A\u6570\u636E, \u5171 ${reportData.length} \u6761\u8BB0\u5F55`);
        if (reportData.length > 0) {
          log211.debug(`${adType}\u62A5\u544A\u6570\u636E\u7B2C\u4E00\u6761\u793A\u4F8B:`, JSON.stringify(reportData[0], null, 2));
        }
        if (!reportData || reportData.length === 0) {
          log211.warn("\u62A5\u544A\u6570\u636E\u4E3A\u7A7A");
          return 0;
        }
        log211.debug("\u62A5\u544A\u6570\u636E\u7B2C\u4E00\u6761\u793A\u4F8B:", JSON.stringify(reportData[0], null, 2));
        let synced = 0;
        log211.info(`\u5F00\u59CB\u5904\u7406\u62A5\u544A\u6570\u636E, \u5171 ${reportData.length} \u6761\u8BB0\u5F55`);
        let matchedById = 0;
        let matchedByName = 0;
        let notMatched = 0;
        let upsertBatch = [];
        let currencyBatch = [];
        const allCampaigns = await db.select().from(campaigns).where(eq(campaigns.accountId, this.accountId));
        const campaignByIdMap = /* @__PURE__ */ new Map();
        const campaignByNameMap = /* @__PURE__ */ new Map();
        for (const c of allCampaigns) {
          campaignByIdMap.set(String(c.campaignId), c);
          if (c.campaignName) campaignByNameMap.set(c.campaignName, c);
        }
        log211.info(`[v391] \u9884\u52A0\u8F7D ${allCampaigns.length} \u4E2Acampaigns\u5230\u5185\u5B58Map (ID\u7D22\u5F15: ${campaignByIdMap.size}, Name\u7D22\u5F15: ${campaignByNameMap.size})`);
        const { currency: preFetchedCurrency, rate: preFetchedRate } = await getExchangeRateByMarketplace(this.marketplace);
        log211.info(`[v395] \u9884\u52A0\u8F7D\u6C47\u7387: ${this.marketplace} -> ${preFetchedCurrency}, rate=${preFetchedRate}`);
        for (const row of reportData) {
          let campaign = campaignByIdMap.get(String(row.campaignId));
          if (campaign) {
            matchedById++;
          } else if (row.campaignName) {
            campaign = campaignByNameMap.get(row.campaignName);
            if (campaign) {
              matchedByName++;
              log211.info(`${adType}\u901A\u8FC7\u540D\u79F0\u5339\u914D\u6210\u529F: ${row.campaignName} (reportId=${row.campaignId}, dbId=${campaign.campaignId})`);
            }
          }
          if (!campaign) {
            if (row.campaignId && row.campaignName) {
              try {
                log211.info(`${adType}\u81EA\u52A8\u521B\u5EFAcampaign: ${row.campaignName}`);
                const [newCampaign] = await db.insert(campaigns).values({
                  accountId: this.accountId,
                  // @ts-ignore
                  campaignId: String(row.campaignId),
                  // @ts-ignore
                  campaignName: row.campaignName,
                  campaignType: adType === "SP" ? "sp_manual" : adType.toLowerCase(),
                  targetingType: "manual",
                  // @ts-ignore
                  status: row.campaignStatus || "enabled",
                  // @ts-ignore
                  dailyBudget: row.campaignBudget ? String(row.campaignBudget) : "0",
                  createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
                  updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
                  // @ts-expect-error - runtime type mismatch
                }).returning();
                campaign = newCampaign;
                campaignByIdMap.set(String(campaign.campaignId), campaign);
                if (campaign.campaignName) campaignByNameMap.set(campaign.campaignName, campaign);
                log211.info(`${adType}\u81EA\u52A8\u521B\u5EFAcampaign\u6210\u529F: id=${campaign.id}, name=${campaign.campaignName}`);
              } catch (createError) {
                log211.warn(`${adType}\u521B\u5EFAcampaign\u5931\u8D25\uFF0C\u5C1D\u8BD5\u518D\u6B21\u67E5\u8BE2:`, createError.message);
                const [existingCampaign] = await db.select().from(campaigns).where(
                  and(
                    eq(campaigns.accountId, this.accountId),
                    // @ts-ignore
                    eq(campaigns.campaignName, row.campaignName)
                  )
                  // @ts-ignore
                ).limit(1);
                campaign = existingCampaign;
                if (campaign) {
                  campaignByIdMap.set(String(campaign.campaignId), campaign);
                  if (campaign.campaignName) campaignByNameMap.set(campaign.campaignName, campaign);
                }
              }
            }
            if (!campaign) {
              notMatched++;
              if (notMatched <= 10) {
                log211.warn(`${adType}\u672A\u627E\u5230campaign: accountId=${this.accountId}, campaignId=${row.campaignId}, campaignName=${row.campaignName || "N/A"}`);
              }
              continue;
            }
          }
          const { amazonId: amazonCampaignId } = extractCampaignIds(campaign, `syncPerformance.${adType}`);
          const reportDate = row.date ? new Date(row.date) : /* @__PURE__ */ new Date();
          const reportDateStr = reportDate.toISOString().split("T")[0];
          const cost = row.cost || 0;
          let sales = 0;
          let orders = 0;
          let unitsSold = 0;
          let dpv = 0;
          let addToCart = 0;
          let ntbOrders = 0;
          let ntbSales = 0;
          let viewableImpressions = 0;
          if (adType === "SP") {
            sales = row.sales7d || 0;
            orders = row.purchases7d || 0;
            unitsSold = row.unitsSoldClicks7d || 0;
            dpv = 0;
            addToCart = 0;
          } else if (adType === "SB") {
            sales = row.salesClicks || 0;
            orders = row.purchasesClicks || 0;
            unitsSold = row.unitsSoldClicks || 0;
            dpv = row.detailPageViewsClicks || 0;
            ntbOrders = row.newToBrandPurchasesClicks || 0;
            ntbSales = row.newToBrandSalesClicks || 0;
          } else {
            sales = row.salesClicks || 0;
            orders = row.purchasesClicks || 0;
            unitsSold = row.unitsSoldClicks || 0;
            viewableImpressions = row.viewableImpressions || 0;
            dpv = row.detailPageViewsClicks || 0;
            ntbOrders = row.newToBrandPurchasesClicks || 0;
            ntbSales = row.newToBrandSalesClicks || 0;
          }
          const currency = preFetchedCurrency;
          const exchangeRate = preFetchedRate;
          const spendUsd = cost * exchangeRate;
          const salesUsd = sales * exchangeRate;
          const perfData = {
            accountId: this.accountId,
            campaignId: guardCampaignIdInsert(amazonCampaignId, "daily_performance"),
            date: reportDateStr,
            // @ts-ignore
            impressions: row.impressions || 0,
            // @ts-ignore
            clicks: row.clicks || 0,
            spend: String(cost),
            sales: String(sales),
            orders,
            dailyAcos: cost && sales ? String(cost / sales * 100) : "0",
            dailyRoas: cost && sales ? String(sales / cost) : "0",
            // @ts-ignore
            ctr: (row.impressions || 0) > 0 ? String((row.clicks || 0) / (row.impressions || 0)) : null,
            // @ts-ignore
            cvr: (row.clicks || 0) > 0 ? String(orders / (row.clicks || 0)) : null,
            // @ts-ignore
            cpc: (row.clicks || 0) > 0 ? String(cost / (row.clicks || 0)) : null,
            // ✅ Report API v3 新增字段
            unitsSold,
            dpv,
            addToCart,
            ntbOrders,
            ntbSales: String(ntbSales),
            viewableImpressions,
            // ✅ 广告类型和归因窗口标记（SP=7天, SB=14天, SD=14天）
            adType,
            attributionWindow: adType === "SP" ? 7 : 14,
            // ✅ 标记为API报告数据（已经过归因窗口校准），防止AMS实时数据覆盖
            isFinalized: reportDateStr === getMarketplaceCurrentDate(this.marketplace) ? 0 : 1,
            dataSource: "api"
          };
          upsertBatch.push({
            ...perfData,
            createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          });
          currencyBatch.push({ currency, exchangeRate, spendUsd: spendUsd.toFixed(2), salesUsd: salesUsd.toFixed(2) });
          synced++;
          if (upsertBatch.length >= 500) {
            await flushDailyPerfBatch(db, upsertBatch, currencyBatch);
            upsertBatch = [];
            currencyBatch = [];
          }
        }
        if (upsertBatch.length > 0) {
          await flushDailyPerfBatch(db, upsertBatch, currencyBatch);
          upsertBatch = [];
          currencyBatch = [];
        }
        log211.info(`${adType}\u62A5\u544A\u6570\u636E\u5904\u7406\u5B8C\u6210:`);
        log211.debug(`  - \u901A\u8FC7ID\u5339\u914D: ${matchedById} \u6761`);
        log211.debug(`  - \u901A\u8FC7\u540D\u79F0\u5339\u914D: ${matchedByName} \u6761`);
        log211.debug(`  - \u672A\u5339\u914D: ${notMatched} \u6761`);
        log211.info(`  - \u603B\u540C\u6B65: ${synced} \u6761`);
        return synced;
      } catch (error48) {
        log211.warn(`[v358] ${adType}\u62A5\u544A\u6570\u636E\u5904\u7406\u5931\u8D25:`, error48.message);
        throw new Error(`${adType}_REPORT_PROCESS_FAILED: ${error48.message}`);
      }
    };
    AmazonSyncService.prototype.generateMockPerformanceData = async function(days = 7) {
      log211.warn("\u26A0\uFE0F generateMockPerformanceData\u5DF2\u5E9F\u5F03\uFF0C\u4E0D\u5E94\u88AB\u8C03\u7528\uFF01\u8BF7\u4F7F\u7528syncPerformanceData()\u4EE3\u66FF");
      const db = await getDb();
      if (!db) throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
      try {
        const accountCampaigns = await db.select().from(campaigns).where(eq(campaigns.accountId, this.accountId));
        log211.debug(`\u4E3A ${accountCampaigns.length} \u4E2A\u5E7F\u544A\u6D3B\u52A8\u751F\u6210\u6A21\u62DF\u7EE9\u6548\u6570\u636E`);
        let synced = 0;
        const marketplaceToday = getMarketplaceCurrentDate(this.marketplace);
        log211.debug(`\u7AD9\u70B9${this.marketplace}\u5F53\u524D\u65E5\u671F: ${marketplaceToday}`);
        for (const campaign of accountCampaigns) {
          const { amazonId: amazonCampaignId } = extractCampaignIds(campaign, "generateMockPerformanceData");
          for (let i = 0; i < days; i++) {
            const baseDate = new Date(marketplaceToday);
            baseDate.setDate(baseDate.getDate() - i);
            const dateStr = baseDate.toISOString().split("T")[0];
            const [existing] = await db.select().from(dailyPerformance).where(
              and(
                eq(dailyPerformance.accountId, this.accountId),
                eq(dailyPerformance.campaignId, amazonCampaignId),
                sql`DATE(${dailyPerformance.date}) = ${dateStr}`
              )
            ).limit(1);
            if (existing) continue;
            ;
            const baseImpressions = campaign.campaignType === "sp_auto" || campaign.campaignType === "sp_manual" ? 5e3 : (
              // @ts-ignore
              campaign.campaignType === "sb" ? 3e3 : 2e3
            );
            const baseCtr = 0.02 + Math.random() * 0.03;
            const baseCvr = 0.05 + Math.random() * 0.1;
            const baseCpc = 0.5 + Math.random() * 1.5;
            const baseAov = 20 + Math.random() * 80;
            const impressions = Math.floor(baseImpressions * (0.7 + Math.random() * 0.6));
            const clicks = Math.floor(impressions * baseCtr);
            const orders = Math.floor(clicks * baseCvr);
            const spend = clicks * baseCpc;
            const sales = orders * baseAov;
            const perfData = {
              accountId: this.accountId,
              campaignId: guardCampaignIdInsert(amazonCampaignId, "daily_performance"),
              date: dateStr,
              impressions,
              clicks,
              spend: String(spend.toFixed(2)),
              sales: String(sales.toFixed(2)),
              orders,
              dailyAcos: sales > 0 ? String((spend / sales * 100).toFixed(2)) : "0",
              dailyRoas: spend > 0 ? String((sales / spend).toFixed(2)) : "0",
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            };
            await db.insert(dailyPerformance).values(perfData);
            synced++;
          }
        }
        await this.updateCampaignPerformanceSummary();
        log211.info(`\u6A21\u62DF\u7EE9\u6548\u6570\u636E\u751F\u6210\u5B8C\u6210: ${synced} \u6761\u8BB0\u5F55`);
        return synced;
      } catch (error48) {
        log211.warn("\u751F\u6210\u6A21\u62DF\u7EE9\u6548\u6570\u636E\u5931\u8D25:", error48);
        throw error48;
      }
    };
    AmazonSyncService.prototype.syncKeywordPerformanceData = async function(days = 7) {
      const db = await getDb();
      if (!db) {
        log211.warn("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
        throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
      }
      try {
        const MAX_DAYS_PER_REQUEST = 31;
        const totalDays = Math.min(days, 90);
        const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
        const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
        log211.info(`v339: \u5F00\u59CB\u540C\u6B65\u5173\u952E\u8BCD\u7EE9\u6548\u6570\u636E: \u5171${totalDays}\u5929\uFF0C\u5206${batches}\u6279\u8BF7\u6C42 (\u7AD9\u70B9: ${this.marketplace})`);
        let allReportData = [];
        if (batches === 1) {
          try {
            const reportId = await this.client.requestSpKeywordReport(rangeStartDate, rangeEndDate);
            const data = await this.client.waitAndDownloadReport(reportId, 6e5);
            if (data && data.length > 0) allReportData = data;
          } catch (e) {
            const _errMsg = e.message || "";
            const _is425 = _errMsg.includes("425") || _errMsg.includes("Too Early");
            if (_is425) {
              log211.warn(`v413: \u5173\u952E\u8BCD\u7EE9\u6548\u62A5\u544A\u8BF7\u6C42\u5931\u8D25 (expected 425): ${_errMsg}`);
            } else {
              log211.warn(`v413: \u5173\u952E\u8BCD\u7EE9\u6548\u62A5\u544A\u8BF7\u6C42\u5931\u8D25: ${_errMsg}`);
            }
          }
        } else {
          const batchRequests = [];
          for (let batch = 0; batch < batches; batch++) {
            const endDateObj = new Date(rangeEndDate);
            endDateObj.setDate(endDateObj.getDate() - batch * MAX_DAYS_PER_REQUEST);
            const startDateObj = new Date(endDateObj);
            const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - batch * MAX_DAYS_PER_REQUEST);
            startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
            const bStart = startDateObj.toISOString().split("T")[0];
            const bEnd = endDateObj.toISOString().split("T")[0];
            batchRequests.push({
              name: `\u5173\u952E\u8BCD\u7EE9\u6548\u7B2C${batch + 1}/${batches}\u6279(${bStart}~${bEnd})`,
              requestFn: /* @__PURE__ */ __name(() => this.client.requestSpKeywordReport(bStart, bEnd), "requestFn")
            });
          }
          log211.info(`[v413] \u5173\u952E\u8BCD\u7EE9\u6548: ${batches}\u6279\u6B21\u6279\u91CF\u63D0\u4EA4\u5F00\u59CB`);
          const results = await this.client.submitAndWaitMultipleReports(batchRequests, 12e5, 2e3);
          for (const result of results) {
            if (result.data && result.data.length > 0) {
              allReportData = allReportData.concat(result.data);
            } else if (result.error) {
              log211.warn(`[v413] ${result.name}\u5931\u8D25: ${result.error}`);
            }
          }
        }
        if (!allReportData || allReportData.length === 0) {
          log211.warn("v339: \u6240\u6709\u6279\u6B21\u5173\u952E\u8BCD\u62A5\u544A\u6570\u636E\u4E3A\u7A7A");
          return 0;
        }
        log211.info(`v339: \u5171\u83B7\u53D6\u5230 ${allReportData.length} \u6761\u5173\u952E\u8BCD\u7EE9\u6548\u6570\u636E\uFF08${batches}\u6279\u5408\u5E76\uFF09`);
        log211.debug("v196: \u5173\u952E\u8BCD\u62A5\u544A\u6570\u636E\u7B2C\u4E00\u6761\u793A\u4F8B:", JSON.stringify(allReportData[0], null, 2));
        const aggregatedMap = /* @__PURE__ */ new Map();
        for (const row of allReportData) {
          const key = String(row.targetId || row.keywordId || "");
          if (!key) continue;
          const existing = aggregatedMap.get(key);
          if (existing) {
            existing.cost = (existing.cost || 0) + (row.cost || 0);
            existing.impressions = (existing.impressions || 0) + (row.impressions || 0);
            existing.clicks = (existing.clicks || 0) + (row.clicks || 0);
            existing.sales7d = (existing.sales7d || 0) + (row.sales7d || 0);
            existing.sales14d = (existing.sales14d || 0) + (row.sales14d || 0);
            existing.purchases7d = (existing.purchases7d || 0) + (row.purchases7d || 0);
            existing.purchases14d = (existing.purchases14d || 0) + (row.purchases14d || 0);
            existing.unitsSoldClicks7d = (existing.unitsSoldClicks7d || 0) + (row.unitsSoldClicks7d || 0);
            existing.unitsSoldSameSku7d = (existing.unitsSoldSameSku7d || 0) + (row.unitsSoldSameSku7d || 0);
            existing.unitsSoldOtherSku7d = (existing.unitsSoldOtherSku7d || 0) + (row.unitsSoldOtherSku7d || 0);
            existing.attributedSalesSameSku7d = (existing.attributedSalesSameSku7d || 0) + (row.attributedSalesSameSku7d || 0);
            existing.salesOtherSku7d = (existing.salesOtherSku7d || 0) + (row.salesOtherSku7d || 0);
          } else {
            aggregatedMap.set(key, { ...row });
          }
        }
        const reportData = Array.from(aggregatedMap.values());
        log211.info(`[v395] SUMMARY\u6A21\u5F0F\u805A\u5408\u5B8C\u6210: ${allReportData.length}\u6761 -> ${reportData.length}\u6761\uFF08\u53BB\u91CD${allReportData.length - reportData.length}\u6761\uFF09`);
        const allAdGroups = await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups).where(eq(adGroups.accountId, this.accountId));
        const adGroupAmazonToLocal = /* @__PURE__ */ new Map();
        for (const ag of allAdGroups) {
          if (ag.adGroupId) adGroupAmazonToLocal.set(String(ag.adGroupId), ag.id);
        }
        const allKeywords = await db.select({
          // @ts-ignore
          id: keywords.id,
          keywordId: keywords.keywordId,
          keywordText: keywords.keywordText,
          matchType: keywords.matchType,
          adGroupId: keywords.internalAdGroupId
        }).from(keywords).where(eq(keywords.accountId, this.accountId));
        const kwByKeywordId = /* @__PURE__ */ new Map();
        const kwByAdGroupTextMatch = /* @__PURE__ */ new Map();
        const kwByAdGroupText = /* @__PURE__ */ new Map();
        const kwByText = /* @__PURE__ */ new Map();
        for (const kw of allKeywords) {
          if (kw.keywordId) kwByKeywordId.set(kw.keywordId, kw);
          if (kw.adGroupId && kw.keywordText && kw.matchType) {
            kwByAdGroupTextMatch.set(`${kw.adGroupId}_${kw.keywordText.toLowerCase()}_${kw.matchType.toLowerCase()}`, kw);
          }
          if (kw.adGroupId && kw.keywordText) {
            kwByAdGroupText.set(`${kw.adGroupId}_${kw.keywordText.toLowerCase()}`, kw);
          }
          if (kw.keywordText) {
            kwByText.set(kw.keywordText.toLowerCase(), kw);
          }
        }
        const allTargets = await db.select({
          id: productTargets.id,
          targetId: productTargets.targetId,
          targetExpression: productTargets.targetExpression,
          adGroupId: productTargets.internalAdGroupId
        }).from(productTargets).where(eq(productTargets.accountId, this.accountId));
        const ptByTargetId = /* @__PURE__ */ new Map();
        const ptByExpression = /* @__PURE__ */ new Map();
        for (const pt of allTargets) {
          if (pt.targetId) ptByTargetId.set(pt.targetId, pt);
          if (pt.targetExpression) ptByExpression.set(pt.targetExpression.toLowerCase(), pt);
        }
        log211.info(`v387: \u9884\u52A0\u8F7D\u5B8C\u6210(accountId=${this.accountId}) - ${allKeywords.length}\u4E2A\u5173\u952E\u8BCD, ${allTargets.length}\u4E2A\u5546\u54C1\u6295\u653E, ${allAdGroups.length}\u4E2A\u5E7F\u544A\u7EC4`);
        let synced = 0;
        let notMatched = 0;
        let matchStats = { byKeywordId: 0, byAdGroupTextMatch: 0, byAdGroupText: 0, byText: 0, byTargetId: 0, byExpression: 0 };
        const kwUpdates = [];
        const ptUpdates = [];
        for (const row of reportData) {
          const reportTargetId = String(row.targetId || row.keywordId || "");
          if (!reportTargetId) continue;
          const cost = row.cost || 0;
          const sales = row.sales7d || row.sales14d || 0;
          const orders = row.purchases7d || row.purchases14d || 0;
          const impressions = row.impressions || 0;
          const clicks = row.clicks || 0;
          let kw = kwByKeywordId.get(reportTargetId);
          if (kw) {
            matchStats.byKeywordId++;
          }
          if (!kw && row.targetingText && row.adGroupId) {
            const localAgId = adGroupAmazonToLocal.get(String(row.adGroupId));
            if (localAgId) {
              const matchType = row.matchType || row.keywordType || "";
              if (matchType) {
                kw = kwByAdGroupTextMatch.get(`${localAgId}_${row.targetingText.toLowerCase()}_${matchType.toLowerCase()}`);
                if (kw) matchStats.byAdGroupTextMatch++;
              }
              if (!kw) {
                kw = kwByAdGroupText.get(`${localAgId}_${row.targetingText.toLowerCase()}`);
                if (kw) matchStats.byAdGroupText++;
              }
            }
          }
          if (!kw && row.targetingText) {
            kw = kwByText.get(row.targetingText.toLowerCase());
            if (kw) matchStats.byText++;
          }
          if (kw) {
            kwUpdates.push({
              id: kw.id,
              data: {
                impressions,
                clicks,
                // @ts-ignore
                spend: String(cost),
                sales: String(sales),
                orders,
                // @ts-ignore
                keywordAcos: cost > 0 && sales > 0 ? String((cost / sales * 100).toFixed(2)) : "0.00",
                keywordCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : "0.0000",
                keywordCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : "0.0000",
                // @ts-ignore
                keywordCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : "0.00",
                keywordRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : "0.00",
                updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
              }
            });
            synced++;
            continue;
          }
          let pt = ptByTargetId.get(reportTargetId);
          if (pt) {
            matchStats.byTargetId++;
          }
          if (!pt && row.targetingExpression) {
            pt = ptByExpression.get(row.targetingExpression.toLowerCase());
            if (pt) matchStats.byExpression++;
          }
          if (pt) {
            ptUpdates.push({
              id: pt.id,
              data: {
                impressions,
                clicks,
                spend: String(cost),
                sales: String(sales),
                orders,
                targetAcos: cost > 0 && sales > 0 ? String((cost / sales * 100).toFixed(2)) : "0.00",
                targetRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : "0.00",
                targetCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : "0.0000",
                targetCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : "0.0000",
                targetCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : "0.00",
                updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
              }
            });
            synced++;
            continue;
          }
          notMatched++;
          if (notMatched <= 5) {
            log211.warn(`v196: \u672A\u5339\u914D: targetId=${reportTargetId}, text=${row.targetingText || "N/A"}, expr=${row.targetingExpression || "N/A"}`);
          }
        }
        let dbWritten = 0;
        const BATCH_SIZE = 200;
        async function batchUpdateByIds(updates, tableName, table) {
          if (updates.length === 0) return 0;
          let written = 0;
          for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            try {
              const CONCURRENT = 20;
              for (let j = 0; j < batch.length; j += CONCURRENT) {
                const subBatch = batch.slice(j, j + CONCURRENT);
                const results = await Promise.allSettled(
                  subBatch.map((upd) => db.update(table).set(upd.data).where(eq(table.id, upd.id)))
                );
                for (let k = 0; k < results.length; k++) {
                  if (results[k].status === "fulfilled") {
                    written++;
                  } else {
                    const err = results[k].reason;
                    if (written + (updates.length - i - j - k) > updates.length - 5) {
                      log211.warn(`v614i-fix9: \u6279\u91CF\u66F4\u65B0${tableName} id=${subBatch[k]?.id} \u5931\u8D25: ${err?.message || err}`);
                    }
                  }
                }
              }
              log211.debug(`v614i-fix9: ${tableName}\u6279\u91CF\u66F4\u65B0\u8FDB\u5EA6: ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`);
            } catch (batchErr) {
              log211.warn(`v614i-fix9: ${tableName}\u6279\u6B21${Math.floor(i / BATCH_SIZE) + 1}\u5931\u8D25: ${batchErr.message}`);
            }
          }
          return written;
        }
        __name(batchUpdateByIds, "batchUpdateByIds");
        dbWritten += await batchUpdateByIds(kwUpdates, "keyword", keywords);
        dbWritten += await batchUpdateByIds(ptUpdates, "product_target", productTargets);
        log211.info(`v196: \u5173\u952E\u8BCD\u7EE9\u6548\u540C\u6B65\u5B8C\u6210 - \u5339\u914D${synced}\u6761, \u672A\u5339\u914D${notMatched}\u6761, \u5199\u5165${dbWritten}\u6761`);
        log211.debug(`v196: \u5339\u914D\u7EDF\u8BA1 - keywordId:${matchStats.byKeywordId}, adGroup+text+match:${matchStats.byAdGroupTextMatch}, adGroup+text:${matchStats.byAdGroupText}, text:${matchStats.byText}, targetId:${matchStats.byTargetId}, expression:${matchStats.byExpression}`);
        let backfilled = 0;
        for (const row of reportData) {
          const reportTargetId = String(row.targetId || row.keywordId || "");
          if (!reportTargetId || !row.targetingText) continue;
          const kw = kwByText.get(row.targetingText.toLowerCase());
          if (kw && (!kw.keywordId || kw.keywordId.startsWith("SKIP_"))) {
            try {
              await db.update(keywords).set({ keywordId: reportTargetId }).where(eq(keywords.id, kw.id));
              backfilled++;
            } catch (e) {
            }
          }
        }
        if (backfilled > 0) {
          log211.debug(`v196: \u56DE\u586B\u4E86${backfilled}\u4E2A\u5173\u952E\u8BCD\u7684keywordId`);
        }
        // v614: 增加SB关键词绩效同步
        try {
          const sbCampaignsCheck = await db.select({ id: campaigns.id, campaignType: campaigns.campaignType }).from(campaigns).where(eq(campaigns.accountId, this.accountId));
          const hasSbCampaigns = sbCampaignsCheck.some(c => c.campaignType === "sb");
          if (hasSbCampaigns) {
            log211.info(`[v614] \u5F00\u59CBSB\u5173\u952E\u8BCD\u7EE9\u6548\u540C\u6B65 (${totalDays}\u5929)...`);
            let sbAllReportData = [];
            if (batches === 1) {
              try {
                const sbReportId = await this.client.requestSbTargetingReport(rangeStartDate, rangeEndDate);
                const sbData = await this.client.waitAndDownloadReport(sbReportId, 6e5);
                if (sbData && sbData.length > 0) sbAllReportData = sbData;
              } catch (sbErr) {
                log211.warn(`[v614] SB\u5173\u952E\u8BCD\u62A5\u544A\u8BF7\u6C42\u5931\u8D25: ${sbErr.message}`);
              }
            } else {
              const sbBatchRequests = [];
              for (let sbBatch = 0; sbBatch < batches; sbBatch++) {
                const sbEndObj = new Date(rangeEndDate);
                sbEndObj.setDate(sbEndObj.getDate() - sbBatch * MAX_DAYS_PER_REQUEST);
                const sbStartObj = new Date(sbEndObj);
                const sbDaysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - sbBatch * MAX_DAYS_PER_REQUEST);
                sbStartObj.setDate(sbStartObj.getDate() - sbDaysInBatch + 1);
                const sbBStart = sbStartObj.toISOString().split("T")[0];
                const sbBEnd = sbEndObj.toISOString().split("T")[0];
                sbBatchRequests.push({
                  name: `SB\u5173\u952E\u8BCD\u7B2C${sbBatch + 1}/${batches}\u6279(${sbBStart}~${sbBEnd})`,
                  requestFn: /* @__PURE__ */ __name(() => this.client.requestSbTargetingReport(sbBStart, sbBEnd), "requestFn")
                });
              }
              log211.info(`[v614] SB\u5173\u952E\u8BCD: ${batches}\u6279\u6B21\u6279\u91CF\u63D0\u4EA4\u5F00\u59CB`);
              try {
                const sbResults = await this.client.submitAndWaitMultipleReports(sbBatchRequests, 12e5, 2e3);
                for (const sbResult of sbResults) {
                  if (sbResult.data && sbResult.data.length > 0) {
                    sbAllReportData = sbAllReportData.concat(sbResult.data);
                  } else if (sbResult.error) {
                    log211.warn(`[v614] ${sbResult.name}\u5931\u8D25: ${sbResult.error}`);
                  }
                }
              } catch (sbBatchErr) {
                log211.warn(`[v614] SB\u5173\u952E\u8BCD\u6279\u91CF\u62A5\u544A\u5931\u8D25: ${sbBatchErr.message}`);
              }
            }
            if (sbAllReportData.length > 0) {
              log211.info(`[v614] SB\u5173\u952E\u8BCD\u62A5\u544A\u83B7\u53D6 ${sbAllReportData.length} \u6761\u6570\u636E\uFF0C\u5F00\u59CB\u5339\u914D...`);
              const sbAggMap = new Map();
              for (const sbRow of sbAllReportData) {
                const sbKey = String(sbRow.targetId || sbRow.keywordId || "");
                if (!sbKey) continue;
                const sbExisting = sbAggMap.get(sbKey);
                if (sbExisting) {
                  sbExisting.cost = (sbExisting.cost || 0) + (sbRow.cost || 0);
                  sbExisting.impressions = (sbExisting.impressions || 0) + (sbRow.impressions || 0);
                  sbExisting.clicks = (sbExisting.clicks || 0) + (sbRow.clicks || 0);
                  sbExisting.sales = (sbExisting.sales || 0) + (sbRow.sales || 0);
                  sbExisting.salesClicks = (sbExisting.salesClicks || 0) + (sbRow.salesClicks || 0);
                  sbExisting.purchases = (sbExisting.purchases || 0) + (sbRow.purchases || 0);
                  sbExisting.purchasesClicks = (sbExisting.purchasesClicks || 0) + (sbRow.purchasesClicks || 0);
                } else {
                  sbAggMap.set(sbKey, { ...sbRow });
                }
              }
              const sbReportData = Array.from(sbAggMap.values());
              log211.info(`[v614] SB\u5173\u952E\u8BCDAGG: ${sbAllReportData.length} -> ${sbReportData.length}`);
              let sbSynced = 0;
              let sbNotMatched = 0;
              const sbKwUpdates = [];
              const sbPtUpdates = [];
              for (const sbRow of sbReportData) {
                const sbTargetId = String(sbRow.targetId || sbRow.keywordId || "");
                if (!sbTargetId) continue;
                const sbCost = sbRow.cost || 0;
                const sbSales = sbRow.sales || sbRow.salesClicks || 0;
                const sbOrders = sbRow.purchases || sbRow.purchasesClicks || 0;
                const sbImpressions = sbRow.impressions || 0;
                const sbClicks = sbRow.clicks || 0;
                let sbKw = kwByKeywordId.get(sbTargetId);
                if (!sbKw && sbRow.targetingText && sbRow.adGroupId) {
                  const sbLocalAgId = adGroupAmazonToLocal.get(String(sbRow.adGroupId));
                  if (sbLocalAgId) {
                    const sbMatchType = sbRow.matchType || sbRow.keywordType || "";
                    if (sbMatchType) {
                      sbKw = kwByAdGroupTextMatch.get(`${sbLocalAgId}_${sbRow.targetingText.toLowerCase()}_${sbMatchType.toLowerCase()}`);
                    }
                    if (!sbKw) {
                      sbKw = kwByAdGroupText.get(`${sbLocalAgId}_${sbRow.targetingText.toLowerCase()}`);
                    }
                  }
                }
                if (!sbKw && sbRow.targetingText) {
                  sbKw = kwByText.get(sbRow.targetingText.toLowerCase());
                }
                if (sbKw) {
                  sbKwUpdates.push({
                    id: sbKw.id,
                    data: {
                      impressions: sbImpressions,
                      clicks: sbClicks,
                      spend: String(sbCost),
                      sales: String(sbSales),
                      orders: sbOrders,
                      keywordAcos: sbCost > 0 && sbSales > 0 ? String((sbCost / sbSales * 100).toFixed(2)) : "0.00",
                      keywordCtr: sbImpressions > 0 ? String((sbClicks / sbImpressions).toFixed(4)) : "0.0000",
                      keywordCvr: sbClicks > 0 ? String((sbOrders / sbClicks).toFixed(4)) : "0.0000",
                      keywordCpc: sbClicks > 0 ? String((sbCost / sbClicks).toFixed(2)) : "0.00",
                      keywordRoas: sbCost > 0 && sbSales > 0 ? String((sbSales / sbCost).toFixed(2)) : "0.00",
                      updatedAt: (new Date()).toISOString().slice(0, 19).replace("T", " ")
                    }
                  });
                  sbSynced++;
                  continue;
                }
                let sbPt = ptByTargetId.get(sbTargetId);
                if (!sbPt && sbRow.targetingExpression) {
                  sbPt = ptByExpression.get(sbRow.targetingExpression.toLowerCase());
                }
                if (sbPt) {
                  sbPtUpdates.push({
                    id: sbPt.id,
                    data: {
                      impressions: sbImpressions,
                      clicks: sbClicks,
                      spend: String(sbCost),
                      sales: String(sbSales),
                      orders: sbOrders,
                      targetAcos: sbCost > 0 && sbSales > 0 ? String((sbCost / sbSales * 100).toFixed(2)) : "0.00",
                      targetRoas: sbCost > 0 && sbSales > 0 ? String((sbSales / sbCost).toFixed(2)) : "0.00",
                      targetCtr: sbImpressions > 0 ? String((sbClicks / sbImpressions).toFixed(4)) : "0.0000",
                      targetCvr: sbClicks > 0 ? String((sbOrders / sbClicks).toFixed(4)) : "0.0000",
                      targetCpc: sbClicks > 0 ? String((sbCost / sbClicks).toFixed(2)) : "0.00",
                      updatedAt: (new Date()).toISOString().slice(0, 19).replace("T", " ")
                    }
                  });
                  sbSynced++;
                  continue;
                }
                sbNotMatched++;
              }
              dbWritten += await batchUpdateByIds(sbKwUpdates, "sb_keyword", keywords);
              dbWritten += await batchUpdateByIds(sbPtUpdates, "sb_product_target", productTargets);
              synced += sbSynced;
              log211.info(`[v614] SB\u5173\u952E\u8BCD\u7EE9\u6548\u540C\u6B65\u5B8C\u6210: \u5339\u914D${sbSynced}\u6761, \u672A\u5339\u914D${sbNotMatched}\u6761, DB\u5199\u5165${sbKwUpdates.length + sbPtUpdates.length}\u6761`);
            } else {
              log211.info(`[v614] SB\u5173\u952E\u8BCD\u62A5\u544A\u6570\u636E\u4E3A\u7A7A\uFF0C\u8DF3\u8FC7`);
            }
          } else {
            log211.debug(`[v614] \u8D26\u6237\u65E0SB\u5E7F\u544A\u6D3B\u52A8\uFF0C\u8DF3\u8FC7SB\u5173\u952E\u8BCD\u7EE9\u6548\u540C\u6B65`);
          }
        } catch (sbKwError) {
          log211.warn(`[v614] SB\u5173\u952E\u8BCD\u7EE9\u6548\u540C\u6B65\u5F02\u5E38(\u975E\u81F4\u547D): ${sbKwError.message}`);
        }
        return synced;
      } catch (error48) {
        const errorInfo = {
          message: error48.message || "Unknown error",
          // @ts-expect-error - Axios error response access
          status: error48.status || error48.response?.status,
          code: error48.code,
          // @ts-expect-error - runtime type mismatch
          url: error48.config?.url,
          // @ts-expect-error - Axios error response access
          responseData: error48.response?.data ? JSON.stringify(error48.response.data).substring(0, 500) : void 0
        };
        log211.warn(`[v242] \u5173\u952E\u8BCD\u7EE9\u6548\u540C\u6B65\u5931\u8D25(marketplace=${this.marketplace}): ${JSON.stringify(errorInfo)}`);
        throw error48;
      }
    };
    AmazonSyncService.prototype.syncProductTargetPerformanceData = async function(days) {
      log211.info("\u5546\u54C1\u5B9A\u4F4D\u7EE9\u6548\u6570\u636E\u5DF2\u5728syncKeywordPerformanceData\u4E2D\u4E00\u5E76\u5904\u7406");
      return 0;
    };
    AmazonSyncService.prototype.generateHourlyFromDaily = async function(startDate, endDate) {
      const db = await getDb();
      if (!db) throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
      const HOURLY_TRAFFIC = [
        0.012,
        8e-3,
        6e-3,
        5e-3,
        5e-3,
        8e-3,
        0.015,
        0.025,
        0.04,
        0.065,
        0.072,
        0.068,
        0.055,
        0.062,
        0.058,
        0.052,
        0.048,
        0.045,
        0.05,
        0.065,
        0.075,
        0.07,
        0.055,
        0.036
      ];
      const CVR_FACTOR = [
        0.6,
        0.5,
        0.45,
        0.4,
        0.4,
        0.55,
        0.7,
        0.8,
        0.9,
        1.05,
        1.1,
        1.05,
        0.95,
        1.1,
        1.05,
        1,
        0.95,
        0.9,
        1,
        1.15,
        1.2,
        1.15,
        1,
        0.8
      ];
      try {
        const dailyData = await db.execute(sql`
 SELECT dp.* FROM daily_performance dp
 LEFT JOIN (
 SELECT DISTINCT accountId, campaignId, DATE(date) AS dt
 FROM hourly_performance
 WHERE accountId = ${this.accountId}
 ) hp ON dp.accountId = hp.accountId 
 AND dp.campaignId = hp.campaignId 
 AND DATE(dp.date) = hp.dt
 WHERE dp.accountId = ${this.accountId}
 AND DATE(dp.date) >= ${startDate}
 AND DATE(dp.date) <= ${endDate}
 AND (dp.impressions > 0 OR dp.clicks > 0)
 AND hp.dt IS NULL
 `);
        const rows = dailyData?.[0] || dailyData;
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
          log211.debug("v195: \u6CA1\u6709\u65B0\u7684daily\u6570\u636E\u9700\u8981\u751F\u6210hourly");
          return 0;
        }
        log211.debug(`v195: \u627E\u5230 ${rows.length} \u6761\u7F3A\u5C11hourly\u6570\u636E\u7684daily\u8BB0\u5F55`);
        let insertedCount = 0;
        let batch = [];
        for (const daily of rows) {
          const dateObj = new Date(daily.date);
          const dayOfWeek = dateObj.getDay();
          const totalImp = daily.impressions || 0;
          const totalClk = daily.clicks || 0;
          const totalSpend = parseFloat(String(daily.spend || "0"));
          const totalSales = parseFloat(String(daily.sales || "0"));
          const totalOrders = daily.orders || 0;
          if (totalImp === 0 && totalClk === 0) continue;
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const dist = HOURLY_TRAFFIC.map((base) => {
            if (isWeekend) return base * 0.7 + 1 / 24 * 0.3;
            return base;
          });
          const distSum = dist.reduce((a, b) => a + b, 0);
          const dateStr = typeof daily.date === "string" ? daily.date.split("T")[0].split(" ")[0] : dateObj.toISOString().split("T")[0];
          for (let h = 0; h < 24; h++) {
            const w = dist[h] / distSum;
            const noise = 0.88 + Math.random() * 0.24;
            const wn = w * noise;
            const cvr = CVR_FACTOR[h];
            const imp = Math.round(totalImp * wn);
            const clk = Math.min(Math.round(totalClk * wn * cvr), imp);
            const sp = Math.round(totalSpend * wn * cvr * 100) / 100;
            const sal = Math.round(totalSales * wn * cvr * 100) / 100;
            const ord = Math.min(Math.round(totalOrders * wn * cvr), clk);
            if (imp === 0 && clk === 0) continue;
            batch.push({
              accountId: daily.accountId,
              campaignId: String(daily.campaignId),
              date: dateStr,
              hour: h,
              dayOfWeek,
              impressions: imp,
              clicks: clk,
              spend: sp.toFixed(2),
              sales: sal.toFixed(2),
              orders: ord,
              hourlyAcos: sal > 0 ? (sp / sal * 100).toFixed(2) : null,
              hourlyRoas: sp > 0 ? (sal / sp).toFixed(2) : null,
              hourlyCtr: imp > 0 ? (clk / imp).toFixed(4) : null,
              hourlyCvr: clk > 0 ? (ord / clk).toFixed(4) : null,
              hourlyCpc: clk > 0 ? (sp / clk).toFixed(2) : null
            });
            if (batch.length >= 500) {
              await db.insert(hourlyPerformance).values(batch).onDuplicateKeyUpdate({
                set: {
                  impressions: sql`VALUES(${hourlyPerformance.impressions})`,
                  clicks: sql`VALUES(${hourlyPerformance.clicks})`,
                  spend: sql`VALUES(${hourlyPerformance.spend})`,
                  sales: sql`VALUES(${hourlyPerformance.sales})`,
                  orders: sql`VALUES(${hourlyPerformance.orders})`,
                  hourlyAcos: sql`VALUES(${hourlyPerformance.hourlyAcos})`,
                  hourlyRoas: sql`VALUES(${hourlyPerformance.hourlyRoas})`,
                  hourlyCtr: sql`VALUES(${hourlyPerformance.hourlyCtr})`,
                  hourlyCvr: sql`VALUES(${hourlyPerformance.hourlyCvr})`,
                  hourlyCpc: sql`VALUES(${hourlyPerformance.hourlyCpc})`
                }
              });
              insertedCount += batch.length;
              batch = [];
            }
          }
        }
        if (batch.length > 0) {
          await db.insert(hourlyPerformance).values(batch).onDuplicateKeyUpdate({
            set: {
              impressions: sql`VALUES(${hourlyPerformance.impressions})`,
              clicks: sql`VALUES(${hourlyPerformance.clicks})`,
              spend: sql`VALUES(${hourlyPerformance.spend})`,
              sales: sql`VALUES(${hourlyPerformance.sales})`,
              orders: sql`VALUES(${hourlyPerformance.orders})`,
              hourlyAcos: sql`VALUES(${hourlyPerformance.hourlyAcos})`,
              hourlyRoas: sql`VALUES(${hourlyPerformance.hourlyRoas})`,
              hourlyCtr: sql`VALUES(${hourlyPerformance.hourlyCtr})`,
              hourlyCvr: sql`VALUES(${hourlyPerformance.hourlyCvr})`,
              hourlyCpc: sql`VALUES(${hourlyPerformance.hourlyCpc})`
            }
          });
          insertedCount += batch.length;
        }
        return insertedCount;
      } catch (error48) {
        log211.warn("v195: generateHourlyFromDaily\u5931\u8D25:", error48.message);
        throw error48;
      }
    };
    AmazonSyncService.prototype.syncAdGroupPerformanceData = async function(days = 14) {
      const db = await getDb();
      if (!db) throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
      let synced = 0;
      try {
        const MAX_DAYS_PER_REQUEST = 31;
        const totalDays = Math.min(days, 90);
        const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
        const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
        log211.info(`v339: \u5F00\u59CB\u540C\u6B65\u5E7F\u544A\u7EC4\u7EE9\u6548\u6570\u636E: \u5171${totalDays}\u5929\uFF0C\u5206${batches}\u6279\u8BF7\u6C42 (\u7AD9\u70B9: ${this.marketplace})`);
        const accountCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId, campaignType: campaigns.campaignType }).from(campaigns).where(eq(campaigns.accountId, this.accountId));
        const spCampaigns = accountCampaigns.filter((c) => c.campaignType === "sp_auto" || c.campaignType === "sp_manual");
        const sbCampaigns = accountCampaigns.filter((c) => c.campaignType === "sb");
        const sdCampaigns = accountCampaigns.filter((c) => c.campaignType === "sd");
        const allAdGroups = await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups).where(eq(adGroups.accountId, this.accountId));
        const adGroupMap = /* @__PURE__ */ new Map();
        for (const ag of allAdGroups) {
          adGroupMap.set(String(ag.adGroupId), ag);
        }
        log211.info(`v399-fix3: \u9884\u52A0\u8F7D ${allAdGroups.length} \u4E2AadGroups\u7528\u4E8E\u5E7F\u544A\u7EC4\u7EE9\u6548\u5339\u914D`);
        const fetchBatchedReport = /* @__PURE__ */ __name(async (requestFn, reportDays, reportName, groupByKey) => {
          const reportTotalDays = Math.min(reportDays, 90);
          const { startDate: rStart, endDate: rEnd } = getMarketplaceDateRange(this.marketplace, reportTotalDays);
          const rBatches = Math.ceil(reportTotalDays / MAX_DAYS_PER_REQUEST);
          if (rBatches === 1) {
            try {
              const reportId = await requestFn(rStart, rEnd);
              const data = await this.client.waitAndDownloadReport(reportId);
              return data || [];
            } catch (e) {
              log211.warn(`v413: ${reportName}\u62A5\u544A\u8BF7\u6C42\u5931\u8D25:`, e.message);
              return [];
            }
          }
          const batchRequests = [];
          for (let batch = 0; batch < rBatches; batch++) {
            const endDateObj = new Date(rEnd);
            endDateObj.setDate(endDateObj.getDate() - batch * MAX_DAYS_PER_REQUEST);
            const startDateObj = new Date(endDateObj);
            const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, reportTotalDays - batch * MAX_DAYS_PER_REQUEST);
            startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
            const bStart = startDateObj.toISOString().split("T")[0];
            const bEnd = endDateObj.toISOString().split("T")[0];
            batchRequests.push({
              // @ts-ignore
              name: `${reportName}\u7B2C${batch + 1}/${rBatches}\u6279(${bStart}~${bEnd})`,
              // @ts-ignore
              requestFn: /* @__PURE__ */ __name(() => requestFn(bStart, bEnd), "requestFn")
              // @ts-ignore
            });
          }
          log211.info(`[v413] ${reportName}: ${rBatches}\u6279\u6B21\u6279\u91CF\u63D0\u4EA4\u5F00\u59CB`);
          const results = await this.client.submitAndWaitMultipleReports(batchRequests, 12e5, 2e3);
          let allData = [];
          for (const result of results) {
            if (result.data && result.data.length > 0) {
              allData = allData.concat(result.data);
            } else if (result.error) {
              log211.warn(`[v413] ${result.name}\u5931\u8D25: ${result.error}`);
            }
          }
          if (groupByKey && rBatches > 1 && allData.length > 0) {
            const aggMap = /* @__PURE__ */ new Map();
            const numericFields = [
              "cost",
              "impressions",
              "clicks",
              "sales7d",
              "sales14d",
              "purchases7d",
              "purchases14d",
              "unitsSoldClicks7d",
              "unitsSoldSameSku7d",
              "unitsSoldOtherSku7d",
              "attributedSalesSameSku7d",
              "salesOtherSku7d",
              "sales",
              "purchases",
              "unitsSold",
              "dpv",
              "dpvClicks",
              "viewImpressions",
              "viewAttributedConversions14d",
              "viewAttributedSales14d",
              "viewAttributedUnitsOrdered14d"
            ];
            for (const row of allData) {
              const key = String(row[groupByKey] || "");
              if (!key) continue;
              const existing = aggMap.get(key);
              if (existing) {
                for (const f of numericFields) {
                  if (row[f] !== void 0 && row[f] !== null) {
                    existing[f] = (existing[f] || 0) + (row[f] || 0);
                  }
                }
              } else {
                aggMap.set(key, { ...row });
              }
            }
            const aggregated = Array.from(aggMap.values());
            log211.info(`[v395] ${reportName} SUMMARY\u805A\u5408: ${allData.length}\u6761 -> ${aggregated.length}\u6761`);
            return aggregated;
          }
          return allData;
        }, "fetchBatchedReport");
        if (spCampaigns.length > 0) {
          try {
            const spData = await fetchBatchedReport(
              // @ts-ignore
              (s, e) => this.client.requestSpAdGroupReport(s, e),
              // @ts-ignore
              totalDays,
              "SP\u5E7F\u544A\u7EC4",
              "adGroupId"
              // @ts-ignore
            );
            if (spData && spData.length > 0) {
              for (const row of spData) {
                const adGroupId = String(row.adGroupId);
                const adGroup = adGroupMap.get(adGroupId);
                if (!adGroup) continue;
                const cost = row.cost || 0;
                const sales = row.sales7d || 0;
                const orders = row.purchases7d || 0;
                const impressions = row.impressions || 0;
                const clicks = row.clicks || 0;
                await db.update(adGroups).set({
                  impressions,
                  clicks,
                  spend: String(cost),
                  sales: String(sales),
                  orders,
                  ctr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
                  cvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
                  acos: cost > 0 && sales > 0 ? String((cost / sales * 100).toFixed(2)) : null,
                  roas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
                  cpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null
                }).where(eq(adGroups.id, adGroup.id));
                synced++;
              }
              log211.info(`SP\u5E7F\u544A\u7EC4\u7EE9\u6548\u540C\u6B65: ${synced} \u6761\u8BB0\u5F55`);
            }
          } catch (error48) {
            log211.warn("SP\u5E7F\u544A\u7EC4\u7EE9\u6548\u540C\u6B65\u5931\u8D25:", error48);
          }
        }
        if (sbCampaigns.length > 0) {
          try {
            const sbData = await fetchBatchedReport(
              (s, e) => this.client.requestSbAdGroupReport(s, e),
              totalDays,
              "SB\u5E7F\u544A\u7EC4",
              "adGroupId"
            );
            if (sbData && sbData.length > 0) {
              let sbSynced = 0;
              for (const row of sbData) {
                const adGroupId = String(row.adGroupId);
                const adGroup = adGroupMap.get(adGroupId);
                if (!adGroup) continue;
                const cost = row.cost || 0;
                const sales = row.salesClicks14d || row.sales14d || 0;
                const orders = row.purchasesClicks14d || row.purchases14d || 0;
                const impressions = row.impressions || 0;
                const clicks = row.clicks || 0;
                const dpv = row.dpv14d || 0;
                const ntbOrders = row.attributedOrdersNewToBrand14d || 0;
                const ntbSales = row.attributedSalesNewToBrand14d || 0;
                await db.update(adGroups).set({
                  impressions,
                  clicks,
                  spend: String(cost),
                  sales: String(sales),
                  orders,
                  ctr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
                  cvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
                  acos: cost > 0 && sales > 0 ? String((cost / sales * 100).toFixed(2)) : null,
                  roas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
                  cpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
                  dpv,
                  ntbOrders,
                  ntbSales: String(ntbSales)
                }).where(eq(adGroups.id, adGroup.id));
                sbSynced++;
              }
              synced += sbSynced;
              log211.info(`SB\u5E7F\u544A\u7EC4\u7EE9\u6548\u540C\u6B65: ${sbSynced} \u6761\u8BB0\u5F55`);
            }
          } catch (error48) {
            log211.warn("SB\u5E7F\u544A\u7EC4\u7EE9\u6548\u540C\u6B65\u5931\u8D25:", error48);
          }
        }
        if (sdCampaigns.length > 0) {
          try {
            const sdData = await fetchBatchedReport(
              (s, e) => this.client.requestSdAdGroupReport(s, e),
              totalDays,
              "SD\u5E7F\u544A\u7EC4",
              "adGroupId"
            );
            if (sdData && sdData.length > 0) {
              let sdSynced = 0;
              for (const row of sdData) {
                const adGroupId = String(row.adGroupId);
                const adGroup = adGroupMap.get(adGroupId);
                if (!adGroup) continue;
                const cost = row.cost || 0;
                const sales = row.sales14d || 0;
                const orders = row.purchases14d || 0;
                const impressions = row.impressions || 0;
                const clicks = row.clicks || 0;
                const dpv = row.dpv14d || 0;
                const viewSales = row.viewAttributedSales14d || 0;
                const viewOrders = row.viewAttributedUnitsOrdered14d || 0;
                const ntbOrders = row.attributedOrdersNewToBrand14d || 0;
                const ntbSales = row.attributedSalesNewToBrand14d || 0;
                await db.update(adGroups).set({
                  impressions,
                  clicks,
                  spend: String(cost),
                  sales: String(sales),
                  orders,
                  ctr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
                  cvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
                  acos: cost > 0 && sales > 0 ? String((cost / sales * 100).toFixed(2)) : null,
                  roas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
                  cpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
                  dpv,
                  ntbOrders,
                  ntbSales: String(ntbSales),
                  viewAttributedSales: String(viewSales),
                  viewAttributedOrders: viewOrders
                }).where(eq(adGroups.id, adGroup.id));
                sdSynced++;
              }
              synced += sdSynced;
              log211.info(`SD\u5E7F\u544A\u7EC4\u7EE9\u6548\u540C\u6B65: ${sdSynced} \u6761\u8BB0\u5F55`);
            }
          } catch (error48) {
            log211.warn("SD\u5E7F\u544A\u7EC4\u7EE9\u6548\u540C\u6B65\u5931\u8D25:", error48);
          }
        }
        log211.info(`\u5E7F\u544A\u7EC4\u7EE9\u6548\u540C\u6B65\u5B8C\u6210: \u5171 ${synced} \u6761\u8BB0\u5F55`);
        return synced;
      } catch (error48) {
        log211.warn("\u5E7F\u544A\u7EC4\u7EE9\u6548\u540C\u6B65\u5931\u8D25:", error48);
        return synced;
      }
    };
    AmazonSyncService.prototype.syncPlacementPerformance = async function(days = 14) {
      const db = await getDb();
      if (!db) throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
      try {
        const MAX_DAYS_PER_REQUEST = 31;
        const totalDays = Math.min(days, 90);
        const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
        const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
        log211.info(`v339: \u5F00\u59CB\u540C\u6B65SP\u5E7F\u544A\u4F4D\u7F6E\u7EE9\u6548: \u5171${totalDays}\u5929\uFF0C\u5206${batches}\u6279\u8BF7\u6C42 (\u7AD9\u70B9: ${this.marketplace})`);
        let allReportData = [];
        if (batches === 1) {
          try {
            const reportId = await this.client.requestSpPlacementReport(rangeStartDate, rangeEndDate);
            const data = await this.client.waitAndDownloadReport(reportId, 6e5);
            if (data && data.length > 0) allReportData = data;
          } catch (e) {
            log211.warn(`v413: SP\u5E7F\u544A\u4F4D\u62A5\u544A\u8BF7\u6C42\u5931\u8D25:`, e.message);
          }
        } else {
          const batchRequests = [];
          for (let batch = 0; batch < batches; batch++) {
            const endDateObj = new Date(rangeEndDate);
            endDateObj.setDate(endDateObj.getDate() - batch * MAX_DAYS_PER_REQUEST);
            const startDateObj = new Date(endDateObj);
            const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - batch * MAX_DAYS_PER_REQUEST);
            startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
            const bStart = startDateObj.toISOString().split("T")[0];
            const bEnd = endDateObj.toISOString().split("T")[0];
            batchRequests.push({
              name: `SP\u5E7F\u544A\u4F4D\u7B2C${batch + 1}/${batches}\u6279(${bStart}~${bEnd})`,
              requestFn: /* @__PURE__ */ __name(() => this.client.requestSpPlacementReport(bStart, bEnd), "requestFn")
            });
          }
          log211.info(`[v413] SP\u5E7F\u544A\u4F4D: ${batches}\u6279\u6B21\u6279\u91CF\u63D0\u4EA4\u5F00\u59CB`);
          const results = await this.client.submitAndWaitMultipleReports(batchRequests, 12e5, 2e3);
          for (const result of results) {
            if (result.data && result.data.length > 0) {
              allReportData = allReportData.concat(result.data);
            } else if (result.error) {
              log211.warn(`[v413] ${result.name}\u5931\u8D25: ${result.error}`);
            }
          }
        }
        const reportData = allReportData;
        if (!reportData || reportData.length === 0) {
          log211.debug("v339: \u6240\u6709\u6279\u6B21SP\u5E7F\u544A\u4F4D\u62A5\u544A\u6570\u636E\u4E3A\u7A7A");
          return 0;
        }
        log211.info(`v339: \u5171\u83B7\u53D6\u5230 ${reportData.length} \u6761SP\u5E7F\u544A\u4F4D\u6570\u636E\uFF08${batches}\u6279\u5408\u5E76\uFF09`);
        if (reportData.length > 0) {
          const sampleRow = reportData[0];
          const allKeys = Object.keys(sampleRow);
          const placementKeys = allKeys.filter((k) => k.toLowerCase().includes("placement") || k.toLowerCase().includes("position") || k.toLowerCase().includes("location"));
          log211.info(`v351: SP\u5E7F\u544A\u4F4D\u62A5\u544A\u5B57\u6BB5\u8BCA\u65AD: allKeys=[${allKeys.join(",")}], placementKeys=[${placementKeys.join(",")}]`);
          log211.info(`v351: \u7B2C\u4E00\u6761\u6570\u636Eplacement\u503C: placementClassification="${sampleRow.placementClassification}", campaignPlacement="${sampleRow.campaignPlacement}", placement="${sampleRow.placement}"`);
          const placementDist = {};
          for (const r of reportData) {
            const raw = r.placementClassification || r.campaignPlacement || r.placement || "MISSING";
            placementDist[raw] = (placementDist[raw] || 0) + 1;
          }
          log211.info(`v351: placement\u503C\u5206\u5E03: ${JSON.stringify(placementDist)}`);
        }
        let synced = 0;
        const allCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId }).from(campaigns).where(eq(campaigns.accountId, this.accountId));
        const campaignMap = /* @__PURE__ */ new Map();
        for (const c of allCampaigns) {
          campaignMap.set(String(c.campaignId), c);
        }
        log211.info(`v399-fix3: \u9884\u52A0\u8F7D ${allCampaigns.length} \u4E2Acampaigns\u7528\u4E8E\u5E7F\u544A\u4F4D\u7EE9\u6548\u5339\u914D`);
        for (const row of reportData) {
          const campaign = campaignMap.get(String(row.campaignId));
          if (!campaign) continue;
          const placementMap = {
            // Amazon Ads API v3 标准值
            "TOP_OF_SEARCH": "top_of_search",
            "DETAIL_PAGE": "product_page",
            "OTHER": "rest_of_search",
            // Amazon Ads API v3 campaignPlacement groupBy 返回值
            "Top of Search on-Amazon": "top_of_search",
            "Detail Page on-Amazon": "product_page",
            "Other on-Amazon": "rest_of_search",
            // Amazon Ads API v3 新版报告格式 (2026年新增)
            "TOP_OF_SEARCH_ON_AMAZON": "top_of_search",
            "DETAIL_PAGE_ON_AMAZON": "product_page",
            "OTHER_ON_AMAZON": "rest_of_search",
            // 小写变体
            "top_of_search": "top_of_search",
            "product_page": "product_page",
            "rest_of_search": "rest_of_search",
            "detail_page": "product_page",
            "other": "rest_of_search",
            // Amazon Ads 报告中可能的其他变体
            "Top of search": "top_of_search",
            "Product page": "product_page",
            "Rest of search": "rest_of_search",
            "Remarketing off-Amazon": "rest_of_search",
            "REMARKETING_OFF_AMAZON": "rest_of_search"
          };
          const rawPlacement = row.placementClassification || row.campaignPlacement || row.placement || "OTHER";
          const placement = placementMap[rawPlacement] || "rest_of_search";
          if (!placementMap[rawPlacement]) {
            log211.warn(`v350: \u672A\u77E5\u7684\u5E7F\u544A\u4F4D\u7F6E\u503C: raw="${rawPlacement}", campaignId=${row.campaignId}, \u5DF2\u9ED8\u8BA4\u6620\u5C04\u4E3Arest_of_search (row keys: ${Object.keys(row).join(",")})`);
          } else {
            log211.debug(`v157: \u4F4D\u7F6E\u6620\u5C04: raw="${rawPlacement}" -> "${placement}"`);
          }
          const reportDate = row.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
          const { amazonId: amazonCampaignId } = extractCampaignIds(campaign, "syncPlacementPerformance");
          const cost = row.cost || 0;
          const sales = row.sales7d || row.sales14d || 0;
          const clicks = row.clicks || 0;
          const impressions = row.impressions || 0;
          const orders = row.purchases7d || row.purchases14d || 0;
          const perfData = {
            campaignId: guardCampaignIdInsert(amazonCampaignId, "placement_performance"),
            accountId: this.accountId,
            placement,
            date: reportDate,
            impressions,
            clicks,
            spend: String(cost),
            sales: String(sales),
            orders,
            ctr: impressions > 0 ? String(clicks / impressions) : null,
            cpc: clicks > 0 ? String(cost / clicks) : null,
            cvr: clicks > 0 ? String(orders / clicks) : null,
            acos: sales > 0 ? String(cost / sales * 100) : null,
            roas: cost > 0 ? String(sales / cost) : null,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          await db.insert(placementPerformance).values({
            ...perfData,
            createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          }).onDuplicateKeyUpdate({
            set: {
              impressions: perfData.impressions,
              clicks: perfData.clicks,
              spend: perfData.spend,
              sales: perfData.sales,
              orders: perfData.orders,
              ctr: perfData.ctr,
              cpc: perfData.cpc,
              cvr: perfData.cvr,
              acos: perfData.acos,
              roas: perfData.roas,
              updatedAt: perfData.updatedAt
            }
          });
          synced++;
        }
        log211.info(`\u4F4D\u7F6E\u7EE9\u6548\u540C\u6B65\u5B8C\u6210: ${synced} \u6761\u8BB0\u5F55`);
        return synced;
      } catch (error48) {
        log211.warn("\u540C\u6B65\u4F4D\u7F6E\u7EE9\u6548\u5931\u8D25:", error48);
        throw error48;
      }
    };
    AmazonSyncService.prototype.updateCampaignPerformanceSummary = async function() {
      const db = await getDb();
      if (!db) return;
      try {
        const accountCampaigns = await db.select().from(campaigns).where(eq(campaigns.accountId, this.accountId));
        if (accountCampaigns.length === 0) return;
        log211.info(`[v500.2] \u5F00\u59CB\u6279\u91CF\u66F4\u65B0 ${accountCampaigns.length} \u4E2A\u5E7F\u544A\u6D3B\u52A8\u7684\u7EE9\u6548\u6C47\u603B (\u7AD9\u70B9: ${this.marketplace})`);
        const { startDate: startDateStr, endDate: endDateStr } = getMarketplaceDateRange(this.marketplace, 30);
        const dailySummaries = await db.select({
          campaignId: dailyPerformance.campaignId,
          totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
          totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
          totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
          totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
          totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
        }).from(dailyPerformance).where(
          and(
            eq(dailyPerformance.accountId, this.accountId),
            sql`${dailyPerformance.campaignId} IS NOT NULL`,
            sql`${dailyPerformance.date} >= ${startDateStr}`,
            sql`${dailyPerformance.date} <= ${endDateStr}`
          )
        ).groupBy(dailyPerformance.campaignId);
        const summaryMap = /* @__PURE__ */ new Map();
        for (const s of dailySummaries) {
          if (s.campaignId) {
            summaryMap.set(s.campaignId, {
              totalImpressions: s.totalImpressions || 0,
              totalClicks: s.totalClicks || 0,
              totalSpend: parseFloat(s.totalSpend || "0"),
              totalSales: parseFloat(s.totalSales || "0"),
              totalOrders: s.totalOrders || 0
            });
          }
        }
        let updatedCount = 0;
        for (const campaign of accountCampaigns) {
          const summary = summaryMap.get(String(campaign.campaignId));
          const totalImpressions = summary?.totalImpressions || 0;
          const totalClicks = summary?.totalClicks || 0;
          const totalSpend = summary?.totalSpend || 0;
          const totalSales = summary?.totalSales || 0;
          const totalOrders = summary?.totalOrders || 0;
          await db.update(campaigns).set({
            impressions: totalImpressions,
            clicks: totalClicks,
            spend: String(totalSpend.toFixed(2)),
            sales: String(totalSales.toFixed(2)),
            orders: totalOrders,
            acos: totalSpend > 0 && totalSales > 0 ? String((totalSpend / totalSales * 100).toFixed(2)) : null,
            roas: totalSpend > 0 && totalSales > 0 ? String((totalSales / totalSpend).toFixed(2)) : null,
            ctr: totalImpressions > 0 ? String((totalClicks / totalImpressions).toFixed(4)) : null,
            cvr: totalClicks > 0 ? String((totalOrders / totalClicks).toFixed(4)) : null,
            cpc: totalClicks > 0 ? String((totalSpend / totalClicks).toFixed(2)) : null
          }).where(eq(campaigns.id, campaign.id));
          updatedCount++;
        }
        log211.info(`[v391] \u5E7F\u544A\u6D3B\u52A8\u7EE9\u6548\u6C47\u603B\u6279\u91CF\u66F4\u65B0\u5B8C\u6210: ${updatedCount}\u4E2A (SQL\u67E5\u8BE2\u4ECE${accountCampaigns.length * 2}+\u6B21\u51CF\u5C11\u52304\u6B21)`);
      } catch (error48) {
        log211.warn("[v391] \u66F4\u65B0\u5E7F\u544A\u6D3B\u52A8\u7EE9\u6548\u6C47\u603B\u5931\u8D25:", error48);
      }
    };
  }
});

