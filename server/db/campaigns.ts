/**
 * v360: 广告活动管理模块
 * 从db.ts中拆分的广告活动相关CRUD操作
 */
export {
  getAllCampaigns,
  getCampaignById,
  getCampaignByAmazonId,
  createCampaign,
  updateCampaign,
  getCampaignsByAccountId,
} from '../db';
