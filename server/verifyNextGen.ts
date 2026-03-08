import { createModuleLogger } from "./utils/logger";
const log = createModuleLogger("VerifyNextGen");
/**
 * Verification Script for Next-Gen Algorithm Suite
 * 
 * This script performs an end-to-end test of the new algorithm modules:
 * 1. Sets up mock data for a test account and optimization target.
 * 2. Runs the maintenance tasks to pre-populate caches and train models.
 * 3. Invokes the next-gen orchestrator to calculate a bid.
 * 4. Prints all intermediate and final results for verification.
 */

import { getDb } from "./db";
import { 
    calculateNextGenBid, 
    executeNextGenMaintenanceTasks, 
    executeModelTraining, 
    executeBudgetOptimization, 
    executeKeywordGraphAnalysis 
} from "./nextGenBidOrchestrator";
import type { OptimizationTarget, PerformanceGroupConfig } from "./bidOptimizer";
import { campaigns, adGroups, keywords, rlTrainingLogs, contextualFeatures } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const TEST_ACCOUNT_ID = 9999;
const TEST_CAMPAIGN_ID = "test_campaign_9999";
const TEST_ADGROUP_ID = 999901;
const TEST_KEYWORD_ID = 9999001;

async function setupMockData() {
    const db = await getDb();
    if (!db) throw new Error("DB connection failed");

    log.info("Setting up mock data...");

    // Clean up previous test data
    await db.delete(campaigns).where(eq(campaigns.accountId, TEST_ACCOUNT_ID));
    await db.delete(adGroups).where(eq(adGroups.id, TEST_ADGROUP_ID));
    await db.delete(keywords).where(eq(keywords.id, TEST_KEYWORD_ID));
    await db.delete(rlTrainingLogs).where(eq(rlTrainingLogs.accountId, TEST_ACCOUNT_ID));
    await db.delete(contextualFeatures).where(eq(contextualFeatures.accountId, TEST_ACCOUNT_ID));

    // Create mock campaign
    // @ts-ignore
    await db.insert(campaigns).values({
        id: 9999,
        accountId: TEST_ACCOUNT_ID,
        campaignId: TEST_CAMPAIGN_ID,
        campaignName: "Test Campaign for NextGen",
        campaignType: "sp_manual",
        campaignStatus: "enabled",
        dailyBudget: "50.00",
    } as Record<string, any>);

    // Create mock ad group
    // @ts-ignore
    await db.insert(adGroups).values({
        id: TEST_ADGROUP_ID,
        campaignId: "9999",
        adGroupId: "test_adgroup_999901",
        adGroupName: "Test AdGroup",
        adGroupStatus: "enabled",
    } as Record<string, any>);

    // Create mock keyword
    // @ts-ignore
    await db.insert(keywords).values({
        id: TEST_KEYWORD_ID,
        adGroupId: TEST_ADGROUP_ID,
        keywordId: "test_keyword_9999001",
        keywordText: "test keyword for verification",
        matchType: "broad",
        bid: "1.23",
        keywordStatus: "enabled",
    } as Record<string, any>);

    // Create some mock RL logs to make algorithms eligible
    // @ts-ignore
    await db.insert(rlTrainingLogs).values(Array.from({ length: 60 }, (_, i) => ({
        accountId: TEST_ACCOUNT_ID,
        keywordId: TEST_KEYWORD_ID,
        stateBid: String(1.0 + i * 0.01),
        actionBidBefore: String(1.0 + i * 0.01),
        actionBidAfter: String(1.0 + (i+1) * 0.01),
        reward: String(Math.random() * 5 - 1), // Random reward between -1 and 4
        rewardFilledAt: new Date().toISOString(),
        createdAt: new Date(Date.now() - (60 - i) * 86400000).toISOString(),
    })) as unknown);

    log.info("Mock data setup complete.");
}

async function runVerification() {
    log.info("--- Starting Next-Gen Algorithm Verification ---");

    try {
        await setupMockData();

        // 1. Run maintenance tasks
        log.info("\n--- Running Maintenance Tasks ---");
        const maintenanceResult = await executeNextGenMaintenanceTasks(TEST_ACCOUNT_ID);
        log.info("Maintenance Result:", JSON.stringify(maintenanceResult, null, 2));

        // 2. Run model training
        log.info("\n--- Running Model Training ---");
        await executeModelTraining(TEST_ACCOUNT_ID);

        // 3. Run budget optimization
        log.info("\n--- Running Budget Optimization ---");
        await executeBudgetOptimization(TEST_ACCOUNT_ID);

        // 4. Run keyword graph analysis
        log.info("\n--- Running Keyword Graph Analysis ---");
        await executeKeywordGraphAnalysis(TEST_ACCOUNT_ID);

        // 5. Calculate a bid using the orchestrator
        log.info("\n--- Calculating Bid with Orchestrator ---");
        const mockTarget: OptimizationTarget = {
            id: TEST_KEYWORD_ID,
            type: "keyword",
            currentBid: 1.23,
            impressions: 1000,
            clicks: 50,
            spend: 60,
            sales: 200,
            orders: 10,
        };

        const mockGroupConfig: PerformanceGroupConfig = {
            optimizationGoal: "maximize_profit",
            targetAcos: 0.35,
        };

        // @ts-ignore
        const bidResult = await (calculateNextGenBid as unknown)(TEST_ACCOUNT_ID, mockTarget, mockGroupConfig, {
            enableNextGen: true,
            nextGenTrafficRatio: 1.0, // Force usage of new algo
            maxBidChangePercent: 0.3,
            minBid: 0.02,
            maxBid: 10.00,
        });

        log.info("\n--- Bid Calculation Result ---");
        if (bidResult) {
            log.info(JSON.stringify(bidResult, null, 2));
        } else {
            log.info("Next-gen algorithm was not used (as per traffic allocation or error).");
        }

        log.info("\n--- Verification Script Finished Successfully ---");

    } catch (error) {
        log.error("\n--- VERIFICATION FAILED ---");
        log.error(String(error));
        process.exit(1);
    }
}

runVerification().finally(() => {
    // Clean up DB connection if needed
});
