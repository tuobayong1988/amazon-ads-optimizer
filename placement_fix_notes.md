# Placement Fix Notes

## API返回的实际数据结构 (SP API v3)

```json
{
  "dynamicBidding": {
    "placementBidding": [
      {"percentage": 19, "placement": "PLACEMENT_TOP"},
      {"percentage": 13, "placement": "PLACEMENT_REST_OF_SEARCH"},
      {"percentage": 10, "placement": "PLACEMENT_PRODUCT_PAGE"}
    ],
    "strategy": "MANUAL"  // or "LEGACY_FOR_SALES", "AUTO_FOR_SALES"
  }
}
```

## 代码中期望的数据结构 (旧版API)

```json
{
  "bidding": {
    "adjustments": [
      {"percentage": 19, "predicate": "placementTop"},
      {"percentage": 10, "predicate": "placementProductPage"}
    ],
    "strategy": "manual"
  }
}
```

## 映射关系

| API v3 placement | 旧代码 predicate | DB字段 |
|---|---|---|
| PLACEMENT_TOP | placementTop | placementTopSearchBidAdjustment |
| PLACEMENT_PRODUCT_PAGE | placementProductPage | placementProductPageBidAdjustment |
| PLACEMENT_REST_OF_SEARCH | (未支持) | placementRestBidAdjustment |

## API v3 strategy映射

| API v3 strategy | DB字段值 |
|---|---|
| MANUAL | manual |
| LEGACY_FOR_SALES | legacyForSales |
| AUTO_FOR_SALES | autoForSales |

## 需要修改的文件

1. `server/sync/bidOperations.ts` - getPlacementMultiplier函数
2. `server/sync/syncBidOperations.ts` - getPlacementMultiplier函数
3. `server/sync/campaignSync.ts` - 添加placementRestBidAdjustment
4. `server/sync/syncSp.ts` - 添加placementRestBidAdjustment
5. `server/sync/syncWithTracking.ts` - 添加placementRestBidAdjustment
6. `server/sync/amazonAdsApi.ts` - SpCampaign接口定义
