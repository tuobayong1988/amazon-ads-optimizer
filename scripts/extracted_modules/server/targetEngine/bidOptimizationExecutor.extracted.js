// Extracted from production dist/index.js
// Original module: server/targetEngine/bidOptimizationExecutor.ts
// Lines: 1178

async function executeBidOptimization(config2, campaigns6, dryRun) {
  const details = [];
  let adjustmentsCount = 0;
  let safetyPausedCampaignCount = 0;
  let totalClicks = 0, totalOrders = 0, totalSpend = 0, totalSales = 0;

  // === v620-fix11: P1 EventCalendar - Check for promotional period ===
  let _v620_isPromotionalPeriod = false;
  let _v620_eventName = "";
  let _v620_bidDecreaseBlockCount = 0;
  let _v620_coreKeywordProtectCount = 0;
  let _v620_discoveryProtectCount = 0;
  try {
    const _v620_now = new Date();
    const _v620_month = _v620_now.getMonth() + 1;
    const _v620_day = _v620_now.getDate();
    // Built-in promotional calendar (Amazon major events)
    const _v620_events = [
      { name: "Prime Day", startMonth: 7, startDay: 10, endMonth: 7, endDay: 17 },
      { name: "Prime Big Deal Days", startMonth: 10, startDay: 8, endMonth: 10, endDay: 12 },
      { name: "Black Friday", startMonth: 11, startDay: 20, endMonth: 11, endDay: 30 },
      { name: "Cyber Monday", startMonth: 12, startDay: 1, endMonth: 12, endDay: 5 },
      { name: "Holiday Season", startMonth: 12, startDay: 10, endMonth: 12, endDay: 31 },
      { name: "New Year Sales", startMonth: 1, startDay: 1, endMonth: 1, endDay: 7 },
      { name: "Valentine's Day", startMonth: 2, startDay: 7, endMonth: 2, endDay: 15 },
      { name: "Mother's Day", startMonth: 4, startDay: 25, endMonth: 5, endDay: 12 },
      { name: "Father's Day", startMonth: 6, startDay: 8, endMonth: 6, endDay: 16 },
      { name: "Back to School", startMonth: 7, startDay: 25, endMonth: 8, endDay: 15 },
      { name: "Easter", startMonth: 3, startDay: 25, endMonth: 4, endDay: 5 },
      { name: "Spring Sale", startMonth: 3, startDay: 15, endMonth: 3, endDay: 25 }
    ];
    // Also check database for custom events
    try {
      const _v620_customEvents = await v620RawQuery(
        "SELECT eventName, startDate, endDate FROM event_calendar WHERE accountId = ? AND endDate >= CURDATE() AND startDate <= CURDATE()",
        [config2.accountId]
      );
      if (_v620_customEvents && _v620_customEvents.length > 0) {
        _v620_isPromotionalPeriod = true;
        _v620_eventName = _v620_customEvents[0].eventName || "Custom Event";
      }
    } catch (_v620_dbErr) {
      // event_calendar table may not exist yet, fall through to built-in calendar
    }
    if (!_v620_isPromotionalPeriod) {
      for (const evt of _v620_events) {
        const inRange = (_v620_month > evt.startMonth || (_v620_month === evt.startMonth && _v620_day >= evt.startDay)) &&
                        (_v620_month < evt.endMonth || (_v620_month === evt.endMonth && _v620_day <= evt.endDay));
        if (inRange) {
          _v620_isPromotionalPeriod = true;
          _v620_eventName = evt.name;
          break;
        }
      }
    }
    if (_v620_isPromotionalPeriod) {
      log101.warn(`[v620-EventCalendar] Promotional period detected: "${_v620_eventName}". Bid DECREASES will be blocked for performing keywords.`);
    }
  } catch (_v620_calErr) {
    log101.warn(`[v620-EventCalendar] Calendar check failed: ${_v620_calErr.message}, proceeding without promotional protection`);
  }

  // === v620-fix11: P1 CoreKeyword - Load core keyword list ===
  let _v620_coreKeywordIds = new Set();
  try {
    const _v620_coreKws = await v620RawQuery(
      "SELECT id FROM keywords WHERE accountId = ? AND isCoreKeyword = 1",
      [config2.accountId]
    );
    if (_v620_coreKws) {
      for (const kw of _v620_coreKws) { _v620_coreKeywordIds.add(kw.id); }
    }
    if (_v620_coreKeywordIds.size > 0) {
      log101.info(`[v620-CoreKeyword] Loaded ${_v620_coreKeywordIds.size} core keywords for protection`);
    }
  } catch (_v620_ckErr) {
    // isCoreKeyword column may not exist yet, that's OK
    log101.debug(`[v620-CoreKeyword] Core keyword loading skipped: ${_v620_ckErr.message}`);
  }

  // === v620-fix11: P1 DiscoveryGovernor - Load recently discovered keywords (< 14 days old) ===
  let _v620_discoveryKeywordIds = new Set();
  try {
    const _v620_newKws = await v620RawQuery(
      "SELECT id FROM keywords WHERE accountId = ? AND createdAt >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND keywordStatus = 'enabled'",
      [config2.accountId]
    );
    if (_v620_newKws) {
      for (const kw of _v620_newKws) { _v620_discoveryKeywordIds.add(kw.id); }
    }
    if (_v620_discoveryKeywordIds.size > 0) {
      log101.info(`[v620-DiscoveryGovernor] ${_v620_discoveryKeywordIds.size} keywords in 14-day attribution window (protected from bid decrease)`);
    }
  } catch (_v620_dgErr) {
    log101.debug(`[v620-DiscoveryGovernor] Discovery keyword loading skipped: ${_v620_dgErr.message}`);
  }
  // === end v620-fix11 P1 preamble ===

  for (const c of campaigns6) {
    totalClicks += c.clicks || 0;
    totalOrders += c.orders || 0;
    totalSpend += parseFloat(c.spend || "0");
    totalSales += parseFloat(c.sales || "0");
  }
  let groupAvgCvr;
  let groupAvgCpc;
  let groupAvgAov;
  let cvrSource = "group_actual";
  if (totalClicks > 0) {
    groupAvgCvr = totalOrders / totalClicks;
    groupAvgCpc = totalSpend / totalClicks;
    groupAvgAov = totalOrders > 0 ? totalSales / totalOrders : 30;
  } else {
    groupAvgCpc = 0.8;
    groupAvgAov = 30;
    groupAvgCvr = 0.05;
    cvrSource = "hardcoded_fallback";
    try {
      const CATEGORY_CVR_BENCHMARK = {
        "electronics": 0.1,
        "computers": 0.09,
        "cell_phones": 0.08,
        "video_games": 0.12,
        "home_kitchen": 0.07,
        "sports_outdoors": 0.06,
        "toys_games": 0.1,
        "clothing": 0.04,
        "beauty": 0.08,
        "health": 0.07,
        "baby": 0.09,
        "pet_supplies": 0.08,
        "grocery": 0.18,
        "luxury": 0.03,
        "default": 0.08
      };
      const nameHintsForCvr = (config2.name || "").toLowerCase();
      const categoryKeywordsForCvr = {
        "electronics": ["electronic", "gadget", "device", "tech", "phone", "tablet", "laptop", "computer", "camera", "headphone", "speaker", "charger", "cable", "adapter"],
        "clothing": ["clothing", "apparel", "fashion", "shirt", "dress", "pants", "jacket", "shoes", "sneaker", "boot", "sock", "underwear", "hat", "scarf"],
        "beauty": ["beauty", "skincare", "makeup", "cosmetic", "serum", "cream", "lotion", "shampoo", "conditioner", "perfume", "fragrance"],
        "health": ["health", "supplement", "vitamin", "protein", "fitness", "wellness", "medical", "mask", "sanitizer"],
        "home_kitchen": ["home", "kitchen", "furniture", "decor", "appliance", "cookware", "bedding", "towel", "curtain", "rug", "mat", "storage", "organizer"],
        "sports_outdoors": ["sport", "outdoor", "camping", "hiking", "fishing", "yoga", "gym", "exercise", "bike", "golf", "running"],
        "toys_games": ["toy", "game", "puzzle", "lego", "doll", "action figure", "board game", "card game", "kids"],
        "baby": ["baby", "infant", "toddler", "diaper", "stroller", "crib", "pacifier", "bottle", "nursing"],
        "pet_supplies": ["pet", "dog", "cat", "fish", "bird", "aquarium", "leash", "collar", "treat", "food pet"],
        "grocery": ["grocery", "food", "snack", "beverage", "coffee", "tea", "organic", "gluten", "vegan"],
        "luxury": ["luxury", "premium", "designer", "gold", "silver", "diamond", "jewelry", "watch", "handbag"]
      };
      let earlyCategory = "default";
      for (const [cat, kws] of Object.entries(categoryKeywordsForCvr)) {
        if (kws.some((kw) => nameHintsForCvr.includes(kw))) {
          earlyCategory = cat;
          break;
        }
      }
      if (earlyCategory === "default") {
        for (const campaign of campaigns6) {
          const campName = (campaign.campaignName || "").toLowerCase();
          for (const [cat, kws] of Object.entries(categoryKeywordsForCvr)) {
            if (kws.some((kw) => campName.includes(kw))) {
              earlyCategory = cat;
              break;
            }
          }
          if (earlyCategory !== "default") break;
        }
      }
      if (earlyCategory !== "default" && CATEGORY_CVR_BENCHMARK[earlyCategory]) {
        groupAvgCvr = CATEGORY_CVR_BENCHMARK[earlyCategory];
        cvrSource = `category_benchmark_${earlyCategory}`;
        log101.info(`[BidOptimization] v330 \u51B7\u542F\u52A8CVR\u56DE\u9000Level1: \u4F7F\u7528\u54C1\u7C7B\u57FA\u51C6 ${earlyCategory}=${(groupAvgCvr * 100).toFixed(1)}%`);
      } else {
        const accountMetrics = await getAccountLevelMetrics(config2.accountId);
        if (accountMetrics && accountMetrics.accountAvgCvr > 0) {
          groupAvgCvr = accountMetrics.accountAvgCvr;
          groupAvgCpc = accountMetrics.accountAvgCpc || groupAvgCpc;
          groupAvgAov = accountMetrics.accountAvgAov || groupAvgAov;
          cvrSource = "account_level_30d";
          log101.info(`[BidOptimization] v330 \u51B7\u542F\u52A8CVR\u56DE\u9000Level2: \u4F7F\u7528\u8D26\u6237\u7EA7\u522B30\u5929CVR=${(groupAvgCvr * 100).toFixed(2)}% (clicks=${accountMetrics.totalClicks}, orders=${accountMetrics.totalOrders})`);
        } else {
          const crossMetrics = await getCrossCampaignCategoryMetrics(config2.accountId, config2.performanceGroupId);
          if (crossMetrics && crossMetrics.crossCampaignCvr > 0) {
            groupAvgCvr = crossMetrics.crossCampaignCvr;
            cvrSource = "cross_campaign_30d";
            log101.info(`[BidOptimization] v330 \u51B7\u542F\u52A8CVR\u56DE\u9000Level3: \u4F7F\u7528\u8DE8\u6D3B\u52A8CVR=${(groupAvgCvr * 100).toFixed(2)}% (clicks=${crossMetrics.totalClicks}, orders=${crossMetrics.totalOrders})`);
          } else {
            groupAvgCvr = CATEGORY_CVR_BENCHMARK["default"];
            cvrSource = "category_benchmark_default";
            log101.info(`[BidOptimization] v330 \u51B7\u542F\u52A8CVR\u56DE\u9000: \u6240\u6709\u56DE\u9000\u5747\u65E0\u6570\u636E\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u54C1\u7C7B\u57FA\u51C6=${(groupAvgCvr * 100).toFixed(1)}%`);
          }
        }
      }
    } catch (fallbackErr) {
      log101.warn(`[BidOptimization] v330 \u51B7\u542F\u52A8CVR\u56DE\u9000\u5F02\u5E38: ${fallbackErr.message}\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u503C0.08`);
      groupAvgCvr = 0.08;
      cvrSource = "error_fallback";
    }
  }
  log101.info(`[BidOptimization] v330 CVR\u4F30\u7B97: groupAvgCvr=${(groupAvgCvr * 100).toFixed(2)}%, source=${cvrSource}, totalClicks=${totalClicks}`);
  let suggestedBidData = null;
  try {
    const allBids = [];
    for (const campaign of campaigns6) {
      const camp = campaign;
      const adGroups6 = camp.adGroups;
      if (!adGroups6) continue;
      for (const adGroup of adGroups6) {
        const kws = adGroup.keywords;
        if (kws) {
          for (const kw of kws) {
            const sb = Number(kw.suggestedBid);
            if (sb > 0) {
              allBids.push({
                bid: sb,
                low: Number(kw.suggestedBidLow) || 0,
                high: Number(kw.suggestedBidHigh) || 0
              });
            }
          }
        }
        const tgts = adGroup.targets;
        if (tgts) {
          for (const tgt of tgts) {
            const sb = Number(tgt.suggestedBid);
            if (sb > 0) {
              allBids.push({
                bid: sb,
                low: Number(tgt.suggestedBidLow) || 0,
                high: Number(tgt.suggestedBidHigh) || 0
              });
            }
          }
        }
      }
    }
    if (allBids.length > 0) {
      allBids.sort((a, b) => a.bid - b.bid);
      const medianIdx = Math.floor(allBids.length / 2);
      const median = allBids.length % 2 === 1 ? allBids[medianIdx] : {
        bid: (allBids[medianIdx - 1].bid + allBids[medianIdx].bid) / 2,
        low: (allBids[medianIdx - 1].low + allBids[medianIdx].low) / 2,
        high: (allBids[medianIdx - 1].high + allBids[medianIdx].high) / 2
      };
      suggestedBidData = {
        suggestedBid: Math.round(median.bid * 100) / 100,
        rangeStart: Math.round(median.low * 100) / 100,
        rangeEnd: Math.round(median.high * 100) / 100
      };
      log101.info(`[BidOptimization] v491: \u4ECE${allBids.length}\u4E2A\u5B9E\u4F53\u7684\u5EFA\u8BAE\u7ADE\u4EF7\u4E2D\u53D6\u4E2D\u4F4D\u6570 suggestedBid=$${suggestedBidData.suggestedBid}, range=[$${suggestedBidData.rangeStart}-$${suggestedBidData.rangeEnd}]`);
    } else {
      log101.info(`[BidOptimization] v491: \u6240\u6709campaigns/adGroups\u4E2D\u672A\u627E\u5230\u6709\u6548\u7684\u5EFA\u8BAE\u7ADE\u4EF7\u6570\u636E`);
    }
  } catch (dbBidErr) {
    log101.debug(`[BidOptimization] v491: \u4ECE\u6570\u636E\u5E93\u8BFB\u53D6\u5EFA\u8BAE\u7ADE\u4EF7\u5931\u8D25: ${dbBidErr.message}`);
  }
  if (!suggestedBidData && totalClicks === 0) {
    try {
      const syncService = await getAmazonSyncService2(config2.accountId);
      if (syncService && syncService.client) {
        const firstCampaign = campaigns6[0];
        if (firstCampaign && firstCampaign.adGroups && firstCampaign.adGroups.length > 0) {
          const adGroupId = String(firstCampaign.adGroups[0].amazonAdGroupId || firstCampaign.adGroups[0].adGroupId);
          if (adGroupId) {
            try {
              const keywordRecs = await syncService.client.getKeywordBidRecommendations(
                // @ts-ignore
                adGroupId,
                [{ keyword: config2.name || "product", matchType: "BROAD" }]
                // @ts-ignore
              );
              if (keywordRecs && keywordRecs.length > 0) {
                const rec = keywordRecs[0];
                suggestedBidData = {
                  // @ts-ignore
                  suggestedBid: rec.suggestedBid,
                  // @ts-ignore
                  rangeStart: rec.rangeStart,
                  // @ts-ignore
                  rangeEnd: rec.rangeEnd
                };
                log101.info(`[BidOptimization] v436 R-01: API\u83B7\u53D6\u5230\u5EFA\u8BAE\u51FA\u4EF7 suggestedBid=$${rec.suggestedBid}, range=[$${rec.rangeStart}-$${rec.rangeEnd}]`);
              }
            } catch (kwBidErr) {
              log101.debug(`[BidOptimization] v436 R-01: \u5173\u952E\u8BCD\u5EFA\u8BAE\u51FA\u4EF7\u83B7\u53D6\u5931\u8D25: ${kwBidErr.message}`);
              try {
                const campaignId = String(firstCampaign.amazonCampaignId || firstCampaign.campaignId || "");
                const localRec = await getLocalKeywordBidRecommendation(
                  config2.accountId,
                  adGroupId,
                  campaignId,
                  "sponsoredProducts",
                  config2.targetAcos || 0.3
                );
                if (localRec.source !== "minimum_default") {
                  suggestedBidData = {
                    suggestedBid: localRec.suggestedBid,
                    rangeStart: localRec.rangeStart,
                    rangeEnd: localRec.rangeEnd
                  };
                  log101.info(`[BidOptimization] v457: \u672C\u5730\u63A8\u8350\u5F15\u64CE\u63D0\u4F9B\u5EFA\u8BAE\u51FA\u4EF7 $${localRec.suggestedBid.toFixed(2)} (${localRec.source}, confidence=${localRec.confidence.toFixed(2)}, samples=${localRec.sampleSize})`);
                }
              } catch (localRecErr) {
                log101.debug(`[BidOptimization] v457: \u672C\u5730\u63A8\u8350\u5F15\u64CE\u5F02\u5E38: ${localRecErr.message}`);
              }
            }
          }
        }
      }
    } catch (suggestedBidErr) {
      log101.debug(`[BidOptimization] v436 R-01: \u5EFA\u8BAE\u51FA\u4EF7API\u8C03\u7528\u5F02\u5E38: ${suggestedBidErr.message}`);
    }
  }
  let inferredCategory = "default";
  try {
    const nameHints = (config2.name || "").toLowerCase();
    const categoryKeywords = {
      "electronics": ["electronic", "gadget", "device", "tech", "phone", "tablet", "laptop", "computer", "camera", "headphone", "speaker", "charger", "cable", "adapter"],
      "clothing": ["clothing", "apparel", "fashion", "shirt", "dress", "pants", "jacket", "shoes", "sneaker", "boot", "sock", "underwear", "hat", "scarf"],
      "beauty": ["beauty", "skincare", "makeup", "cosmetic", "serum", "cream", "lotion", "shampoo", "conditioner", "perfume", "fragrance"],
      "health": ["health", "supplement", "vitamin", "protein", "fitness", "wellness", "medical", "mask", "sanitizer"],
      "home_kitchen": ["home", "kitchen", "furniture", "decor", "appliance", "cookware", "bedding", "towel", "curtain", "rug", "mat", "storage", "organizer"],
      "sports_outdoors": ["sport", "outdoor", "camping", "hiking", "fishing", "yoga", "gym", "exercise", "bike", "golf", "running"],
      "toys_games": ["toy", "game", "puzzle", "lego", "doll", "action figure", "board game", "card game", "kids"],
      "baby": ["baby", "infant", "toddler", "diaper", "stroller", "crib", "pacifier", "bottle", "nursing"],
      // @ts-ignore
      "pet_supplies": ["pet", "dog", "cat", "fish", "bird", "aquarium", "leash", "collar", "treat", "food pet"],
      "grocery": ["grocery", "food", "snack", "beverage", "coffee", "tea", "organic", "gluten", "vegan"],
      "luxury": ["luxury", "premium", "designer", "gold", "silver", "diamond", "jewelry", "watch", "handbag"]
    };
    for (const [cat, keywords10] of Object.entries(categoryKeywords)) {
      if (keywords10.some((kw) => nameHints.includes(kw))) {
        inferredCategory = cat;
        break;
      }
    }
    if (inferredCategory === "default") {
      for (const campaign of campaigns6) {
        const campName = (campaign.campaignName || "").toLowerCase();
        for (const [cat, keywords10] of Object.entries(categoryKeywords)) {
          if (keywords10.some((kw) => campName.includes(kw))) {
            inferredCategory = cat;
            break;
          }
        }
        if (inferredCategory !== "default") break;
      }
    }
    log101.info(`[BidOptimization] v267 P3-3: \u54C1\u7C7B\u63A8\u65AD\u7ED3\u679C=${inferredCategory} (\u4F18\u5316\u76EE\u6807: ${config2.name})`);
  } catch (catErr) {
    log101.warn(`[BidOptimization] v267 P3-3: \u54C1\u7C7B\u63A8\u65AD\u5931\u8D25: ${catErr.message}`);
  }
  const bidConfig = {
    optimizationGoal: config2.optimizationGoal,
    // v170: 传入策略模板名称，用于策略感知的参数差异化
    strategyTemplate: config2.strategyTemplateId,
    targetAcos: config2.targetAcos,
    targetRoas: config2.targetRoas,
    dailyBudget: config2.dailyBudget,
    maxBid: config2.maxBid,
    groupAvgCvr,
    groupAvgCpc,
    groupAvgAov,
    // v267 P3-3: 多品类自适应
    productCategory: inferredCategory
  };
  if (suggestedBidData) {
    bidConfig._suggestedBid = suggestedBidData.suggestedBid;
    bidConfig._suggestedBidRangeStart = suggestedBidData.rangeStart;
    bidConfig._suggestedBidRangeEnd = suggestedBidData.rangeEnd;
  }
  bidConfig._cvrSource = cvrSource;
  try {
    const evoParams = await getAdaptiveOptimizationParams(config2.id, config2.strategyTemplateId);
    bidConfig._evolvedMaxChangePercent = evoParams.maxBidIncrease;
    bidConfig._evolvedMaxDecreasePercent = evoParams.maxBidDecrease;
    bidConfig._confidenceMultiplier = evoParams.confidenceMultiplier;
    log101.info(`[BidOptimization] v164: \u81EA\u9002\u5E94\u53C2\u6570\u5DF2\u6CE8\u5165 - \u6700\u5927\u63D0\u5347${Math.round(evoParams.maxBidIncrease * 100)}%, \u6700\u5927\u964D\u4F4E${Math.round(evoParams.maxBidDecrease * 100)}%, \u6210\u529F\u7387${Math.round(evoParams.recentSuccessRate * 100)}%`);
  } catch (e) {
    log101.warn(`[BidOptimization] v164: \u81EA\u9002\u5E94\u53C2\u6570\u83B7\u53D6\u5931\u8D25\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u503C: ${e.message}`);
  }
  const currentDate = /* @__PURE__ */ new Date();
  const cpcMaxBidLimit = config2.maxBid || 2;
  const vcpmMaxBidLimit = config2.maxBid ? config2.maxBid * 5 : 15;
  log101.info(`[BidOptimization] v165: CPC\u6700\u9AD8\u51FA\u4EF7=$${cpcMaxBidLimit} | VCPM\u6700\u9AD8\u51FA\u4EF7=$${vcpmMaxBidLimit} (\u7528\u6237\u8BBE\u7F6Emax_bid=${config2.maxBid || "\u672A\u8BBE\u7F6E"})`);
  log101.debug(`[BidOptimization] v165: \u65E5\u9884\u7B97=${config2.dailyBudget || "\u672A\u8BBE\u7F6E"}, \u76EE\u6807ACoS=${config2.targetAcos || "\u672A\u8BBE\u7F6E"}`);
  let bidCampaignIndex = 0;
  for (const campaign of campaigns6) {
    if (bidCampaignIndex > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5e3));
    }
    bidCampaignIndex++;
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    let campaignDailyData = [];
    let campaignTimeWeightedMetrics = null;
    try {
      const endDate = /* @__PURE__ */ new Date();
      const startDate = /* @__PURE__ */ new Date();
      startDate.setDate(startDate.getDate() - 90);
      const rawDailyData = await getDailyPerformanceByDateRange(config2.accountId, startDate, endDate, campaignAmazonId);
      campaignDailyData = rawDailyData.map((d) => ({
        date: new Date(d.date),
        spend: parseFloat(String(d.spend || "0")),
        sales: parseFloat(String(d.sales || "0")),
        clicks: d.clicks || 0,
        orders: d.orders || 0
      }));
      const dailyDataForWeighting = rawDailyData.map((d) => ({
        date: typeof d.date === "string" ? d.date : new Date(d.date).toISOString(),
        impressions: d.impressions || 0,
        clicks: d.clicks || 0,
        spend: parseFloat(String(d.spend || "0")),
        sales: parseFloat(String(d.sales || "0")),
        orders: d.orders || 0
      }));
      const cliffAwareMetrics = calculateCliffAwareTimeWeightedMetrics(dailyDataForWeighting);
      campaignTimeWeightedMetrics = cliffAwareMetrics;
      if (cliffAwareMetrics.cliffDetection.cliffDetected) {
        log101.warn(`[BidOptimization] v491: Campaign ${campaignLocalId} ${cliffAwareMetrics.cliffDetection.diagnosis}`);
      }
      log101.debug(`[BidOptimization] v163: Campaign ${campaignLocalId} \u65F6\u95F4\u8870\u51CF\u52A0\u6743 - \u52A0\u6743ACoS=${campaignTimeWeightedMetrics.weightedAcos.toFixed(1)}%, \u52A0\u6743ROAS=${campaignTimeWeightedMetrics.weightedRoas.toFixed(2)}, \u7F6E\u4FE1\u5EA6=${campaignTimeWeightedMetrics.dataQuality.confidenceLevel}, \u8D8B\u52BF=${campaignTimeWeightedMetrics.trendSignal.direction}`);
    } catch (e) {
      log101.warn(`[BidOptimization] \u83B7\u53D6campaign ${campaignLocalId} \u5386\u53F2\u6570\u636E\u5931\u8D25: ${e.message}`);
    }
    if (campaignTimeWeightedMetrics) {
      const safetyCheck = performSafetyCheck(campaignTimeWeightedMetrics);
      if (safetyCheck.shouldPause) {
        log101.warn(`[BidOptimization] v163: Campaign ${campaignLocalId} \u5B89\u5168\u68C0\u67E5\u89E6\u53D1\u6682\u505C: ${safetyCheck.reason}`);
        details.push({
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          // @ts-ignore
          campaignName: campaign.campaignName,
          action: "safety_pause",
          algorithmUsed: "safety_guard",
          // v335
          reason: `[\u5B89\u5168\u68C0\u67E5] ${safetyCheck.warnings.join("\uFF1B")}`
        });
        safetyPausedCampaignCount++;
        log101.warn(`[BidOptimization] v244: Campaign ${campaignLocalId} (${campaign.campaignName}) \u5B89\u5168\u68C0\u67E5\u89E6\u53D1\uFF0C\u8DF3\u8FC7\u8BE5campaign\u7684\u51FA\u4EF7\u4F18\u5316\uFF08\u4E0D\u6682\u505C\u6574\u4E2A\u4F18\u5316\u76EE\u6807\uFF09`);
        continue;
      }
      if (safetyCheck.warnings.length > 0) {
        log101.info(`[BidOptimization] v163: Campaign ${campaignLocalId} \u5B89\u5168\u8B66\u544A: ${safetyCheck.warnings.join("\uFF1B")}`);
      }
    }
    const isVcpmCampaign = campaign.costType === "vcpm";
    const maxBidLimit = isVcpmCampaign ? vcpmMaxBidLimit : cpcMaxBidLimit;
    if (isVcpmCampaign) {
      log101.info(`[BidOptimization] v165: Campaign ${campaignLocalId} \u8BC6\u522B\u4E3AVCPM\u5E7F\u544A\uFF0C\u4F7F\u7528VCPM\u6700\u9AD8\u51FA\u4EF7$${maxBidLimit}`);
    }
    const keywords10 = await getKeywordsByCampaignId(campaignAmazonId);
    const keywordTargets = [];
    for (const keyword of keywords10) {
      if (keyword.keywordStatus === "amazon_deleted") continue;
      if (keyword.keywordStatus !== "enabled") continue;
      const currentBid = parseFloat(keyword.bid || "0");
      if (currentBid <= 0) continue;
      const kwLastOptimized = keyword.lastOptimizedAt ? new Date(keyword.lastOptimizedAt) : null;
      const kwBidSyncStatus = keyword.bidSyncStatus || "synced";
      if (kwLastOptimized && kwBidSyncStatus === "pending_confirmation") {
        const hoursSinceOptimized = (Date.now() - kwLastOptimized.getTime()) / (1e3 * 60 * 60);
        if (hoursSinceOptimized < 24) {
          log101.info(`[BidOptimization] v166: \u8DF3\u8FC7\u5173\u952E\u8BCD ${keyword.id} "${keyword.keywordText}" - \u51B7\u5374\u671F\u5185(${hoursSinceOptimized.toFixed(1)}h), \u51FA\u4EF7\u5F85\u786E\u8BA4 pending=$${keyword.pendingBid}`);
          continue;
        }
      }
      keywordTargets.push({
        id: keyword.id,
        type: "keyword",
        currentBid,
        impressions: keyword.impressions || 0,
        clicks: keyword.clicks || 0,
        spend: parseFloat(keyword.spend || "0"),
        sales: parseFloat(keyword.sales || "0"),
        orders: keyword.orders || 0,
        matchType: keyword.matchType,
        // @ts-ignore
        campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : void 0,
        // @ts-ignore
        historicalAvgImpressions: campaign.impressions ? Math.round(campaign.impressions / 30) : void 0,
        // v163: 基于30天估算
        // v163: 传入campaign级别的90天每日数据用于时间衰减加权分析
        dailyData: campaignDailyData.length > 0 ? campaignDailyData : void 0,
        marketplace: config2.marketplace,
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // v491: 传入每个keyword自身的suggestedBid/Low/High，供Nash引擎和冷启动引擎使用
        // @ts-ignore
        suggestedBid: keyword.suggestedBid ? parseFloat(String(keyword.suggestedBid)) : void 0,
        // @ts-ignore
        suggestedBidRangeStart: keyword.suggestedBidLow ? parseFloat(String(keyword.suggestedBidLow)) : void 0,
        suggestedBidRangeEnd: keyword.suggestedBidHigh ? parseFloat(String(keyword.suggestedBidHigh)) : void 0,
        keywordText: keyword.keywordText,
        // v515: 传入internalAdGroupId供RLDataRecorder和冷启动引擎使用
        internalAdGroupId: keyword.internalAdGroupId
      });
    }
    if (keywordTargets.length > 0) {
      const nextGenResults = await batchCalculateNextGenBids(
        config2.accountId,
        keywordTargets,
        bidConfig,
        maxBidLimit
      );
      // v601 P0-3: Log algorithm effect summary for keywords
      const kwChanges = nextGenResults.filter(r => r.newBid !== r.currentBid);
      log67.info(`[v601-AlgoEffect] Campaign ${campaign.campaignId} keywords: ${nextGenResults.length} targets, ${kwChanges.length} changed`);
      for (const nextGenResult of nextGenResults) {
        let finalBid = nextGenResult.newBid;
        const campType = campaign.campaignType || "sp_manual";
        const campCostType = campaign.costType || "cpc";
        const campAdFormat = campaign.ad_format || campaign.adFormat || null;
        const campMarketplace = config2.marketplace || "US";
        const { clampedBid: kwClampedBid, wasAdjusted: kwWasAdjusted, constraint: kwConstraint, adTypeKey: kwAdTypeKey } = clampBidToConstraint(finalBid, campType, campMarketplace, campCostType, campAdFormat);
        finalBid = Math.min(kwClampedBid, maxBidLimit);
        finalBid = Math.round(finalBid * 100) / 100;
        if (kwWasAdjusted) {
          log101.info(`[BidOptimization] v434: keyword ${nextGenResult.targetId} bid $${nextGenResult.newBid.toFixed(2)} \u8D85\u51FA${kwAdTypeKey}\u7EA6\u675F[$${kwConstraint.minBid}~$${kwConstraint.maxBid}]\uFF0C\u8C03\u6574\u4E3A$${finalBid} (marketplace=${campMarketplace})`);
        }
        if (finalBid > nextGenResult.previousBid) {
          const bidIncrease = finalBid - nextGenResult.previousBid;
          const bidIncreasePercent = nextGenResult.previousBid > 0 ? bidIncrease / nextGenResult.previousBid * 100 : Infinity;
          const COLD_START_MAX_ABSOLUTE_INCREASE = 0.5;
          const COLD_START_MAX_PERCENT_INCREASE = 200;
          const COLD_START_BID_THRESHOLD = 0.1;
          if (nextGenResult.previousBid <= COLD_START_BID_THRESHOLD && bidIncrease > COLD_START_MAX_ABSOLUTE_INCREASE) {
            const cappedBid = Math.round((nextGenResult.previousBid + COLD_START_MAX_ABSOLUTE_INCREASE) * 100) / 100;
            log101.info(`[BidOptimization] v579: \u51B7\u542F\u52A8\u5E73\u6ED1\u671F\u52A0\u4EF7\u4FDD\u62A4 - keyword ${nextGenResult.targetId} $${nextGenResult.previousBid}\u2192$${finalBid}(+${bidIncreasePercent.toFixed(0)}%) \u8D85\u51FA\u7EDD\u5BF9\u503C\u4E0A\u9650$${COLD_START_MAX_ABSOLUTE_INCREASE}\uFF0C\u8C03\u6574\u4E3A$${cappedBid}`);
            finalBid = cappedBid;
          } else if (bidIncreasePercent > COLD_START_MAX_PERCENT_INCREASE && bidIncrease > COLD_START_MAX_ABSOLUTE_INCREASE) {
            const cappedBid = Math.round((nextGenResult.previousBid + COLD_START_MAX_ABSOLUTE_INCREASE) * 100) / 100;
            log101.info(`[BidOptimization] v579: \u52A0\u4EF7\u767E\u5206\u6BD4\u5F02\u5E38\u4FDD\u62A4 - keyword ${nextGenResult.targetId} $${nextGenResult.previousBid}\u2192$${finalBid}(+${bidIncreasePercent.toFixed(0)}%) \u8D85\u51FA${COLD_START_MAX_PERCENT_INCREASE}%\u4E14\u7EDD\u5BF9\u503C>$${COLD_START_MAX_ABSOLUTE_INCREASE}\uFF0C\u8C03\u6574\u4E3A$${cappedBid}`);
            finalBid = cappedBid;
          }
        }
        if (nextGenResult.actionType !== "hold" && Math.abs(finalBid - nextGenResult.previousBid) > 0.01) {
          if (finalBid > nextGenResult.previousBid) {
            try {
              const { isAccountBidIncreaseBlocked: isAccountBidIncreaseBlocked2 } = await Promise.resolve().then(() => (init_systemDefenseService(), systemDefenseService_exports));
              const blockCheck = await isAccountBidIncreaseBlocked2(config2.accountId);
              if (blockCheck.blocked) {
                log101.info(`[BidOptimization] v504: \u7CFB\u7EDF\u9632\u7EBF\u963B\u6B62\u52A0\u4EF7 - keyword ${nextGenResult.targetId} $${nextGenResult.previousBid}\u2192$${finalBid} \u88AB\u963B\u6B62. \u539F\u56E0: ${blockCheck.reason}`);
                continue;
              }
            } catch (defenseErr) {
              log101.warn(`[BidOptimization] v504: \u7CFB\u7EDF\u9632\u7EBF\u68C0\u67E5\u5F02\u5E38: ${defenseErr.message}`);
            }
          }
          if (nextGenResult.algorithmUsed) {
            try {
              const { isAlgorithmCircuitBroken: isAlgorithmCircuitBroken2 } = await Promise.resolve().then(() => (init_systemDefenseService(), systemDefenseService_exports));
              const isBroken = await isAlgorithmCircuitBroken2(nextGenResult.algorithmUsed);
              if (isBroken) {
                log101.info(`[BidOptimization] v504: \u7B97\u6CD5${nextGenResult.algorithmUsed}\u5DF2\u7194\u65AD\uFF0C\u8DF3\u8FC7\u5176\u51FA\u4EF7\u5EFA\u8BAE - keyword ${nextGenResult.targetId}`);
                continue;
              }
            } catch (algoErr) {
              log101.warn(`[BidOptimization] v504: \u7B97\u6CD5\u7194\u65AD\u68C0\u67E5\u5F02\u5E38: ${algoErr.message}`);
            }
          }
          const keyword = keywords10.find((k) => k.id === nextGenResult.targetId);
          details.push({
            keywordId: nextGenResult.targetId,
            amazonKeywordId: keyword?.keywordId || "",
            // v255: 传入真正的Amazon keyword ID，修复PostOptVerifier验证失败
            adGroupId: keyword?.internalAdGroupId,
            // v421: 使用internalAdGroupId(int)用于PostOptVerifier精确回查
            keywordText: keyword?.keywordText || `\u5173\u952E\u8BCD ${nextGenResult.targetId}`,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            currentBid: nextGenResult.previousBid,
            newBid: finalBid,
            changePercent: ((finalBid - nextGenResult.previousBid) / nextGenResult.previousBid * 100).toFixed(2),
            reason: nextGenResult.reason,
            algorithmUsed: nextGenResult.algorithmUsed,
            confidenceScore: nextGenResult.confidence,
            algorithmTier: nextGenResult.algorithmTier,
            // v258: 传递结构化归因和护栏信息
            reasonDetails: nextGenResult.reasonDetails,
            guardrailInfo: nextGenResult.guardrailInfo,
            // v337: 传递修正层标记和Meta-Learning决策详情
            correctionLayers: nextGenResult.correctionLayers,
            metaLearningDetail: nextGenResult.metaLearningDetail,
            gtoModifier: nextGenResult.gtoModifier,
            causalAdjustment: nextGenResult.causalAdjustment,
            // v512: 传递campaignType用于SB/SD验证路由
            campaignType: campaign.campaignType || "sp"
          });
          if (!dryRun) adjustmentsCount++;
        }
      }
    }
    const adGroupsList = await getAdGroupsByCampaignId(campaignAmazonId);
    const productTargets5 = [];
    const allTargets = [];
    const adGroupIds = adGroupsList.map((ag) => ag.id);
    const allTargetsFromDb = await getProductTargetsByAdGroupIds(adGroupIds);
    for (const target of allTargetsFromDb) {
      if (target.targetStatus !== "enabled") continue;
      let currentBid = parseFloat(target.bid || "0");
      const AUTO_TARGET_VALUES = ["CLOSE_MATCH", "LOOSE_MATCH", "SUBSTITUTES", "COMPLEMENTS"];
      const isAutoTarget = AUTO_TARGET_VALUES.includes(target.targetValue || "");
      if (currentBid <= 0) {
        if (isAutoTarget) {
          const parentAdGroup = adGroupsList.find((ag) => ag.id === target.internalAdGroupId);
          const defaultBid = parseFloat(parentAdGroup?.defaultBid || "0");
          if (defaultBid > 0) {
            currentBid = defaultBid;
            log101.info(`[v512] \u81EA\u52A8\u5E7F\u544A\u5339\u914D\u5BF9\u8C61 ${target.targetValue} (target ${target.id}) bid=0\uFF0C\u4F7F\u7528\u5E7F\u544A\u7EC4\u9ED8\u8BA4\u51FA\u4EF7 $${defaultBid}`);
          } else {
            log101.debug(`[v512] \u81EA\u52A8\u5E7F\u544A\u5339\u914D\u5BF9\u8C61 ${target.targetValue} (target ${target.id}) bid=0\u4E14\u5E7F\u544A\u7EC4\u9ED8\u8BA4\u51FA\u4EF7\u4E5F\u4E3A0\uFF0C\u8DF3\u8FC7`);
            continue;
          }
        } else {
          continue;
        }
      }
      allTargets.push(target);
      productTargets5.push({
        id: target.id,
        type: "product_target",
        currentBid,
        impressions: target.impressions || 0,
        clicks: target.clicks || 0,
        spend: parseFloat(target.spend || "0"),
        sales: parseFloat(target.sales || "0"),
        orders: target.orders || 0,
        matchType: target.targetMatchType || "exact",
        // @ts-ignore
        campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : void 0,
        // @ts-ignore
        historicalAvgImpressions: campaign.impressions ? Math.round(campaign.impressions / 30) : void 0,
        // v163
        dailyData: campaignDailyData.length > 0 ? campaignDailyData : void 0,
        marketplace: config2.marketplace,
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // v491: 传入每个target自身的suggestedBid/Low/High，供Nash引擎和冷启动引擎使用
        // @ts-ignore
        suggestedBid: target.suggestedBid ? parseFloat(String(target.suggestedBid)) : void 0,
        suggestedBidRangeStart: target.suggestedBidLow ? parseFloat(String(target.suggestedBidLow)) : void 0,
        suggestedBidRangeEnd: target.suggestedBidHigh ? parseFloat(String(target.suggestedBidHigh)) : void 0,
        // v515: 传入internalAdGroupId供RLDataRecorder和冷启动引擎使用
        internalAdGroupId: target.internalAdGroupId
      });
    }
    const sdAudienceTargets = [];
    const allSdAudiences = [];
    const campTypeStr = String(campaign.campaignType || "").toLowerCase();
    if (campTypeStr.includes("sd")) {
      try {
        const { getSdAudiencesByAdGroupIds: getSdAudiencesByAdGroupIds2 } = await Promise.resolve().then(() => (init_sdAudiences(), sdAudiences_exports));
        const sdAudiencesFromDb = await getSdAudiencesByAdGroupIds2(adGroupIds);
        for (const audience of sdAudiencesFromDb) {
          if (audience.state !== "enabled") continue;
          const currentBid = parseFloat(audience.bid || "0");
          if (currentBid <= 0) {
            const parentAdGroup = adGroupsList.find((ag) => ag.id === audience.internalAdGroupId);
            const defaultBid = parseFloat(parentAdGroup?.defaultBid || "0");
            if (defaultBid <= 0) continue;
            log101.info(`[v512] SD\u53D7\u4F17 ${audience.audienceType} (id=${audience.id}) bid=0\uFF0C\u4F7F\u7528\u5E7F\u544A\u7EC4\u9ED8\u8BA4\u51FA\u4EF7 $${defaultBid}`);
            allSdAudiences.push(audience);
            sdAudienceTargets.push({
              // @ts-ignore
              id: audience.id,
              type: "product_target",
              // 复用product_target类型，因为SD受众在Amazon API中也是target
              currentBid: defaultBid,
              impressions: audience.impressions || 0,
              clicks: audience.clicks || 0,
              spend: parseFloat(audience.spend || "0"),
              sales: parseFloat(audience.sales || "0"),
              orders: audience.orders || 0,
              matchType: "exact",
              // @ts-ignore
              campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : void 0,
              dailyData: campaignDailyData.length > 0 ? campaignDailyData : void 0,
              marketplace: config2.marketplace,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // v515: 传入internalAdGroupId供RLDataRecorder使用
              internalAdGroupId: audience.internalAdGroupId
            });
          } else {
            allSdAudiences.push(audience);
            sdAudienceTargets.push({
              id: audience.id,
              type: "product_target",
              currentBid,
              impressions: audience.impressions || 0,
              clicks: audience.clicks || 0,
              spend: parseFloat(audience.spend || "0"),
              sales: parseFloat(audience.sales || "0"),
              orders: audience.orders || 0,
              matchType: "exact",
              // @ts-ignore
              campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : void 0,
              dailyData: campaignDailyData.length > 0 ? campaignDailyData : void 0,
              // @ts-ignore
              marketplace: config2.marketplace,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // v515: 传入internalAdGroupId供RLDataRecorder使用
              internalAdGroupId: audience.internalAdGroupId
            });
          }
        }
        if (sdAudienceTargets.length > 0) {
          log101.info(`[v512] SD campaign ${campaignLocalId} \u53D1\u73B0 ${sdAudienceTargets.length} \u4E2A\u53D7\u4F17\u5B9A\u5411\u5F85\u4F18\u5316`);
        }
      } catch (sdAudErr) {
        log101.warn(`[v512] SD\u53D7\u4F17\u67E5\u8BE2\u5931\u8D25(\u4E0D\u963B\u585E\u4E3B\u6D41\u7A0B): ${sdAudErr.message}`);
      }
    }
    if (sdAudienceTargets.length > 0) {
      const nextGenSdAudResults = await batchCalculateNextGenBids(
        config2.accountId,
        sdAudienceTargets,
        bidConfig,
        maxBidLimit
      );
      for (const nextGenResult of nextGenSdAudResults) {
        let finalBid = nextGenResult.newBid;
        const sdCampType = "sd";
        const sdCostType = campaign.costType || "cpc";
        const sdAdFormat = campaign.ad_format || campaign.adFormat || null;
        const sdMarketplace = config2.marketplace || "US";
        const { clampedBid: sdClampedBid, wasAdjusted: sdWasAdjusted, constraint: sdConstraint, adTypeKey: sdAdTypeKey } = clampBidToConstraint(finalBid, sdCampType, sdMarketplace, sdCostType, sdAdFormat);
        finalBid = Math.min(sdClampedBid, maxBidLimit);
        finalBid = Math.round(finalBid * 100) / 100;
        if (sdWasAdjusted) {
          log101.info(`[v512] SD\u53D7\u4F17 ${nextGenResult.targetId} bid $${nextGenResult.newBid.toFixed(2)} \u8D85\u51FA${sdAdTypeKey}\u7EA6\u675F[$${sdConstraint.minBid}~$${sdConstraint.maxBid}]\uFF0C\u8C03\u6574\u4E3A$${finalBid}`);
        }
        if (finalBid > nextGenResult.previousBid) {
          const bidIncrease = finalBid - nextGenResult.previousBid;
          const bidIncreasePercent = nextGenResult.previousBid > 0 ? bidIncrease / nextGenResult.previousBid * 100 : Infinity;
          if (nextGenResult.previousBid <= 0.1 && bidIncrease > 0.5) {
            finalBid = Math.round((nextGenResult.previousBid + 0.5) * 100) / 100;
            log101.info(`[BidOptimization] v579: \u51B7\u542F\u52A8\u5E73\u6ED1\u671F\u52A0\u4EF7\u4FDD\u62A4(SD\u53D7\u4F17) - audience ${nextGenResult.targetId} \u8C03\u6574\u4E3A$${finalBid}`);
          } else if (bidIncreasePercent > 200 && bidIncrease > 0.5) {
            finalBid = Math.round((nextGenResult.previousBid + 0.5) * 100) / 100;
            log101.info(`[BidOptimization] v579: \u52A0\u4EF7\u767E\u5206\u6BD4\u5F02\u5E38\u4FDD\u62A4(SD\u53D7\u4F17) - audience ${nextGenResult.targetId} \u8C03\u6574\u4E3A$${finalBid}`);
          }
        }
        if (nextGenResult.actionType !== "hold" && Math.abs(finalBid - nextGenResult.previousBid) > 0.01) {
          if (finalBid > nextGenResult.previousBid) {
            try {
              const { isAccountBidIncreaseBlocked: isAccountBidIncreaseBlocked2 } = await Promise.resolve().then(() => (init_systemDefenseService(), systemDefenseService_exports));
              const blockCheck = await isAccountBidIncreaseBlocked2(config2.accountId);
              if (blockCheck.blocked) {
                log101.info(`[v512] \u7CFB\u7EDF\u9632\u7EBF\u963B\u6B62SD\u53D7\u4F17\u52A0\u4EF7 - audience ${nextGenResult.targetId} \u88AB\u963B\u6B62`);
                continue;
              }
            } catch {
            }
          }
          if (nextGenResult.algorithmUsed) {
            try {
              const { isAlgorithmCircuitBroken: isAlgorithmCircuitBroken2 } = await Promise.resolve().then(() => (init_systemDefenseService(), systemDefenseService_exports));
              if (await isAlgorithmCircuitBroken2(nextGenResult.algorithmUsed)) {
                log101.info(`[v512] \u7B97\u6CD5${nextGenResult.algorithmUsed}\u5DF2\u7194\u65AD\uFF0C\u8DF3\u8FC7SD\u53D7\u4F17 - audience ${nextGenResult.targetId}`);
                continue;
              }
            } catch {
            }
          }
          const audience = allSdAudiences.find((a) => a.id === nextGenResult.targetId);
          details.push({
            keywordId: nextGenResult.targetId,
            productTargetId: nextGenResult.targetId,
            // @ts-ignore
            amazonKeywordId: audience?.audienceId || String(nextGenResult.targetId),
            // audienceId实际上是Amazon的targetId
            // @ts-ignore
            adGroupId: audience?.internalAdGroupId,
            // @ts-ignore
            keywordText: audience?.audienceName || `SD\u53D7\u4F17 ${audience?.audienceType || ""} ${nextGenResult.targetId}`,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            currentBid: nextGenResult.previousBid,
            // @ts-ignore
            newBid: finalBid,
            changePercent: ((finalBid - nextGenResult.previousBid) / nextGenResult.previousBid * 100).toFixed(2),
            reason: `SD\u53D7\u4F17\u5B9A\u5411 - ${nextGenResult.reason}`,
            isProductTarget: true,
            isSdAudience: true,
            // v512: 标记为SD受众，用于API同步和DB更新路由
            campaignType: "sd",
            // v512: SD受众始终属于SD campaign
            algorithmUsed: nextGenResult.algorithmUsed,
            confidenceScore: nextGenResult.confidence,
            algorithmTier: nextGenResult.algorithmTier,
            reasonDetails: nextGenResult.reasonDetails,
            guardrailInfo: nextGenResult.guardrailInfo,
            correctionLayers: nextGenResult.correctionLayers,
            metaLearningDetail: nextGenResult.metaLearningDetail,
            gtoModifier: nextGenResult.gtoModifier,
            causalAdjustment: nextGenResult.causalAdjustment
          });
          if (!dryRun) adjustmentsCount++;
        }
      }
    }
    if (productTargets5.length > 0) {
      const nextGenPtResults = await batchCalculateNextGenBids(
        config2.accountId,
        productTargets5,
        bidConfig,
        maxBidLimit
      );
      for (const nextGenResult of nextGenPtResults) {
        let finalBid = nextGenResult.newBid;
        const ptCampType = campaign.campaignType || "sp_manual";
        const ptCostType = campaign.costType || "cpc";
        const ptAdFormat = campaign.ad_format || campaign.adFormat || null;
        const ptMarketplace = config2.marketplace || "US";
        const { clampedBid: ptClampedBid, wasAdjusted: ptWasAdjusted, constraint: ptConstraint, adTypeKey: ptAdTypeKey } = clampBidToConstraint(finalBid, ptCampType, ptMarketplace, ptCostType, ptAdFormat);
        finalBid = Math.min(ptClampedBid, maxBidLimit);
        finalBid = Math.round(finalBid * 100) / 100;
        if (ptWasAdjusted) {
          log101.info(`[BidOptimization] v434: product target ${nextGenResult.targetId} bid $${nextGenResult.newBid.toFixed(2)} \u8D85\u51FA${ptAdTypeKey}\u7EA6\u675F[$${ptConstraint.minBid}~$${ptConstraint.maxBid}]\uFF0C\u8C03\u6574\u4E3A$${finalBid} (marketplace=${ptMarketplace})`);
        }
        if (finalBid > nextGenResult.previousBid) {
          const bidIncrease = finalBid - nextGenResult.previousBid;
          const bidIncreasePercent = nextGenResult.previousBid > 0 ? bidIncrease / nextGenResult.previousBid * 100 : Infinity;
          if (nextGenResult.previousBid <= 0.1 && bidIncrease > 0.5) {
            finalBid = Math.round((nextGenResult.previousBid + 0.5) * 100) / 100;
            log101.info(`[BidOptimization] v579: \u51B7\u542F\u52A8\u5E73\u6ED1\u671F\u52A0\u4EF7\u4FDD\u62A4(\u5546\u54C1\u5B9A\u5411) - target ${nextGenResult.targetId} \u8C03\u6574\u4E3A$${finalBid}`);
          } else if (bidIncreasePercent > 200 && bidIncrease > 0.5) {
            finalBid = Math.round((nextGenResult.previousBid + 0.5) * 100) / 100;
            log101.info(`[BidOptimization] v579: \u52A0\u4EF7\u767E\u5206\u6BD4\u5F02\u5E38\u4FDD\u62A4(\u5546\u54C1\u5B9A\u5411) - target ${nextGenResult.targetId} \u8C03\u6574\u4E3A$${finalBid}`);
          }
        }
        if (nextGenResult.actionType !== "hold" && Math.abs(finalBid - nextGenResult.previousBid) > 0.01) {
          // === v620-fix11: P1 Bid Decrease Guards for Product Targets ===
          if (finalBid < nextGenResult.previousBid) {
            // EventCalendar: Block decreases during promotional periods for targets with conversions
            if (_v620_isPromotionalPeriod && nextGenResult.orders > 0) {
              _v620_bidDecreaseBlockCount++;
              log101.info(`[v620-EventCalendar] Blocked bid decrease for product target ${nextGenResult.targetId} during "${_v620_eventName}" (has ${nextGenResult.orders} conversions)`);
              continue;
            }
            // DiscoveryGovernor: Protect new targets in attribution window
            if (_v620_discoveryKeywordIds.has(nextGenResult.targetId)) {
              _v620_discoveryProtectCount++;
              log101.info(`[v620-DiscoveryGovernor] Blocked bid decrease for new product target ${nextGenResult.targetId} (in 14-day attribution window)`);
              continue;
            }
          }
          // === end v620-fix11 P1 product target guards ===
          if (finalBid > nextGenResult.previousBid) {
            try {
              const { isAccountBidIncreaseBlocked: isAccountBidIncreaseBlocked2 } = await Promise.resolve().then(() => (init_systemDefenseService(), systemDefenseService_exports));
              const blockCheck = await isAccountBidIncreaseBlocked2(config2.accountId);
              if (blockCheck.blocked) {
                log101.info(`[BidOptimization] v504: \u7CFB\u7EDF\u9632\u7EBF\u963B\u6B62\u5546\u54C1\u5B9A\u5411\u52A0\u4EF7 - target ${nextGenResult.targetId} \u88AB\u963B\u6B62`);
                continue;
              }
            } catch {
            }
          }
          if (nextGenResult.algorithmUsed) {
            try {
              const { isAlgorithmCircuitBroken: isAlgorithmCircuitBroken2 } = await Promise.resolve().then(() => (init_systemDefenseService(), systemDefenseService_exports));
              if (await isAlgorithmCircuitBroken2(nextGenResult.algorithmUsed)) {
                log101.info(`[BidOptimization] v504: \u7B97\u6CD5${nextGenResult.algorithmUsed}\u5DF2\u7194\u65AD\uFF0C\u8DF3\u8FC7\u5546\u54C1\u5B9A\u5411 - target ${nextGenResult.targetId}`);
                continue;
              }
            } catch {
            }
          }
          const target = allTargets.find((t2) => t2.id === nextGenResult.targetId);
          details.push({
            keywordId: nextGenResult.targetId,
            // v230: 保持向后兼容，商品定向也用keywordId字段传递本地ID
            productTargetId: nextGenResult.targetId,
            // v230: 新增显式的productTargetId字段
            // @ts-ignore
            amazonKeywordId: target?.targetId || "",
            // v255: 传入真正的Amazon target ID，修复PostOptVerifier验证失败
            // @ts-ignore
            adGroupId: target?.adGroupId,
            // v255: 传入adGroupId用于PostOptVerifier精确回查
            // @ts-ignore
            keywordText: target?.targetText || target?.targetValue || `\u5546\u54C1\u5B9A\u5411 ${nextGenResult.targetId}`,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            currentBid: nextGenResult.previousBid,
            newBid: finalBid,
            changePercent: ((finalBid - nextGenResult.previousBid) / nextGenResult.previousBid * 100).toFixed(2),
            reason: `\u5546\u54C1\u5B9A\u5411 - ${nextGenResult.reason}`,
            // @ts-ignore
            isProductTarget: true,
            // @ts-ignore
            algorithmUsed: nextGenResult.algorithmUsed,
            confidenceScore: nextGenResult.confidence,
            algorithmTier: nextGenResult.algorithmTier,
            // v258: 传递结构化归因和护栏信息
            reasonDetails: nextGenResult.reasonDetails,
            guardrailInfo: nextGenResult.guardrailInfo,
            // v337: 传递修正层标记和Meta-Learning决策详情
            correctionLayers: nextGenResult.correctionLayers,
            metaLearningDetail: nextGenResult.metaLearningDetail,
            gtoModifier: nextGenResult.gtoModifier,
            causalAdjustment: nextGenResult.causalAdjustment,
            // v512: 传递campaignType用于SB/SD验证路由
            campaignType: campaign.campaignType || "sp"
          });
          if (!dryRun) adjustmentsCount++;
        }
      }
    }
  }
  let apiSyncResult = { success: 0, failed: 0, errors: [] };
  let apiSyncStatus = "pending";
  if (!dryRun && details.length > 0) {
    try {
      const accountId = config2.accountId;
      // === v620-fix11: P1 Final Bid Decrease Guards (EventCalendar + CoreKeyword + DiscoveryGovernor) ===
      const _v620_preFilterCount = details.length;
      for (let _v620_i = details.length - 1; _v620_i >= 0; _v620_i--) {
        const _v620_d = details[_v620_i];
        if (!_v620_d.keywordId || !_v620_d.newBid || _v620_d.action === "safety_pause" || _v620_d.action === "v620_bid_protection_summary") continue;
        const _v620_isDecrease = parseFloat(String(_v620_d.newBid)) < parseFloat(String(_v620_d.currentBid));
        if (!_v620_isDecrease) continue;

        // EventCalendar: Block decreases during promotional periods for keywords with conversions
        if (_v620_isPromotionalPeriod && _v620_d.conversions > 0) {
          _v620_bidDecreaseBlockCount++;
          _v620_d.action = "decrease_blocked_event";
          _v620_d.newBid = _v620_d.currentBid; // Revert to current bid
          _v620_d.reason = `[v620-EventCalendar] Bid decrease blocked during "${_v620_eventName}". Original: ${_v620_d.reason}`;
          _v620_d.algorithmUsed = "v620_event_calendar_guard";
          _v620_d.apiSyncStatus = "blocked";
          continue;
        }

        // CoreKeyword: Enforce minimum bid floor for core keywords
        if (_v620_coreKeywordIds.has(_v620_d.keywordId)) {
          const _v620_minBid = Math.max(parseFloat(String(_v620_d.currentBid)) * 0.85, 0.15); // Never drop more than 15% for core keywords
          if (parseFloat(String(_v620_d.newBid)) < _v620_minBid) {
            _v620_coreKeywordProtectCount++;
            _v620_d.newBid = _v620_minBid;
            _v620_d.reason = `[v620-CoreKeyword] Min bid floor enforced ($${_v620_minBid.toFixed(2)}). Original: ${_v620_d.reason}`;
            _v620_d.algorithmUsed = "v620_core_keyword_guard";
          }
        }

        // DiscoveryGovernor: Protect new keywords in 14-day attribution window
        if (_v620_discoveryKeywordIds.has(_v620_d.keywordId)) {
          _v620_discoveryProtectCount++;
          _v620_d.newBid = _v620_d.currentBid; // Keep current bid
          _v620_d.reason = `[v620-DiscoveryGovernor] New keyword in 14-day attribution window, bid decrease blocked. Original: ${_v620_d.reason}`;
          _v620_d.algorithmUsed = "v620_discovery_governor";
          _v620_d.apiSyncStatus = "blocked";
        }
      }
      // === end v620-fix11 P1 final guards ===

      const syncableDetails = details.filter((d) => d.keywordId && d.newBid !== void 0 && d.action !== "safety_pause" && d.apiSyncStatus !== "blocked");
      const nonSyncableDetails = details.filter((d) => !d.keywordId || d.newBid === void 0 || d.action === "safety_pause");
      if (nonSyncableDetails.length > 0) {
        log101.info(`[BidOptimization] v224: ${nonSyncableDetails.length}\u6761\u975E\u51FA\u4EF7\u8C03\u6574\u8BB0\u5F55(safety_pause\u7B49)\u5DF2\u8DF3\u8FC7API\u540C\u6B65`);
        for (const d of nonSyncableDetails) {
          d.apiSyncStatus = "not_applicable";
          d.apiSyncDetail = JSON.stringify({ status: "not_applicable", error: null, reason: "\u975E\u51FA\u4EF7\u8C03\u6574\u8BB0\u5F55(safety_pause)" });
        }
      }
      apiSyncResult = await syncBidAdjustmentsToAmazon(
        accountId,
        // @ts-ignore
        syncableDetails.map((d) => ({
          // @ts-ignore
          keywordId: d.keywordId,
          newBid: d.newBid,
          campaignId: d.amazonCampaignId,
          reason: d.reason,
          // @ts-ignore
          isProductTarget: d.isProductTarget || false,
          algorithmUsed: d.algorithmUsed
          // v334: 传递算法标识到biddingLogs
        }))
      );
      if (apiSyncResult.failed === 0 && apiSyncResult.success > 0) {
        apiSyncStatus = "synced";
      } else if (apiSyncResult.success === 0) {
        apiSyncStatus = "failed";
      } else {
        apiSyncStatus = "partial";
      }
      log101.warn(`[BidOptimization] Amazon API\u540C\u6B65: \u6210\u529F=${apiSyncResult.success}, \u5931\u8D25=${apiSyncResult.failed}, \u72B6\u6001=${apiSyncStatus}`);
      if (apiSyncResult.errors.length > 0) {
        log101.warn(`[BidOptimization] Amazon API\u540C\u6B65\u9519\u8BEF:`, apiSyncResult.errors.join("; "));
      }
      const syncedDetails = syncableDetails.filter((d) => {
        const itemResult = apiSyncResult.itemResults?.get(d.keywordId);
        return itemResult?.status === "synced";
      });
      const skippedDetails = syncableDetails.filter((d) => {
        const itemResult = apiSyncResult.itemResults?.get(d.keywordId);
        return itemResult?.status !== "synced";
      });
      if (syncedDetails.length > 0) {
        const dbConn = await getDb();
        if (dbConn) {
          try {
            await dbConn.transaction(async (tx) => {
              for (const detail of syncedDetails) {
                if (detail.isSdAudience) {
                  await tx.update(sdAudiences).set({ bid: (typeof detail.newBid === "number" ? detail.newBid : 0).toFixed(2) }).where(eq(sdAudiences.id, detail.keywordId));
                } else if (detail.isProductTarget) {
                  await tx.update(productTargets).set({ bid: (typeof detail.newBid === "number" ? detail.newBid : 0).toFixed(2) }).where(eq(productTargets.id, detail.keywordId));
                } else {
                  await tx.update(keywords).set({
                    bid: (typeof detail.newBid === "number" ? detail.newBid : 0).toFixed(2),
                    lastOptimizedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
                    pendingBid: (typeof detail.newBid === "number" ? detail.newBid : 0).toFixed(2),
                    bidSyncStatus: "pending_confirmation"
                  }).where(eq(keywords.id, detail.keywordId));
                }
              }
              const affectedCampaignIds = [...new Set(syncedDetails.map((d) => d.localCampaignId))];
              const nowStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
              for (const cid of affectedCampaignIds) {
                await tx.update(campaigns).set({ lastOptimizedAt: nowStr }).where(eq(campaigns.id, cid));
              }
            });
            log101.info(`[BidOptimization] v178: \u4E8B\u52A1\u6279\u91CFDB\u66F4\u65B0\u6210\u529F: ${syncedDetails.length}\u6761\u51FA\u4EF7 + campaigns.last_optimized_at\u5DF2\u66F4\u65B0`);
            for (const detail of syncedDetails) {
              auditBidChange(
                0,
                // system user
                accountId,
                // @ts-ignore
                detail.keywordId,
                detail.keywordText || "",
                typeof detail.previousBid === "number" ? detail.previousBid : 0,
                typeof detail.newBid === "number" ? detail.newBid : 0,
                "system"
              );
            }
            try {
              const { batchRecordBidPerformanceHistory: batchRecordBidPerformanceHistory2 } = await Promise.resolve().then(() => (init_rlDataRecorder(), rlDataRecorder_exports));
              const bidPerfRecords = syncedDetails.map((d) => ({
                accountId: config2.accountId,
                campaignId: String(d.amazonCampaignId || d.localCampaignId),
                bidObjectType: d.isSdAudience ? "audience" : d.isProductTarget ? "asin" : "keyword",
                bidObjectId: d.keywordId,
                bid: typeof d.newBid === "number" ? d.newBid : 0
              }));
              const bphResult = await batchRecordBidPerformanceHistory2(bidPerfRecords);
              log101.info(`[BidOptimization] v230: bidPerformanceHistory\u5199\u5165: recorded=${bphResult.recorded}, failed=${bphResult.failed}`);
            } catch (bphErr) {
              log101.warn(`[BidOptimization] v230: bidPerformanceHistory\u5199\u5165\u5931\u8D25(\u4E0D\u963B\u585E\u4E3B\u6D41\u7A0B): ${bphErr.message}`);
            }
          } catch (txErr) {
            log101.warn(`[BidOptimization] v178: \u4E8B\u52A1DB\u66F4\u65B0\u5931\u8D25(\u5DF2\u56DE\u6EDA): ${txErr.message}`);
          }
        }
      }
      for (const detail of skippedDetails) {
        log101.warn(`[BidOptimization] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0: targetId=${detail.keywordId}`);
      }
      if (syncedDetails.length > 0) {
        try {
          scheduleBidVerification(
            config2.accountId,
            // @ts-ignore
            syncedDetails.map((d) => ({
              localKeywordId: d.keywordId,
              amazonKeywordId: d.amazonKeywordId || String(d.keywordId),
              expectedBid: d.newBid,
              campaignId: d.amazonCampaignId,
              adGroupId: d.adGroupId,
              isProductTarget: d.isProductTarget || false,
              // v512: 传递campaignType和isSdAudience用于SB/SD/SD受众验证路由
              campaignType: d.campaignType || "",
              isSdAudience: d.isSdAudience || false
            }))
          );
          log101.info(`[BidOptimization] v166: \u5DF2\u6CE8\u518C${syncedDetails.length}\u4E2A\u51FA\u4EF7\u9A8C\u8BC1\u4EFB\u52A1`);
        } catch (verifyErr) {
          log101.warn(`[BidOptimization] v166: \u6CE8\u518C\u9A8C\u8BC1\u4EFB\u52A1\u5931\u8D25(\u4E0D\u5F71\u54CD\u4E3B\u6D41\u7A0B): ${verifyErr.message}`);
        }
      }
    } catch (apiError) {
      apiSyncStatus = "failed";
      apiSyncResult.errors.push(apiError.message);
      log101.warn(`[BidOptimization] Amazon API\u540C\u6B65\u5F02\u5E38:`, apiError.message);
      log101.warn(`[BidOptimization] v148: API\u6574\u4F53\u5F02\u5E38\uFF0C\u6240\u6709\u672C\u5730DB\u66F4\u65B0\u5DF2\u8DF3\u8FC7`);
    }
  } else if (dryRun) {
    apiSyncStatus = "pending";
  }
  for (const detail of details) {
    if (detail.apiSyncStatus === "not_applicable") continue;
    const itemResult = apiSyncResult.itemResults?.get(detail.keywordId);
    if (itemResult) {
      detail.apiSyncStatus = itemResult.status;
      detail.apiResponseId = itemResult.apiResponseId || null;
      detail.apiSyncDetail = JSON.stringify({
        status: itemResult.status,
        error: itemResult.error || null,
        apiResponseId: itemResult.apiResponseId || null
      });
    } else if (dryRun) {
      detail.apiSyncStatus = "pending";
      detail.apiSyncDetail = JSON.stringify({ status: "pending", error: null });
    } else {
      detail.apiSyncStatus = apiSyncStatus;
      detail.apiSyncDetail = JSON.stringify({
        status: apiSyncStatus,
        error: "\u672A\u83B7\u53D6\u5230\u5355\u6761\u540C\u6B65\u72B6\u6001"
      });
    }
  }
  // === v620-fix11: P1 Bid Protection Summary ===
  if (_v620_bidDecreaseBlockCount > 0 || _v620_coreKeywordProtectCount > 0 || _v620_discoveryProtectCount > 0) {
    const v620BidSummary = `[v620-BidProtection] Summary: ${_v620_bidDecreaseBlockCount} decreases blocked by EventCalendar("${_v620_eventName}"), ${_v620_coreKeywordProtectCount} core keywords protected, ${_v620_discoveryProtectCount} discovery keywords protected`;
    log101.warn(v620BidSummary);
    details.push({
      action: "v620_bid_protection_summary",
      algorithmUsed: "v620_bid_protection",
      reason: v620BidSummary,
      eventCalendarBlocked: _v620_bidDecreaseBlockCount,
      coreKeywordProtected: _v620_coreKeywordProtectCount,
      discoveryProtected: _v620_discoveryProtectCount,
      isPromotionalPeriod: _v620_isPromotionalPeriod,
      eventName: _v620_eventName
    });
  }
  // === end v620-fix11 P1 summary ===

  if (safetyPausedCampaignCount > 0) {
    const totalCampaigns = campaigns6.length;
    const pauseRatio = safetyPausedCampaignCount / totalCampaigns;
    const summaryMsg = `v244: \u4F18\u5316\u76EE\u6807"${config2.name}" \u5B89\u5168\u68C0\u67E5\u6C47\u603B - ${safetyPausedCampaignCount}/${totalCampaigns}\u4E2Acampaign\u89E6\u53D1\u5B89\u5168\u6682\u505C(${(pauseRatio * 100).toFixed(0)}%)\uFF0C\u5DF2\u8DF3\u8FC7\u8FD9\u4E9Bcampaign\u7684\u51FA\u4EF7\u4F18\u5316`;
    if (pauseRatio > 0.5) {
      log101.warn(`[BidOptimization] ${summaryMsg} - \u8D85\u8FC750%campaign\u89E6\u53D1\u5B89\u5168\u6682\u505C\uFF0C\u5EFA\u8BAE\u4EBA\u5DE5\u68C0\u67E5`);
    } else {
      log101.warn(`[BidOptimization] ${summaryMsg}`);
    }
    details.push({ action: "safety_summary", algorithmUsed: "safety_guard", reason: summaryMsg, safetyPausedCount: safetyPausedCampaignCount, totalCampaigns, pauseRatio });
  }
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details, apiSyncResult, apiSyncStatus };
}
var log101;
var init_bidOptimizationExecutor = __esm({
  "server/targetEngine/bidOptimizationExecutor.ts"() {
    "use strict";
    init_db2();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_nextGenBidOrchestrator();
    init_amazonApiHelper();
    init_timeDecayWeightedDataService();
    init_gradualOptimizationEngine();
    init_selfEvolutionEngine();
    init_postOptimizationVerifier();
    init_logger();
    init_idTypes();
    init_amazonBidConstraints();
    init_auditLogService2();
    init_localBidRecommendationEngine();
    log101 = createModuleLogger("TargetEngine");
    __name(executeBidOptimization, "executeBidOptimization");
  }
});

