/**
 * v360: 广告账户管理模块
 * 从db.ts中拆分的账户相关CRUD操作
 */
export {
  getAdAccounts,
  getAdAccountById,
  createAdAccount,
  updateAdAccount,
  deleteAdAccount,
  getDefaultAdAccount,
  setDefaultAdAccount,
} from '../db';
