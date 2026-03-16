# v176 Analysis - Negative Keyword Issues

## Key Findings

### 1. API Response (v175b deployment at 10:34:33)
The Amazon API returned a **partial success** response:
- **Error (index 0)**: "the foot company solemate vs sidekick axisboard" → PATTERN_NOT_MATCHED
- **Success (index 1)**: "pilates kit cheap" → campaignNegativeKeywordId = 429917354613356
- **Error (index 2)**: "latex free pilates accessories kit" → PATTERN_NOT_MATCHED

### 2. Bug: AmazonApiHelper reported "成功=0, 失败=3"
Even though 1 keyword succeeded, the helper reported 0 successes and 3 failures.

**Root Cause**: In `amazonApiHelper.ts` line 514-515, the check `r.code === 'SUCCESS' || r.keywordId` 
should work, but the issue is that `createSpCampaignNegativeKeywords` returns `keywordId` as a number.
When keywordId is 0 for error items, `r.keywordId` evaluates to falsy. But for success items, 
`r.keywordId` should be the campaignNegativeKeywordId which is truthy.

Wait - looking at the response parsing code more carefully:
- Line 3321: `keywordId: s.campaignNegativeKeywordId || s.keywordId` → This should be 429917354613356
- Line 3322: `code: 'SUCCESS'`
- So the SUCCESS item should have code='SUCCESS' and keywordId=429917354613356

BUT the log shows "成功=0, 失败=3" - this means the results array might not be iterated correctly.

**ACTUAL ROOT CAUSE**: The v175b code was deployed at 10:34, but the PREVIOUS version (v175a without 
the fix) was running at 10:34 on process 10597. The v175b process is 11316 which started at 10:39.
So the response parsing fix in v175b wasn't active yet when the API call was made!

### 3. v175b (process 11316) ran at 10:40
At 10:40, v175b ran and found 3 failed/pending events. But by this time, "pilates kit cheap" had 
already been created on Amazon (id=429917354613356). The idempotency check should have caught it 
as a duplicate, but the retry logic marked all 3 as "超过最大重试次数" (not_applicable).

### 4. Database State
- negative_keywords table: 3 records with NULL amazon_negative_keyword_id
- optimization_events: 11 empty-status duplicates + 14 not_applicable records
- "pilates kit cheap" exists on Amazon with id 429917354613356 but DB doesn't know

## Required Fixes

1. **Update negative_keywords record** for "pilates kit cheap" with amazon_negative_keyword_id = 429917354613356
2. **Mark the 2 permanently failed keywords** in negative_keywords as `removed` status
3. **Clean up 11 empty-status optimization_events** as not_applicable  
4. **Verify the response parsing code** is actually correct in v175b (it may already be fixed)
5. **Deploy v176** with any additional fixes needed
