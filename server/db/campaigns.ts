/**
 * v360: 广告活动管理模块
 * 从db.ts中拆分的广告活动相关CRUD操作
 */
export {
  getCampaigns,
  getCampaignById,
  getCampaignByAmazonId,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaignsByAccountId,
} from '../db';
