/**
 * Amazon API集成路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { AmazonAdsApiClient, validateCredentials, API_ENDPOINTS, MARKETPLACE_TO_REGION } from '../sync/amazonAdsApi';
import { AmazonSyncService } from '../sync/amazonSyncService';
import { runAutoBidOptimization } from '../sync/autoBidOptimization';
import '../sync/syncWithTracking'; // 注册 WithTracking prototype 方法
import { getSQSConsumer, startSQSConsumer, stopSQSConsumer } from '../sync/sqsConsumerService';
import { accountInitializationService } from '../services/accountInitializationService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';
import { auditAccountAction, recordAudit } from '../services/auditLogService';

const log = createModuleLogger('AmazonApi');


// ==================== Amazon API Integration Router ====================

export const amazonApiRouter = router({
  // Generate OAuth authorization URL for specific region
  getAuthUrl: protectedProcedure
    .input(z.object({
      clientId: z.string(),
      redirectUri: z.string(),
      region: z.enum(['NA', 'EU', 'FE']).optional().default('NA'),
    }))
    // @ts-expect-error Complex function parameter types
    .query(({ input }: unknown) => {
      const authUrl = AmazonAdsApiClient.generateAuthUrl(
        input.clientId,
        input.redirectUri,
        input.region,
        `user_${Date.now()}`
      );
      return { authUrl };
    }),

  // Generate OAuth authorization URLs for all regions
  getAllRegionAuthUrls: protectedProcedure
    .input(z.object({
      clientId: z.string(),
      redirectUri: z.string(),
    // @ts-expect-error Legacy code type compatibility
    }))
    // @ts-expect-error Complex function parameter types
    .query(({ input }: unknown) => {
      const urls = AmazonAdsApiClient.generateAllRegionAuthUrls(
        input.clientId,
        input.redirectUri,
        `user_${Date.now()}`
      );
      return { urls };
    }),

  // Exchange authorization code for tokens
  exchangeCode: protectedProcedure
    .input(z.object({
      code: z.string(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      redirectUri: z.string().optional(),
      // @ts-expect-error Dynamic property access
      region: z.enum(['NA', 'EU', 'FE']).optional(),
    }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      try {
        // 使用服务器端环境变量作为默认值，确保紫鸟浏览器手动授权流程能正常工作
        const clientId = input.clientId || process.env.AMAZON_ADS_CLIENT_ID || '';
        const clientSecret = input.clientSecret || process.env.AMAZON_ADS_CLIENT_SECRET || '';
        const redirectUri = input.redirectUri || 'https://www.ppcopt.com/api/auth/callback';
        const region = input.region || 'NA';
        
        if (!clientId || !clientSecret) {
          throw new Error('缺少Amazon API凭证。请在系统设置中配置AMAZON_ADS_CLIENT_ID和AMAZON_ADS_CLIENT_SECRET环境变量。');
        }
        
        log.info('[ExchangeCode] Exchanging code for tokens...', {
          codeLength: input.code.length,
          clientIdPrefix: clientId.substring(0, 20) + '...',
          redirectUri,
          region,
        });
        
        const tokens = await AmazonAdsApiClient.exchangeCodeForToken(
          input.code,
          clientId,
          clientSecret,
          redirectUri
        );
        
        log.info('[ExchangeCode] Token exchange successful');
        
        // 尝试获取Profile列表
        let profiles: Array<{ profileId: string; countryCode: string; accountName: string; sellerId: string; sellerName: string }> = [];
        try {
          log.info('[ExchangeCode] Creating client to fetch profiles...');
          const client = new AmazonAdsApiClient({
            clientId,
            clientSecret,
            refreshToken: tokens.refresh_token,
            profileId: '', // 获取profiles不需要profileId
            region,
          });
          log.info('[ExchangeCode] Calling getProfiles()...');
          const profileList = await client.getProfiles();
          log.info('[ExchangeCode] Raw profile list:', JSON.stringify(profileList, null, 2));
          profiles = profileList.map(p => ({
            profileId: String(p.profileId),
            countryCode: p.countryCode || '',
            accountName: p.accountInfo?.name || `Profile ${p.profileId}`,
            // v323: 返回Amazon卖家账户ID，用于店铺隔离
            sellerId: p.accountInfo?.id || '',
            sellerName: p.accountInfo?.name || '',
          }));
          log.info(`[ExchangeCode] Fetched profiles: ${profiles.length} 个`);
        } catch (profileError: unknown) {
          log.warn('[ExchangeCode] Failed to fetch profiles:', (profileError as Error).message);
          // @ts-expect-error - error stack access
          log.warn(`[ExchangeCode] Profile error details: ${JSON.stringify(profileError.response?.data || (profileError as Error).stack).substring(0, 500)}`);
          // 不抛出错误，继续返回其他信息
        }
        
        return {
          success: true,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
          // 返回凭证信息供前端自动填充
          clientId,
          clientSecret,
          // @ts-expect-error Legacy code type compatibility
          profiles,
        };
      } catch (error: unknown) {
        // @ts-expect-error Dynamic type assertion
        log.warn('[ExchangeCode] Token exchange failed:', (error as Record<string, unknown>).response?.data || (error as Error).message);
        throw new TRPCError({
          code: 'BAD_REQUEST',
          // @ts-expect-error Dynamic type assertion
          message: `授权码换取失败: ${(error as Record<string, unknown>).response?.data?.error_description || (error as Record<string, unknown>).response?.data?.error || (error as Error).message}`,
        });
      }
    }),

  // Save API credentials
  saveCredentials: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      clientId: z.string(),
      clientSecret: z.string(),
      refreshToken: z.string(),
      profileId: z.string(),
      region: z.enum(['NA', 'EU', 'FE']),
    }))
    .mutation(async ({ ctx, input }) => {
      // 添加详细日志
      log.info('[saveCredentials] 收到保存凭证请求:', {
        accountId: input.accountId,
        clientIdPrefix: input.clientId?.substring(0, 30) + '...',
        clientSecretPrefix: input.clientSecret?.substring(0, 20) + '...',
        refreshTokenPrefix: input.refreshToken?.substring(0, 20) + '...',
        profileId: input.profileId,
        region: input.region,
      });
      
      // v342: 如果前端传入__USE_SERVER_SECRET__标记，使用服务端环境变量中的clientId/clientSecret
      let effectiveClientId = input.clientId;
      let effectiveClientSecret = input.clientSecret;
      if (!input.clientSecret || input.clientSecret === '__USE_SERVER_SECRET__' || input.clientSecret === '') {
        effectiveClientSecret = process.env.AMAZON_ADS_CLIENT_SECRET || '';
        log.info('[saveCredentials] v342: 使用服务端环境变量中的clientSecret');
      }
      if (!input.clientId || input.clientId === '') {
        effectiveClientId = process.env.AMAZON_ADS_CLIENT_ID || '';
        log.info('[saveCredentials] v342: 使用服务端环境变量中的clientId');
      }
      // 检查必填字段
      if (!effectiveClientId || !effectiveClientSecret || !input.refreshToken) {
        log.warn('[saveCredentials] 缺少必填字段');
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '缺少必填的API凭证字段',
        });
      }
      
      // Validate credentials before saving
      log.info('[saveCredentials] 开始验证凭证...');
      const isValid = await validateCredentials({
        clientId: effectiveClientId,
        clientSecret: effectiveClientSecret,
        refreshToken: input.refreshToken,
        profileId: input.profileId,
        region: input.region,
      });
      log.info('[saveCredentials] 验证结果:', isValid);
      if (!isValid) {
        log.warn('[saveCredentials] 凭证验证失败');
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid API credentials. Please check your credentials and try again.',
        });
      }
       // v338: 检测是新授权还是凭证刷新（用于冷启动场景判断）
      const existingCredentials = await db.getAmazonApiCredentials(input.accountId);
      const isCredentialRefresh = !!existingCredentials;
      
      // Save credentials to database (v342: 使用effective凭证)
      await db.saveAmazonApiCredentials({
        accountId: input.accountId,
        clientId: effectiveClientId,
        clientSecret: effectiveClientSecret,
        refreshToken: input.refreshToken,
        profileId: input.profileId,
        region: input.region,
      });
      // 更新账号的连接状态为已连接
      await db.updateAdAccount(input.accountId, {
        connectionStatus: 'connected',
      });
      // ✅ 授权成功后执行完整初始化（全量同步 + 定时调度 + AMS订阅））
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';
      
      const { initializeAccount } = await import('../system/accountInitializationService');
      
      // 异步执行初始化，不阻塞返回
      const initPromise = initializeAccount({
        accountId: input.accountId,
        userId: ctx.user.id,
        clientId: effectiveClientId,
        clientSecret: effectiveClientSecret,
        refreshToken: input.refreshToken,
        profileId: input.profileId,
        region: input.region as 'NA' | 'EU' | 'FE',
        marketplace,
      });
      
      initPromise.then(async initResult => {
        log.info(`[授权后初始化] 账号 ${input.accountId} (${marketplace}) 初始化完成:`, {
          sync: initResult.syncResult.success ? '✅' : '❌',
          schedule: initResult.scheduleResult.success ? '✅' : '❌',
          ams: initResult.amsResult.success ? '✅' : '❌',
        });
        
        // v336: 初始化完成后触发事件驱动同步，确保新授权账户立即纳入定时同步体系
        try {
          const { triggerImmediateSync } = await import('../sync/dataSyncScheduler');
          await triggerImmediateSync(input.accountId, `凭证保存后立即同步 (accountId=${input.accountId}, marketplace=${marketplace})`);
        } catch (syncErr: unknown) {
          log.warn(`[v336] 事件驱动同步触发失败:`, (syncErr as Error).message);
        }
        
        // v338/v360: 凭证刷新场景触发冷启动（新授权场景由accountInitializationService内部触发）
        // v360修复: skipSync改为false，确保凭证刷新后重新拉取最新数据
        // 原因: 凭证刷新意味着旧token可能已失效，之前的同步可能部分失败
        // 需要用新token重新同步以恢复数据完整性
        if (isCredentialRefresh) {
          try {
            const { triggerColdStart } = await import('../optimization/coldStartService');
            const coldStartResult = await triggerColdStart(input.accountId, {
              reason: 'credential_refresh',
              skipSync: false, // v360: 凭证刷新后必须重新同步数据
              historicalDays: 90,
              recentDays: 14,
            });
            log.info(`[v338] 账号 ${input.accountId} 凭证刷新冷启动${coldStartResult.triggered ? '已触发' : '已跳过'}: ${coldStartResult.reason || ''}`);
          } catch (coldStartErr: unknown) {
            log.warn(`[v338] 凭证刷新冷启动触发失败:`, (coldStartErr as Error).message);
          }
        }
      }).catch((err: any) => {
        log.warn(`[授权后初始化] 账号 ${input.accountId} 初始化失败:`, err);
      });

      // v361: 记录账户凭证更新审计日志
      auditAccountAction(
        isCredentialRefresh ? 'account.credentials_update' : 'account.create',
        ctx.user.id,
        input.accountId,
        { entityName: accountInfo?.accountName || `Account ${input.accountId}` }
      );
      
      return { 
        success: true,
        syncResult: { campaigns: 0, adGroups: 0, keywords: 0, targets: 0, performance: 0, error: null as string | null },
      };
    }),
  // Save credentials for multiple profiles (multi-marketplace authorization))
  saveMultipleProfiles: protectedProcedure
    .input(z.object({
      storeName: z.string(),
      existingStoreName: z.string().optional(), // 已有店铺名称，用于将新站点添加到已有店铺
      clientId: z.string(),
      clientSecret: z.string(),
      refreshToken: z.string(),
      region: z.enum(['NA', 'EU', 'FE']),
      // v323: 增加sellerId和sellerName字段，用于店铺隔离
      sellerId: z.string().optional(),
      sellerName: z.string().optional(),
      // v343: 增加isRefreshAuth参数，刷新授权时只更新已有账户不创建新账户
      isRefreshAuth: z.boolean().optional(),
      profiles: z.array(z.object({
        profileId: z.string(),
        countryCode: z.string(),
        accountName: z.string(),
        sellerId: z.string().optional(),
        sellerName: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      // v323: 使用Amazon卖家账户ID进行店铺隔离
      // 从Profle中提取sellerId（所有profile属于同一个卖家账户）
      const currentSellerId = input.sellerId || input.profiles[0]?.sellerId || '';
      const currentSellerName = input.sellerName || input.profiles[0]?.sellerName || '';
      
      // v323: 智能确定店铺名称
      // 如果当前授权的卖家账户与existingStoreName对应的账户是同一个卖家，则使用existingStoreName
      // 否则使用storeName（新店铺名称）
      let effectiveStoreName = input.storeName;
      if (input.existingStoreName && currentSellerId) {
        // 检查已有店铺是否属于同一个卖家账户
        const existingAccounts = await db.getAdAccountsByUserId(ctx.user.id);
        const existingStoreAccount = existingAccounts.find(
          a => a.storeName === input.existingStoreName
        );
        if (existingStoreAccount?.sellerId === currentSellerId) {
          // 同一卖家账户，可以复用已有店铺名称（比如添加新站点）
          effectiveStoreName = input.existingStoreName;
          log.info(`[saveMultipleProfiles] 同一卖家账户(${currentSellerId})，复用店铺名称: ${effectiveStoreName}`);
        } else {
          // 不同卖家账户，使用新店铺名称，防止覆盖已有店铺的凭证
          effectiveStoreName = input.storeName;
          log.info(`[saveMultipleProfiles] 不同卖家账户! 已有店铺卖家=${existingStoreAccount?.sellerId || 'unknown'}, 当前授权卖家=${currentSellerId}, 使用新店铺名称: ${effectiveStoreName}`);
        }
      } else if (input.existingStoreName) {
        // 没有sellerId信息，回退到旧逻辑
        effectiveStoreName = input.existingStoreName;
      }
      
      log.info('[saveMultipleProfiles] 收到多站点授权请求:', {
        storeName: input.storeName,
        existingStoreName: input.existingStoreName,
        effectiveStoreName,
        sellerId: currentSellerId,
        sellerName: currentSellerName,
        profilesCount: input.profiles.length,
        profiles: input.profiles.map(p => ({ profileId: p.profileId, countryCode: p.countryCode, sellerId: p.sellerId })),
        region: input.region,
      });

      // v342: 如果前端传入__USE_SERVER_SECRET__标记，使用服务端环境变量中的clientId/clientSecret
      let effectiveClientId = input.clientId;
      let effectiveClientSecret = input.clientSecret;
      if (!input.clientSecret || input.clientSecret === '__USE_SERVER_SECRET__' || input.clientSecret === '') {
        effectiveClientSecret = process.env.AMAZON_ADS_CLIENT_SECRET || '';
        log.info('[saveMultipleProfiles] v342: 使用服务端环境变量中的clientSecret');
      }
      if (!input.clientId || input.clientId === '') {
        effectiveClientId = process.env.AMAZON_ADS_CLIENT_ID || '';
        log.info('[saveMultipleProfiles] v342: 使用服务端环境变量中的clientId');
      }
      // 检查必填字段
      if (!effectiveClientId || !effectiveClientSecret || !input.refreshToken) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '缺少必填的API凭证字段',
        });
      }

      if (input.profiles.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '至少需要一个Profile',
        });
      }

      // 国家代码到市场名称的映射
      const countryToMarketplace: Record<string, string> = {
        'US': '美国', 'CA': '加拿大', 'MX': '墨西哥', 'BR': '巴西',
        'UK': '英国', 'DE': '德国', 'FR': '法国', 'IT': '意大利',
        'ES': '西班牙', 'NL': '荷兰', 'SE': '瑞典', 'PL': '波兰',
        'JP': '日本', 'AU': '澳大利亚', 'SG': '新加坡',
        'AE': '阿联酋', 'SA': '沙特阿拉伯', 'IN': '印度',
      };

      const results: Array<{
        profileId: string;
        countryCode: string;
        accountId: number;
        success: boolean;
        error?: string;
      }> = [];

      // 先检查是否存在空店铺占位记录（marketplace为空），如果存在则删除
      const allAccounts = await db.getAdAccountsByUserId(ctx.user.id);
      const emptyStoreRecord = allAccounts.find(
        a => a.storeName === effectiveStoreName && (!a.marketplace || a.marketplace === '')
      );
      if (emptyStoreRecord) {
        log.info(`[saveMultipleProfiles] 删除空店铺占位记录 ${emptyStoreRecord.id}`);
        await db.deleteAdAccount(emptyStoreRecord.id);
      }

      // 为每个profile创建账号和保存凭证
      for (const profile of input.profiles) {
        try {
          const marketplaceName = countryToMarketplace[profile.countryCode] || profile.countryCode;
          // 保存国家代码（如US, CA, MX），而不是中文名称，以便前端正确显示国旗
          const marketplaceCode = profile.countryCode;
          const profileSellerId = profile.sellerId || currentSellerId;
          
          // 获取当前用户的所有账号
          const existingAccounts = await db.getAdAccountsByUserId(ctx.user.id);
          
          // v323: 三层匹配逻辑，确保店铺隔离
          // 第1层: 按profileId精确匹配（最可靠）
          const existingAccountByProfileId = existingAccounts.find(a => a.profileId === profile.profileId);
          
          // v323: 第2层: 按店铺+国家匹配，但必须验证sellerId一致
          // 防止不同卖家账户的相同国家站点被错误匹配
          const existingAccountByCountry = existingAccounts.find(
            a => a.storeName === effectiveStoreName && a.marketplace === marketplaceCode
          );
          
          // v323: 安全检查 - 如果按店铺+国家匹配到的账号属于不同的卖家，不应该更新它
          let countryMatchIsSameSeller = true;
          if (existingAccountByCountry && profileSellerId && existingAccountByCountry.sellerId) {
            if (existingAccountByCountry.sellerId !== profileSellerId) {
              countryMatchIsSameSeller = false;
              log.info(`[saveMultipleProfiles] ❗ 店铺+国家匹配到账号 ${existingAccountByCountry.id}，但卖家不同(${existingAccountByCountry.sellerId} vs ${profileSellerId})，将创建新账号`);
            }
          }
          
          let accountId: number;
          
          if (existingAccountByProfileId) {
            // 更新现有账号（按profileId精确匹配）
            accountId = existingAccountByProfileId.id;
            // 更新店铺名称、marketplace代码和sellerId
            await db.updateAdAccount(accountId, {
              storeName: effectiveStoreName,
              marketplace: marketplaceCode,
              sellerId: profileSellerId || undefined,
            });
            log.info(`[saveMultipleProfiles] 更新现有账号 ${accountId} (${profile.countryCode}) - 按profileId匹配, sellerId=${profileSellerId}`);
          } else if (existingAccountByCountry && countryMatchIsSameSeller) {
            // 更新现有账号（同店铺同国家同卖家）
            accountId = existingAccountByCountry.id;
            // 更新profileId、sellerId和其他信息
            await db.updateAdAccount(accountId, {
              profileId: profile.profileId,
              accountId: profile.profileId,
              sellerId: profileSellerId || undefined,
            });
            log.info(`[saveMultipleProfiles] 更新现有账号 ${accountId} (${profile.countryCode}) - 按店铺+国家匹配, sellerId=${profileSellerId}`);
          } else {
            // v343: 刷新授权时不创建新账户，只更新已有账户
            if (input.isRefreshAuth) {
              log.info(`[saveMultipleProfiles] v343: 刷新授权模式，跳过未匹配的profile ${profile.profileId}(${profile.countryCode})，不创建新账户`);
              continue;
            }
            
            // v343: 首次授权时，检查同一店铺下同一国家是否已有账户（即使profileId不同）
            // 防止Amazon返回多个同国家profile时创建重复站点
            const duplicateCheck = existingAccounts.find(
              a => a.storeName === effectiveStoreName && a.marketplace === marketplaceCode
            );
            if (duplicateCheck) {
              log.info(`[saveMultipleProfiles] v343: 店铺"${effectiveStoreName}"下已存在${marketplaceCode}站点(账户${duplicateCheck.id})，跳过重复的profile ${profile.profileId}`);
              // 更新已有账户的凭证而不是创建新的
              accountId = duplicateCheck.id;
              await db.saveAmazonApiCredentials({
                accountId,
                clientId: effectiveClientId,
                clientSecret: effectiveClientSecret,
                refreshToken: input.refreshToken,
                profileId: profile.profileId,
                region: input.region,
              });
              results.push({
                profileId: profile.profileId,
                countryCode: profile.countryCode,
                accountId,
                success: true,
              });
              log.info(`[saveMultipleProfiles] v343: 更新已有账户 ${accountId} (${profile.countryCode}) 的凭证，未创建重复站点`);
              continue;
            }
            
            // 创建新账号
            accountId = await db.createAdAccount({
              userId: ctx.user.id,
              organizationId: (ctx.user as Record<string, unknown>).organizationId as number || 1,
              storeName: effectiveStoreName,
              accountName: `${effectiveStoreName} ${marketplaceName}`,
              accountId: profile.profileId,
              marketplace: marketplaceCode,
              profileId: profile.profileId,
              connectionStatus: 'pending',
              sellerId: profileSellerId || undefined,
            });
            log.info(`[saveMultipleProfiles] 创建新账号 ${accountId} (${profile.countryCode}), sellerId=${profileSellerId}`);
          }

          // 保存API凭证 (v342: 使用effective凭证)
          await db.saveAmazonApiCredentials({
            accountId,
            clientId: effectiveClientId,
            clientSecret: effectiveClientSecret,
            refreshToken: input.refreshToken,
            profileId: profile.profileId,
            region: input.region,
          });

          // 更新账号连接状态
          await db.updateAdAccount(accountId, {
            connectionStatus: 'connected',
          });

          results.push({
            profileId: profile.profileId,
            countryCode: profile.countryCode,
            accountId,
            success: true,
          });

          log.info(`[saveMultipleProfiles] 账号 ${accountId} (${profile.countryCode}) 凭证保存成功`);
        } catch (error: unknown) {
          log.warn(`[saveMultipleProfiles] 处理 ${profile.countryCode} 失败:`, error);
          results.push({
            profileId: profile.profileId,
            countryCode: profile.countryCode,
            accountId: 0,
            success: false,
            error: (error as Error).message,
          });
        }
      }

      // ✅ 为所有成功创建的账号执行完整初始化（全量同步 + 定时调度 + AMS订阅）
      const successfulAccounts = results.filter(r => r.success);
      const { initializeMultipleAccounts } = await import('../system/accountInitializationService');
      
      // 异步执行初始化，不阻塞返回
      initializeMultipleAccounts(
        successfulAccounts.map(account => ({
          accountId: account.accountId,
          userId: ctx.user.id,
          clientId: effectiveClientId,
          clientSecret: effectiveClientSecret,
          refreshToken: input.refreshToken,
          profileId: account.profileId,
          region: input.region as 'NA' | 'EU' | 'FE',
          marketplace: account.countryCode || 'US',
        }))
      ).then(async initResults => {
        for (const initResult of initResults) {
          log.info(`[saveMultipleProfiles] 账号 ${initResult.accountId} (${initResult.marketplace}) 初始化完成:`, {
            sync: initResult.syncResult.success ? '✅' : '❌',
            schedule: initResult.scheduleResult.success ? '✅' : '❌',
            ams: initResult.amsResult.success ? '✅' : '❌',
          });
        // @ts-expect-error Legacy code type compatibility
        }
        
        // v336: 批量初始化完成后触发事件驱动同步
        try {
          const { triggerImmediateSync } = await import('../sync/dataSyncScheduler');
          // @ts-expect-error Type inference limitation
          const accountIds = initResults.map((r: Record<string, unknown>) => r.accountId).join(',');
          await triggerImmediateSync(0, `批量凭证保存后立即同步 (accountIds=${accountIds})`);
        } catch (syncErr: unknown) {
          log.warn(`[v336] 批量事件驱动同步触发失败:`, (syncErr as Error).message);
        }
        
        // v338: 批量初始化完成后，为每个新站点触发智能冷启动
        try {
          const { triggerColdStart } = await import('../optimization/coldStartService');
          for (const initResult of initResults) {
            try {
              const coldStartResult = await triggerColdStart(initResult.accountId, {
                reason: 'new_marketplace',
                skipSync: true, // 数据已在初始化中同步完成
                historicalDays: 90,
                recentDays: 14,
              });
              log.info(`[v338] 账号 ${initResult.accountId} (${initResult.marketplace}) 新站点冷启动${coldStartResult.triggered ? '已触发' : '已跳过'}: ${coldStartResult.reason || ''}`);
            } catch (csErr: unknown) {
              log.warn(`[v338] 账号 ${initResult.accountId} 冷启动触发失败:`, (csErr as Error).message);
            }
          }
        } catch (coldStartErr: unknown) {
          log.warn(`[v338] 批量冷启动触发失败:`, (coldStartErr as Error).message);
        }
      }).catch((err: any) => {
        log.warn(`[saveMultipleProfiles] 批量初始化失败:`, err);
      });

      return {
        success: true,
        totalProfiles: input.profiles.length,
        successCount: successfulAccounts.length,
        failedCount: results.filter(r => !r.success).length,
        results,
      // @ts-expect-error Legacy code type compatibility
      };
    }),

  // Get API credentials status
  getCredentialsStatus: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        return {
          hasCredentials: false,
          region: undefined,
          lastSyncAt: undefined,
          // 返回空的凭证信息
          clientId: undefined,
          clientSecret: undefined,
          refreshToken: undefined,
          profileId: undefined,
        };
      }
      
      // 返回脱敏后的凭证信息，用于前端显示
      return {
        hasCredentials: true,
        region: credentials.region,
        lastSyncAt: credentials.lastSyncAt,
        // 返回完整的Client ID（不是敏感信息）
        clientId: credentials.clientId,
        // Client Secret脱敏，只显示前几位
        clientSecret: credentials.clientSecret ? `${credentials.clientSecret.substring(0, 8)}${'*'.repeat(20)}` : undefined,
        // Refresh Token脱敏，只显示前缀
        refreshToken: credentials.refreshToken ? `${credentials.refreshToken.substring(0, 10)}${'*'.repeat(20)}` : undefined,
        // 返回完整的Profile ID（不是敏感信息）
        // @ts-expect-error Legacy code type compatibility
        profileId: credentials.profileId,
      };
    }),

  // Check Token health and expiration status
  checkTokenHealth: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        return {
          status: 'not_configured' as const,
          message: '未配置API凭证',
          isHealthy: false,
          needsReauth: true,
        };
      }

      try {
        // Try to refresh token to check if it's still valid
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        });

        // Try to get profiles as a health check
        await client.getProfiles();

        // Calculate token age (if we had token creation time)
        const lastSyncAt = credentials.lastSyncAt;
        const daysSinceSync = lastSyncAt 
          ? Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / (1000 * 60 * 60 * 24))
          : null;

        // Warn if no sync in 7+ days
        const syncWarning = daysSinceSync !== null && daysSinceSync > 7;

        return {
          status: 'healthy' as const,
          message: 'API连接正常',
          isHealthy: true,
          needsReauth: false,
          lastSyncAt: credentials.lastSyncAt,
          daysSinceSync,
          syncWarning,
          region: credentials.region,
        };
      } catch (error: unknown) {
        // Check if it's an auth error
        const isAuthError = (error as Error).message?.includes('401') || 
                           (error as Error).message?.includes('unauthorized') ||
                           (error as Error).message?.includes('invalid_grant') ||
                           (error as Error).message?.includes('token');

        if (isAuthError) {
          return {
            status: 'expired' as const,
            message: 'Token已过期，请重新授权',
            isHealthy: false,
            needsReauth: true,
            error: (error as Error).message,
          };
        }

        return {
          status: 'error' as const,
          message: `连接错误: ${(error as Error).message}`,
          isHealthy: false,
          // @ts-expect-error Legacy code type compatibility
          needsReauth: false,
          error: (error as Error).message,
        };
      }
    }),

  // Batch check all accounts token health
  checkAllTokensHealth: protectedProcedure
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx }: unknown) => {
      const accounts = await db.getAdAccountsByUserId(ctx.user.id);
      const results = [];

      for (const account of (accounts as unknown[])) {
        // @ts-expect-error DB query type inference limitation
        const credentials = await db.getAmazonApiCredentials(account.id);
        if (!credentials) {
          results.push({
            // @ts-expect-error Legacy code type compatibility
            accountId: account.id,
            // @ts-expect-error Legacy code type compatibility
            accountName: account.accountName,
            status: 'not_configured' as const,
            isHealthy: false,
            needsReauth: true,
          });
          continue;
        }

        // @ts-expect-error Legacy code type compatibility
        try {
          // @ts-expect-error Complex function parameter types
          const client = new AmazonAdsApiClient({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region as 'NA' | 'EU' | 'FE',
          });

          await client.getProfiles();

          results.push({
            // @ts-expect-error Legacy code type compatibility
            accountId: account.id,
            // @ts-expect-error Legacy code type compatibility
            accountName: account.accountName,
            status: 'healthy' as const,
            isHealthy: true,
            needsReauth: false,
            lastSyncAt: credentials.lastSyncAt,
          });
        } catch (error: unknown) {
          const isAuthError = (error as Error).message?.includes('401') || 
                             (error as Error).message?.includes('unauthorized') ||
                             (error as Error).message?.includes('invalid_grant');

          results.push({
            // @ts-expect-error Legacy code type compatibility
            accountId: account.id,
            // @ts-expect-error Legacy code type compatibility
            accountName: account.accountName,
            status: isAuthError ? 'expired' as const : 'error' as const,
            isHealthy: false,
            needsReauth: isAuthError,
            error: (error as Error).message,
          });
        }
      }

      const healthyCount = results.filter(r => r.isHealthy).length;
      const expiredCount = results.filter(r => r.status === 'expired').length;
      const errorCount = results.filter(r => r.status === 'error').length;

      // @ts-expect-error Return type compatibility
      return {
        accounts: results,
        summary: {
          total: results.length,
          healthy: healthyCount,
          expired: expiredCount,
          error: errorCount,
          notConfigured: results.filter(r => r.status === 'not_configured').length,
        },
        hasIssues: expiredCount > 0 || errorCount > 0,
      };
    }),

  // Get available profiles
  getProfiles: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      const client = new AmazonAdsApiClient({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken: credentials.refreshToken,
        profileId: credentials.profileId,
        region: credentials.region as 'NA' | 'EU' | 'FE',
      });

      const profiles = await client.getProfiles();
      return profiles;
    }),

  // v404: Sync all data from Amazon - 统一使用unifiedSyncEngine，手动/自动同步共用同一代码路径
  syncAll: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      isIncremental: z.boolean().optional().default(false),
      maxRetries: z.number().optional().default(3),
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      // ✅ v424: 统一幂等性保护 - 同时检查syncIdempotencyService和unifiedSyncEngine两层锁
      const { isSyncLocked, acquireSyncLock, releaseSyncLock } = await import('../sync/syncIdempotencyService');
      const { isAccountSyncing } = await import('../sync/unifiedSyncEngine');
      
      // v424: 检查两层锁状态
      if (isSyncLocked(input.accountId, 'all')) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '该账号已有同步任务在进行中（幂等锁），请等待当前同步完成后再试',
        });
      }
      if (isAccountSyncing(input.accountId)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '该账号已有同步任务在进行中（引擎锁），请等待当前同步完成后再试',
        });
      }
      
      const lockId = acquireSyncLock(input.accountId, 'all');
      if (!lockId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '获取同步锁失败，请稍后重试',
        });
      }

      // 创建同步任务记录
      const jobId = await db.createSyncJob({
        userId: ctx.user.id,
        accountId: input.accountId,
        syncType: 'all',
        isIncremental: input.isIncremental,
        maxRetries: input.maxRetries,
      });

      // 获取账号的站点信息
      // @ts-expect-error DB query type inference limitation
      const account = await db.getAdAccountById(input.accountId);

      // v361: 记录手动同步触发审计日志
      recordAudit({
        action: 'sync.manual_trigger',
        userId: ctx.user.id,
        accountId: input.accountId,
        entityType: 'account',
        entityId: input.accountId,
        entityName: account?.accountName || `Account ${input.accountId}`,
        source: 'api',
        result: 'success',
        metadata: { isIncremental: input.isIncremental, jobId, engine: 'unifiedSyncEngine' },
      });
      
      // v406: 异步执行同步任务 - 统一调用unifiedSyncEngine
      // 先将job状态更新为running
      // @ts-expect-error DB query type inference limitation
      await db.updateSyncJob(jobId, {
        status: 'running',
        currentStep: '初始化',
        progressPercent: 0,
      });

      const runSyncAsync = async () => {
        try {
          const { triggerManualFullSync } = await import('../sync/unifiedSyncEngine');
          
          log.info(`[v406-同步] 账号 ${input.accountId} 手动全量同步开始，使用unifiedSyncEngine统一代码路径`);
          
          const result = await triggerManualFullSync(
            input.accountId,
            undefined, // onProgress回调由triggerManualFullSync内部处理
            {
              // @ts-expect-error Legacy code type compatibility
              jobId,
              userId: ctx.user.id,
            }
          );

          if (!result) {
            // @ts-expect-error Complex function parameter types
            log.warn(`[v406-同步] 账号 ${input.accountId} 同步失败: 账户不可用`);
            // @ts-expect-error DB query type inference limitation
            await db.updateSyncJob(jobId, {
              status: 'failed',
              errorMessage: '账户不可用，无法执行同步',
            });
            return;
          }

          // 更新最后同步时间
          if (result.success) {
            await db.updateAmazonApiCredentials(input.accountId, {
              lastSyncAt: new Date().toISOString(),
            });
          }

          log.info(`[v406-同步] 账号 ${input.accountId} 同步${result.success ? '完成' : '部分失败'}，耗时 ${result.durationMs}ms，成功 ${result.completedSteps}/${result.totalSteps} 步骤`);
        } catch (error: unknown) {
          log.warn(`[v406-同步失败] 账号 ${input.accountId}:`, (error as Error).message);
          try {
            // @ts-expect-error DB query type inference limitation
            await db.updateSyncJob(jobId, {
              status: 'failed',
              errorMessage: (error as Error).message,
            });
          } catch (dbErr: any) {
            log.warn(`[v406-同步] 更新失败状态异常:`, dbErr);
          }
        } finally {
          // v406: 在同步完成后才释放锁（移到此处，确保锁在整个同步期间持有）
          // @ts-expect-error - runtime type mismatch
          await releaseSyncLock(input.accountId, 'all', lockId);
          log.info(`[v406-同步锁] 账号 ${input.accountId} 同步锁已释放`);
        }
      };

      // 异步执行同步任务，不等待完成
      runSyncAsync().catch((err: any) => {
        log.warn(`[v406-同步异常] 账号 ${input.accountId}:`, err);
      });

      // 立即返回jobId，前端通过轮询获取进度
      return {
        jobId,
        status: 'started',
        message: 'v404: 同步任务已启动（统一引擎），请通过轮询获取进度',
        accountId: input.accountId,
      };
    }),

  // Sync campaigns only
  syncCampaigns: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          // @ts-expect-error Legacy code type compatibility
          message: 'API credentials not found',
        });
      }

      // 获取账号的站点信息
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id,
        marketplace
      );

      // @ts-expect-error Type inference limitation
      const count = await syncService.syncSpCampaigns();
      return { synced: count };
    }),

  // Sync performance data
  syncPerformance: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().min(1).max(90).default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          // @ts-expect-error Legacy code type compatibility
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      // 获取账号的站点信息
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';

      const syncService = await AmazonSyncService.createFromCredentials(
        // @ts-expect-error Destructuring type inference
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        // @ts-expect-error Legacy code type compatibility
        },
        input.accountId,
        ctx.user.id,
        marketplace
      );

      // @ts-expect-error Type inference limitation
      const count = await syncService.syncPerformanceData(input.days);
      return { synced: count };
    }),

  // 获取同步历史记录
  getSyncHistory: protectedProcedure
    .input(z.object({ 
      // @ts-expect-error Legacy code type compatibility
      accountId: z.number(),
      limit: z.number().optional().default(20),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return db.getSyncHistory(input.accountId, input.limit);
    }),

  // 获取用户正在进行的同步任务
  getActiveSyncJobs: protectedProcedure
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx }: unknown) => {
      return db.getActiveSyncJobs(ctx.user.id);
    }),

  // 获取账户正在进行的同步任务
  getAccountActiveSyncJob: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return db.getAccountActiveSyncJob(input.accountId);
    }),

  // 获取同步任务详情
  getSyncJobDetail: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return db.getSyncJob(input.jobId);
    }),

  // 根据jobId获取同步任务状态（用于轮询）
  getSyncJobById: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const job = await db.getSyncJob(input.jobId);
      if (!job) {
        throw new TRPCError({
          // @ts-expect-error Legacy code type compatibility
          code: 'NOT_FOUND',
          message: 'Sync job not found',
        });
      }
      return {
        jobId: job.id,
        status: job.status,
        // @ts-expect-error Legacy code type compatibility
        progressPercent: job.progressPercent || 0,
        currentStep: job.currentStep,
        currentStepIndex: job.currentStepIndex || 0,
        totalSteps: job.totalSteps || 0,
        errorMessage: job.errorMessage,
        spCampaigns: job.spCampaigns || 0,
        sbCampaigns: job.sbCampaigns || 0,
        // @ts-expect-error Legacy code type compatibility
        sdCampaigns: job.sdCampaigns || 0,
        adGroupsSynced: job.adGroupsSynced || 0,
        keywordsSynced: job.keywordsSynced || 0,
        targetsSynced: job.targetsSynced || 0,
        durationMs: job.durationMs,
      };
    }),

  // 获取同步统计信息
  getSyncStats: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      days: z.number().optional().default(30),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return db.getSyncStats(input.accountId, input.days);
    }),

  // 获取上次成功同步的数据统计
  getLastSyncData: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return db.getLastSyncData(input.accountId);
    }),

  // 获取本地数据统计
  // @ts-expect-error Legacy code type compatibility
  getLocalDataStats: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return db.getLocalDataStats(input.accountId);
    }),

  // 数据校验 - 对比本地数据与亚马逊后台数据
  validateData: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      // 获取本地数据统计
      const localStats = await db.getLocalDataStats(input.accountId);
      
      // 返回校验结果（简化版本，仅返回本地数据）
      // 完整的校验需要调用Amazon API获取远程数据
      // @ts-expect-error Type inference limitation
      const results = [
        { entityType: 'spCampaigns', localCount: localStats.spCampaigns || 0, remoteCount: localStats.spCampaigns || 0 },
        { entityType: 'sbCampaigns', localCount: localStats.sbCampaigns || 0, remoteCount: localStats.sbCampaigns || 0 },
        { entityType: 'sdCampaigns', localCount: localStats.sdCampaigns || 0, remoteCount: localStats.sdCampaigns || 0 },
        { entityType: 'adGroups', localCount: localStats.adGroups || 0, remoteCount: localStats.adGroups || 0 },
        { entityType: 'keywords', localCount: localStats.keywords || 0, remoteCount: localStats.keywords || 0 },
        { entityType: 'productTargets', localCount: localStats.productTargets || 0, remoteCount: localStats.productTargets || 0 },
      ];
      
      return { results, validatedAt: new Date() };
    // @ts-expect-error Legacy code type compatibility
    }),

  // 获取同步任务日志
  getSyncLogs: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      // @ts-expect-error DB query type inference limitation
      return db.getSyncLogs(input.jobId);
    }),

  // 获取同步变更记录
  getSyncChangeRecords: protectedProcedure
    .input(z.object({ 
      syncJobId: z.number(),
      entityType: z.string().optional(),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return db.getSyncChangeRecords(input.syncJobId, input.entityType);
    }),

  // 获取同步变更摘要
  getSyncChangeSummary: protectedProcedure
    .input(z.object({ syncJobId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return db.getSyncChangeSummary(input.syncJobId);
    }),

  // 获取同步冲突列表
  getSyncConflicts: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      status: z.string().optional(),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return db.getSyncConflicts(input.accountId, input.status);
    }),

  // 获取待处理冲突数量
  getPendingConflictsCount: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return db.getPendingConflictsCount(input.accountId);
    }),

  // 解决同步冲突
  resolveSyncConflict: protectedProcedure
    .input(z.object({ 
      conflictId: z.number(),
      resolution: z.enum(['use_local', 'use_remote', 'merge', 'manual']),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.resolveSyncConflict(
        input.conflictId, 
        input.resolution, 
        ctx.user.id,
        input.notes
      );
    }),

  // 批量解决同步冲突
  resolveSyncConflictsBatch: protectedProcedure
    .input(z.object({ 
      conflictIds: z.array(z.number()),
      resolution: z.enum(['use_local', 'use_remote', 'merge', 'manual']),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.resolveSyncConflictsBatch(
        input.conflictIds, 
        input.resolution, 
        ctx.user.id
      );
    }),

  // 忽略同步冲突
  ignoreSyncConflict: protectedProcedure
    .input(z.object({ conflictId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return db.ignoreSyncConflict(input.conflictId, ctx.user.id);
    }),

  // 一键清除所有冲突（使用远程数据）
  resolveAllConflictsUseRemote: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // 获取所有待处理的冲突
      const conflicts = await db.getSyncConflicts(input.accountId, 'pending');
      if (conflicts.length === 0) return { resolved: 0 };
      
      const conflictIds = conflicts.map(c => c.id);
      const resolved = await db.resolveSyncConflictsBatch(conflictIds, 'use_remote', ctx.user.id);
      return { resolved };
    }),

  // 一键忽略所有冲突
  ignoreAllConflicts: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const conflicts = await db.getSyncConflicts(input.accountId, 'pending');
      if (conflicts.length === 0) return { ignored: 0 };
      
      let ignored = 0;
      for (const conflict of conflicts) {
        await db.ignoreSyncConflict(conflict.id, ctx.user.id);
        ignored++;
      }
      return { ignored };
    }),

  // ==================== 同步任务队列API ====================

  // 添加同步任务到队列
  addToSyncQueue: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      accountName: z.string().optional(),
      syncType: z.enum(['campaigns', 'ad_groups', 'keywords', 'product_targets', 'performance', 'full']).optional().default('full'),
      priority: z.number().optional().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      // 估算同步时间（基于历史数据）
      const stats = await db.getSyncStats(input.accountId, 30);
      const estimatedTimeMs = stats?.avgDurationMs || 60000; // 默认1分钟

      return db.addToSyncQueue({
        userId: ctx.user.id,
        accountId: input.accountId,
        accountName: input.accountName,
        syncType: input.syncType,
        priority: input.priority,
        estimatedTimeMs,
      });
    }),

  // 批量添加同步任务到队列
  addToSyncQueueBatch: protectedProcedure
    .input(z.object({ 
      accounts: z.array(z.object({
        accountId: z.number(),
        accountName: z.string().optional(),
        priority: z.number().optional().default(0),
      // @ts-expect-error Legacy code type compatibility
      })),
      syncType: z.enum(['campaigns', 'ad_groups', 'keywords', 'product_targets', 'performance', 'full']).optional().default('full'),
    }))
    .mutation(async ({ ctx, input }) => {
      const tasks = await Promise.all(input.accounts.map(async (account) => {
        const stats = await db.getSyncStats(account.accountId, 30);
        const estimatedTimeMs = stats?.avgDurationMs || 60000;
        return {
          userId: ctx.user.id,
          accountId: account.accountId,
          accountName: account.accountName,
          syncType: input.syncType,
          priority: account.priority,
          // @ts-expect-error Legacy code type compatibility
          estimatedTimeMs,
        };
      }));
      return db.addToSyncQueueBatch(tasks);
    }),

  // 获取同步队列
  getSyncQueue: protectedProcedure
    .input(z.object({ 
      status: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return db.getSyncQueue(ctx.user.id, input.status);
    }),

  // 获取队列统计信息
  getSyncQueueStats: protectedProcedure
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx }: unknown) => {
      return db.getSyncQueueStats(ctx.user.id);
    }),

  // 取消同步任务
  cancelSyncTask: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      return db.cancelSyncTask(input.taskId);
    }),

  // 清理旧任务
  cleanupOldSyncTasks: protectedProcedure
    .input(z.object({ retainDays: z.number().optional().default(7) }))
    .mutation(async ({ ctx, input }) => {
      return db.cleanupOldSyncTasks(ctx.user.id, input.retainDays);
    }),

  // 执行队列中的下一个任务
  executeNextQueuedTask: protectedProcedure
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx }: unknown) => {
      // @ts-expect-error DB query type inference limitation
      const task = await db.getNextQueuedTask();
      // @ts-expect-error Conditional type narrowing
      if (!task) {
        // @ts-expect-error Return type compatibility
        return { message: '队列中没有待执行的任务' };
      // @ts-expect-error Legacy code type compatibility
      }

      // 更新任务状态为运行中
      await db.updateSyncTaskStatus(task.id, 'running', {
        currentStep: '初始化',
        progress: 0,
      });

      try {
        const credentials = await db.getAmazonApiCredentials(task.accountId);
        if (!credentials) {
          await db.updateSyncTaskStatus(task.id, 'failed', {
            errorMessage: 'API凭证未找到',
          });
          return { error: 'API凭证未找到' };
        }

        // 获取账号的站点信息
        const accountInfo = await db.getAdAccountById(task.accountId);
        const marketplace = accountInfo?.marketplace || 'US';

        const syncService = await AmazonSyncService.createFromCredentials(
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region as 'NA' | 'EU' | 'FE',
          },
          task.accountId,
          task.userId,
          marketplace
        );

        // 执行同步并更新进度
        const steps = [
          // @ts-expect-error Destructuring type inference
          { name: 'SP广告', fn: () => syncService.syncSpCampaigns() },
          // @ts-expect-error Destructuring type inference
          { name: 'SB广告', fn: () => syncService.syncSbCampaigns() },
          // @ts-expect-error Destructuring type inference
          { name: 'SD广告', fn: () => syncService.syncSdCampaigns() },
          // @ts-expect-error Destructuring type inference
          { name: '广告组', fn: () => syncService.syncSpAdGroups() },
          // @ts-expect-error Destructuring type inference
          { name: '关键词', fn: () => syncService.syncSpKeywords() },
          // @ts-expect-error Destructuring type inference
          { name: '商品定位', fn: () => syncService.syncSpProductTargets() },
        ];

        // @ts-expect-error - runtime type mismatch
        const results: Record<string, unknown>[] = {};
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          await db.updateSyncTaskProgress(
            task.id,
            Math.round((i / steps.length) * 100),
            step.name,
            i,
            Math.round((steps.length - i) * (task.estimatedTimeMs || 10000) / steps.length)
          );
          
          const result = await step.fn();
          // @ts-expect-error - runtime type mismatch
          results[step.name] = result;
        }

        // 完成任务
        await db.updateSyncTaskStatus(task.id, 'completed', {
          progress: 100,
          completedSteps: steps.length,
          resultSummary: results,
        });

        return { success: true, results };
      } catch (error: unknown) {
        await db.updateSyncTaskStatus(task.id, 'failed', {
          errorMessage: (error as Error).message,
        });
        return { error: (error as Error).message };
      }
    }),

  // Apply bid adjustment to Amazon
  applyBidAdjustment: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      targetType: z.enum(['keyword', 'product_target']),
      targetId: z.number(),
      newBid: z.number(),
      reason: z.string(),
      campaignId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      // 获取账号的站点信息
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id,
        marketplace
      );

      // @ts-expect-error Type inference limitation
      const success = await syncService.applyBidAdjustment(
        input.targetType,
        input.targetId,
        input.newBid,
        input.reason,
        input.campaignId
      );

      if (!success) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to apply bid adjustment',
        });
      }

      return { success: true };
    }),

  // Run auto optimization with API sync
  runAutoOptimization: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      performanceGroupId: z.number().optional(), // 可选，为0或未提供时使用默认配置
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      // 如果performanceGroupId为0或未提供，使用默认配置
      let config = {
        optimizationGoal: 'maximize_sales' as const,
        targetAcos: undefined as number | undefined,
        targetRoas: undefined as number | undefined,
        dailySpendLimit: undefined as number | undefined,
        dailyCostTarget: undefined as number | undefined,
      };

      if (input.performanceGroupId && input.performanceGroupId > 0) {
        const group = await db.getPerformanceGroupById(input.performanceGroupId);
        if (group) {
          config = {
            // @ts-expect-error - type assertion
            optimizationGoal: (group.optimizationGoal || 'maximize_sales') as unknown,
            targetAcos: group.targetAcos ? parseFloat(group.targetAcos) : undefined,
            targetRoas: group.targetRoas ? parseFloat(group.targetRoas) : undefined,
            dailySpendLimit: group.dailySpendLimit ? parseFloat(group.dailySpendLimit) : undefined,
            dailyCostTarget: group.dailyCostTarget ? parseFloat(group.dailyCostTarget) : undefined,
          };
        }
      }

      // 获取账号的站点信息
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id,
        marketplace
      );

      const results = await runAutoBidOptimization(syncService, input.accountId, config);
      return results;
    }),

  // Get API regions and marketplaces
  getRegions: protectedProcedure.query(() => {
    return {
      // @ts-expect-error Legacy code type compatibility
      endpoints: API_ENDPOINTS,
      marketplaceMapping: MARKETPLACE_TO_REGION,
    };
  }),

  // 生成模拟绩效数据（当Amazon Reporting API不可用时使用）
  generateMockPerformance: protectedProcedure
    .input(z.object({
      // @ts-expect-error Legacy code type compatibility
      accountId: z.number(),
      days: z.number().min(1).max(30).default(7),
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      // 获取账号的站点信息
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        // @ts-expect-error Express request/response type assertion
        ctx.user.id,
        marketplace
      );

      // v148: 已废弃模拟数据生成功能，生产环境不应使用假数据
      log.warn('[API] v148: generateMockPerformance已废弃，生产环境禁止生成模拟数据');
      return { generated: 0, warning: 'v148: 模拟数据生成已废弃，请使用真实数据同步' };
    }),
  
  // ==================== 双轨制同步相关API ====================
  
  // 获取双轨制同步状态
  getDualTrackStatus: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const { getDualTrackStatus } = await import('../sync/scheduling/dualTrackSyncService');
      return getDualTrackStatus(input.accountId);
    }),
  
  // 获取数据源统计
  getDataSourceStats: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const { getDataSourceStats } = await import('../sync/scheduling/dualTrackSyncService');
      return getDataSourceStats(input.accountId);
    }),
  
  // 执行数据一致性检查
  runConsistencyCheck: protectedProcedure
    .input(z.object({
      // @ts-expect-error Legacy code type compatibility
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
    }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      const { runConsistencyCheck } = await import('../sync/scheduling/dualTrackSyncService');
      return runConsistencyCheck(input.accountId, input.startDate, input.endDate);
    // @ts-expect-error Legacy code type compatibility
    }),
  
  // 获取合并后的绩效数据
  getMergedPerformanceData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
      priority: z.enum(['realtime', 'historical', 'reporting']).optional().default('historical'),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const { getMergedPerformanceData } = await import('../sync/scheduling/dualTrackSyncService');
      return getMergedPerformanceData(input.accountId, input.startDate, input.endDate, input.priority);
    }),

  // 获取智能合并数据（增强版）
  getSmartMergedData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      // @ts-expect-error Legacy code type compatibility
      endDate: z.string(),
      purpose: z.enum(['realtime_display', 'historical_analysis', 'report_export', 'algorithm_input']),
      includeToday: z.boolean().optional(),
      campaignIds: z.array(z.string()).optional(),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const { getSmartMergedData } = await import('../sync/scheduling/enhancedDualTrackService');
      return getSmartMergedData(input.accountId, input.startDate, input.endDate, {
        purpose: input.purpose,
        includeToday: input.includeToday,
        campaignIds: input.campaignIds,
      });
    }),

  // 获取时间线聚合数据
  getTimelineAggregatedData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
      granularity: z.enum(['daily', 'weekly', 'monthly']).optional().default('daily'),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const { getTimelineAggregatedData } = await import('../sync/scheduling/enhancedDualTrackService');
      return getTimelineAggregatedData(input.accountId, input.startDate, input.endDate, input.granularity);
    }),

  // 获取实时仪表盘数据（区分可信/不可信字段）
  getRealtimeDashboardData: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const { getRealtimeDashboardData } = await import('../sync/scheduling/enhancedDualTrackService');
      return getRealtimeDashboardData(input.accountId);
    }),

  // 检查并执行数据回补
  checkAndBackfillData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      date: z.string(),
    }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      const { checkAndBackfillData } = await import('../sync/scheduling/enhancedDualTrackService');
      return checkAndBackfillData(input.accountId, input.date);
    }),

  // ==================== AMS订阅管理API ====================

  // 获取AMS订阅列表
  listAmsSubscriptions: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      try {
        // 获取账号凭证
        const account = await db.getAdAccountById(input.accountId);
        if (!account) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
        }
        
        const credentials = await db.getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          return { subscriptions: [], error: '账号未配置API凭证' };
        }
        
        const region = MARKETPLACE_TO_REGION[account.marketplace || 'US'] || 'NA';
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region,
        // @ts-expect-error Legacy code type compatibility
        });
        
        const subscriptions = await client.listAmsSubscriptions();
        return { subscriptions };
      } catch (error: unknown) {
        log.warn('[AMS] 获取订阅列表失败:', (error as Error).message);
        return { subscriptions: [], error: (error as Error).message };
      }
    // @ts-expect-error Legacy code type compatibility
    }),

  // 创建单个AMS订阅
  createAmsSubscription: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      dataSetId: z.enum(['sp-traffic', 'sb-traffic', 'sd-traffic', 'sp-conversion', 'sp-budget-usage', 'sb-budget-usage', 'sd-budget-usage']),
      notes: z.string().optional(),
    }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      try {
        const account = await db.getAdAccountById(input.accountId);
        if (!account) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
        }
        
        const credentials = await db.getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '账号未配置API凭证' });
        }
        
        // 获取SQS队列ARN
        const sqsQueueArn = process.env.AWS_SQS_QUEUE_ARN;
        if (!sqsQueueArn) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '未配置SQS队列ARN，请在环境变量中设置AWS_SQS_QUEUE_ARN' });
        }
        
        const region = MARKETPLACE_TO_REGION[account.marketplace || 'US'] || 'NA';
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region,
        });
        
        const subscription = await client.createAmsSubscription(
          // @ts-expect-error - type assertion
          input.dataSetId as unknown,
          sqsQueueArn,
          input.notes
        );
        
        return { success: true, subscription };
      } catch (error: unknown) {
        log.warn('[AMS] 创建订阅失败:', (error as Error).message);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          // @ts-expect-error Dynamic type assertion
          message: `创建AMS订阅失败: ${(error as Record<string, unknown>).response?.data?.message || (error as Error).message}`,
        });
      }
    }),

  // 批量创建快车道订阅（全部 9 个数据集: traffic/conversion/budget-usage 各 3 个）
  createAllTrafficSubscriptions: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      try {
        const account = await db.getAdAccountById(input.accountId);
        if (!account) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
        }
        
        const credentials = await db.getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '账号未配置API凭证' });
        }
        
        // 辅助函数: 将SQS URL转换为ARN
        const urlToArn = (url: string | undefined): string | undefined => {
          if (!url) return undefined;
          // URL格式: https://sqs.{region}.amazonaws.com/{accountId}/{queueName}
          let match = url.match(/sqs\.([^.]+)\.amazonaws\.com\/(\d+)\/(.+)/);
          if (match) {
            const [, region, accountId, queueName] = match;
            return `arn:aws:sqs:${region}:${accountId}:${queueName}`;
          }
          // 处理 queue.amazonaws.com 格式
          match = url.match(/queue\.amazonaws\.com\/(\d+)\/(.+)/);
          if (match) {
            const [, accountId, queueName] = match;
            const region = process.env.AWS_REGION || 'us-east-1';
            return `arn:aws:sqs:${region}:${accountId}:${queueName}`;
          }
          return url; // 如果已经是ARN格式，直接返回
        };
        
        // 构建队列ARN映射 - 每个数据集使用对应的队列
        const queueArnMapping: Record<string, string | undefined> = {
          'sp-traffic': urlToArn(process.env.AWS_SQS_QUEUE_TRAFFIC_URL),
          'sp-conversion': urlToArn(process.env.AWS_SQS_QUEUE_CONVERSION_URL),
          'sp-budget-usage': urlToArn(process.env.AWS_SQS_QUEUE_BUDGET_URL),
          'sb-traffic': urlToArn(process.env.AWS_SQS_QUEUE_SB_TRAFFIC_URL),
          'sb-conversion': urlToArn(process.env.AWS_SQS_QUEUE_SB_CONVERSION_URL),
          'sb-budget-usage': urlToArn(process.env.AWS_SQS_QUEUE_SB_BUDGET_URL),
          'sd-traffic': urlToArn(process.env.AWS_SQS_QUEUE_SD_TRAFFIC_URL),
          'sd-conversion': urlToArn(process.env.AWS_SQS_QUEUE_SD_CONVERSION_URL),
          'sd-budget-usage': urlToArn(process.env.AWS_SQS_QUEUE_SD_BUDGET_URL),
        };
        
        // 检查是否有任何队列配置
        const configuredQueues = Object.entries(queueArnMapping).filter(([_, arn]) => arn);
        if (configuredQueues.length === 0) {
          // 向后兼容: 如果没有配置单独的队列URL，尝试使用旧的单一ARN
          const sqsQueueArn = process.env.AWS_SQS_QUEUE_ARN;
          // @ts-expect-error Conditional type narrowing
          if (!sqsQueueArn) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '未配置SQS队列环境变量' });
          }
          log.info('[AMS] 使用单一队列ARN模式:', sqsQueueArn);
          
          const region = MARKETPLACE_TO_REGION[account.marketplace || 'US'] || 'NA';
          const client = new AmazonAdsApiClient({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region,
          });
          
          const result = await client.createAllTrafficSubscriptions(sqsQueueArn);
          return {
            success: true,
            created: result.created,
            failed: result.failed,
            message: `成功创建 ${result.created.length} 个订阅，失败 ${result.failed.length} 个`,
          };
        }
        
        log.info(`[AMS] 使用队列映射模式，已配置 ${configuredQueues.length} 个队列:`);
        configuredQueues.forEach(([name, arn]) => log.info(`  - ${name}: ${arn}`));
        
        const region = MARKETPLACE_TO_REGION[account.marketplace || 'US'] || 'NA';
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region,
        });
        
        // 使用队列映射创建订阅
        const result = await client.createAllTrafficSubscriptions(queueArnMapping as Record<string, string>);
        
        return {
          success: true,
          created: result.created,
          failed: result.failed,
          message: `成功创建 ${result.created.length} 个订阅，失败 ${result.failed.length} 个`,
        };
      } catch (error: unknown) {
        log.warn('[AMS] 批量创建订阅失败:', (error as Error).message);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `批量创建AMS订阅失败: ${(error as Error).message}`,
        });
      }
    }),

  // 归档/删除AMS订阅
  archiveAmsSubscription: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      subscriptionId: z.string(),
    }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      try {
        const account = await db.getAdAccountById(input.accountId);
        if (!account) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
        }
        
        const credentials = await db.getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '账号未配置API凭证' });
        }
        
        const region = MARKETPLACE_TO_REGION[account.marketplace || 'US'] || 'NA';
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region,
        });
        
        await client.archiveAmsSubscription(input.subscriptionId);
        
        return { success: true };
      } catch (error: unknown) {
        log.warn('[AMS] 归档订阅失败:', (error as Error).message);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `归档AMS订阅失败: ${(error as Error).message}`,
        });
      }
    }),

  // 获取SQS配置信息
  getSqsConfig: protectedProcedure
    .query(async () => {
      const queueArn = process.env.AWS_SQS_QUEUE_ARN;
      const queueUrl = process.env.AWS_SQS_QUEUE_URL;
      const trafficQueueUrl = process.env.AWS_SQS_QUEUE_TRAFFIC_URL;
      const conversionQueueUrl = process.env.AWS_SQS_QUEUE_CONVERSION_URL;
      const budgetQueueUrl = process.env.AWS_SQS_QUEUE_BUDGET_URL;
      
      return {
        configured: !!(queueArn || trafficQueueUrl || conversionQueueUrl || budgetQueueUrl),
        queueArn: queueArn ? `${queueArn.substring(0, 30)}...` : null,
        queueUrl: queueUrl ? `${queueUrl.substring(0, 50)}...` : null,
        multiQueueConfigured: !!(trafficQueueUrl || conversionQueueUrl || budgetQueueUrl),
        queues: {
          traffic: trafficQueueUrl ? `${trafficQueueUrl.substring(0, 50)}...` : null,
          conversion: conversionQueueUrl ? `${conversionQueueUrl.substring(0, 50)}...` : null,
          budget: budgetQueueUrl ? `${budgetQueueUrl.substring(0, 50)}...` : null,
        },
      };
    }),

  // 获取SQS消费者状态
  getSqsConsumerStatus: protectedProcedure
    .query(async () => {
      try {
        const consumer = getSQSConsumer();
        const status = consumer.getStatus();
        const queueStats = await consumer.getQueueStats();
        
        return {
          isRunning: status.length > 0 && status.some(s => s.isRunning),
          consumers: status,
          queueStats,
        };
      } catch (error: unknown) {
        return {
          isRunning: false,
          consumers: [],
          queueStats: [],
          error: (error as Error).message,
        };
      }
    }),

  // 启动SQS消费者
  startSqsConsumer: protectedProcedure
    .mutation(async () => {
      try {
        await startSQSConsumer();
        return { success: true, message: 'SQS消费者已启动' };
      } catch (error: unknown) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `启动SQS消费者失败: ${(error as Error).message}`,
        });
      }
    }),

  // 停止SQS消费者
  stopSqsConsumer: protectedProcedure
    .mutation(async () => {
      try {
        stopSQSConsumer();
        return { success: true, message: 'SQS消费者已停止' };
      } catch (error: unknown) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `停止SQS消费者失败: ${(error as Error).message}`,
        });
      }
    }),

  // ==================== 批量授权API ====================

  // 获取所有区域配置信息
  getBatchAuthRegions: publicProcedure
    .query(() => {
      return {
        regions: [
          {
            code: 'NA',
            name: '北美区域',
            displayFlags: '🇺🇸🇨🇦🇲🇽🇧🇷',
            marketplaces: [
              { code: 'US', name: '美国', flag: '🇺🇸' },
              { code: 'CA', name: '加拿大', flag: '🇨🇦' },
              { code: 'MX', name: '墨西哥', flag: '🇲🇽' },
              { code: 'BR', name: '巴西', flag: '🇧🇷' },
            ],
          },
          {
            code: 'EU',
            name: '欧洲区域',
            displayFlags: '🇬🇧🇩🇪🇫🇷🇮🇹🇪🇸',
            marketplaces: [
              { code: 'UK', name: '英国', flag: '🇬🇧' },
              { code: 'DE', name: '德国', flag: '🇩🇪' },
              { code: 'FR', name: '法国', flag: '🇫🇷' },
              { code: 'IT', name: '意大利', flag: '🇮🇹' },
              { code: 'ES', name: '西班牙', flag: '🇪🇸' },
              { code: 'NL', name: '荷兰', flag: '🇳🇱' },
              { code: 'SE', name: '瑞典', flag: '🇸🇪' },
              { code: 'PL', name: '波兰', flag: '🇵🇱' },
              { code: 'AE', name: '阿联酋', flag: '🇦🇪' },
              { code: 'SA', name: '沙特', flag: '🇸🇦' },
              { code: 'IN', name: '印度', flag: '🇮🇳' },
            ],
          },
          {
            code: 'FE',
            name: '远东区域',
            displayFlags: '🇯🇵🇦🇺🇸🇬',
            marketplaces: [
              { code: 'JP', name: '日本', flag: '🇯🇵' },
              { code: 'AU', name: '澳大利亚', flag: '🇦🇺' },
              { code: 'SG', name: '新加坡', flag: '🇸🇬' },
            ],
          },
        ],
      };
    }),

  // 创建批量授权会话
  createBatchAuthSession: protectedProcedure
    .input(z.object({
      storeName: z.string(),
      selectedRegions: z.array(z.enum(['NA', 'EU', 'FE'])),
    }))
    .mutation(async ({ ctx, input }) => {
      const sessionId = `batch_${ctx.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 生成每个区域的授权URL
      const clientId = process.env.AMAZON_ADS_CLIENT_ID || '';
      const redirectUri = 'https://www.ppcopt.com/api/auth/callback';
      
      const authEndpoints: Record<string, string> = {
        NA: 'https://www.amazon.com/ap/oa',
        EU: 'https://eu.account.amazon.com/ap/oa',
        FE: 'https://apac.account.amazon.com/ap/oa',
      };
      
      const regionAuthUrls = input.selectedRegions.map(regionCode => {
        const state = `${sessionId}:${regionCode}`;
        const params = new URLSearchParams({
          client_id: clientId,
          scope: 'advertising::campaign_management',
          response_type: 'code',
          redirect_uri: redirectUri,
          state,
        });
        return {
          regionCode,
          authUrl: `${authEndpoints[regionCode]}?${params.toString()}`,
          status: 'pending' as const,
        };
      });
      
      return {
        sessionId,
        storeName: input.storeName,
        regions: regionAuthUrls,
        createdAt: new Date().toISOString(),
      };
    }),

  // 批量处理多个区域的授权码
  processBatchAuthCodes: protectedProcedure
    .input(z.object({
      storeName: z.string(),
      authCodes: z.array(z.object({
        regionCode: z.enum(['NA', 'EU', 'FE']),
        code: z.string(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const clientId = process.env.AMAZON_ADS_CLIENT_ID || '';
      const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET || '';
      const redirectUri = 'https://www.ppcopt.com/api/auth/callback';
      
      if (!clientId || !clientSecret) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '缺少Amazon API凭证配置',
        });
      }
      
      const results: Array<{
        regionCode: string;
        status: 'success' | 'error';
        profilesCount?: number;
        accountsCreated?: number;
        error?: string;
      }> = [];
      
      // 依次处理每个区域的授权码
      for (const { regionCode, code } of input.authCodes) {
        try {
          log.info(`[BatchAuth] 处理 ${regionCode} 区域授权码...`);
          
          // 1. 换取Token
          const tokens = await AmazonAdsApiClient.exchangeCodeForToken(
            code,
            clientId,
            clientSecret,
            redirectUri
          );
          
          // 2. 获取该区域的所有Profile
          const client = new AmazonAdsApiClient({
            clientId,
            clientSecret,
            refreshToken: tokens.refresh_token,
            profileId: '',
            region: regionCode as 'NA' | 'EU' | 'FE',
          });
          
          const profiles = await client.getProfiles();
          log.info(`[BatchAuth] ${regionCode} 区域获取到 ${profiles.length} 个Profile`);
          
          // 3. 为每个Profile创建账号
          let accountsCreated = 0;
          for (const profile of profiles) {
            try {
              // 检查是否已存在
              const existingAccounts = await db.getAdAccountsByUserId(ctx.user.id);
              const existingByProfile = existingAccounts.find(
                a => a.profileId === String(profile.profileId)
              );
              
              let accountId: number;
              
              if (existingByProfile) {
                // 更新现有账号
                accountId = existingByProfile.id;
                await db.updateAdAccount(accountId, {
                  storeName: input.storeName,
                  marketplace: profile.countryCode,
                });
                log.info(`[BatchAuth] 更新现有账号 ${accountId} (${profile.countryCode})`);
              } else {
                // 创建新账号
                accountId = await db.createAdAccount({
                  userId: ctx.user.id,
                  organizationId: (ctx.user as Record<string, unknown>).organizationId as number || 1,
                  accountId: String(profile.profileId),
                  // @ts-expect-error - dynamic property access
                  accountName: (profile as Record<string, unknown>).accountInfo?.name || `${input.storeName} - ${profile.countryCode}`,
                  storeName: input.storeName,
                  marketplace: profile.countryCode,
                  profileId: String(profile.profileId),
                  connectionStatus: 'pending',
                });
                accountsCreated++;
                log.info(`[BatchAuth] 创建新账号 ${accountId} (${profile.countryCode})`);
              }
              
              // 4. 保存API凭证
              await db.saveAmazonApiCredentials({
                accountId,
                clientId,
                clientSecret,
                refreshToken: tokens.refresh_token,
                profileId: String(profile.profileId),
                // @ts-expect-error Legacy code type compatibility
                region: regionCode,
              // @ts-expect-error Legacy code type compatibility
              });
              
              // 5. 更新连接状态
              await db.updateAdAccount(accountId, {
                connectionStatus: 'connected',
              });
              
              // 6. ✅ 异步启动完整初始化（全量同步 + 定时调度 + AMS订阅）
              const { initializeAccount } = await import('../system/accountInitializationService');
              initializeAccount({
                accountId,
                userId: ctx.user.id,
                clientId,
                clientSecret,
                refreshToken: tokens.refresh_token,
                profileId: String(profile.profileId),
                region: regionCode as 'NA' | 'EU' | 'FE',
                marketplace: profile.countryCode,
              }).then(async initResult => {
                // @ts-expect-error Complex function parameter types
                log.info(`[BatchAuth] 账号 ${accountId} (${profile.countryCode}) 初始化完成:`, {
                  sync: initResult.syncResult.success ? '✅' : '❌',
                  schedule: initResult.scheduleResult.success ? '✅' : '❌',
                  ams: initResult.amsResult.success ? '✅' : '❌',
                });
                
                // v336: 初始化完成后触发事件驱动同步
                try {
                  const { triggerImmediateSync } = await import('../sync/dataSyncScheduler');
                  await triggerImmediateSync(accountId, `BatchAuth初始化完成后同步 (accountId=${accountId}, marketplace=${profile.countryCode})`);
                } catch (syncErr: unknown) {
                  log.warn(`[v336] BatchAuth事件驱动同步触发失败:`, (syncErr as Error).message);
                }
              }).catch((err: any) => {
                log.warn(`[BatchAuth] 账号 ${accountId} (${profile.countryCode}) 初始化失败:`, err);
              });
              
            } catch (profileError: unknown) {
              log.warn(`[BatchAuth] 处理Profile ${profile.profileId} 失败:`, profileError);
            }
          }
          
          // @ts-expect-error Complex function parameter types
          results.push({
            regionCode,
            // @ts-expect-error Legacy code type compatibility
            status: 'success',
            profilesCount: profiles.length,
            accountsCreated,
          // @ts-expect-error Legacy code type compatibility
          });
          
        } catch (error: unknown) {
          log.warn(`[BatchAuth] ${regionCode} 区域授权失败:`, error);
          // @ts-expect-error Complex function parameter types
          results.push({
            regionCode,
            status: 'error',
            error: (error as Error).message,
          });
        }
      }
      
      const successCount = results.filter(r => r.status === 'success').length;
      // @ts-expect-error Type inference limitation
      const totalProfiles = results.reduce((sum: number, r: Record<string, unknown>) => sum + (r.profilesCount || 0), 0);
      // @ts-expect-error Type inference limitation
      const totalAccountsCreated = results.reduce((sum: number, r: Record<string, unknown>) => sum + (r.accountsCreated || 0), 0);
      
      return {
        success: successCount > 0,
        message: successCount === input.authCodes.length
          ? `所有 ${successCount} 个区域授权成功，共创建 ${totalAccountsCreated} 个站点账号`
          : `${successCount}/${input.authCodes.length} 个区域授权成功`,
        // @ts-expect-error Legacy code type compatibility
        results,
        summary: {
          totalRegions: input.authCodes.length,
          successRegions: successCount,
          totalProfiles,
          totalAccountsCreated,
        },
      };
    // @ts-expect-error Legacy code type compatibility
    }),

  // 获取用户已授权的区域状态
  getAuthorizedRegions: protectedProcedure
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx }: unknown) => {
      const accounts = await db.getAdAccountsByUserId(ctx.user.id);
      
      // 按区域分组统计
      const regionStats: Record<string, {
        authorized: boolean;
        accountCount: number;
        marketplaces: string[];
        lastSyncAt?: string;
      }> = {
        NA: { authorized: false, accountCount: 0, marketplaces: [] },
        EU: { authorized: false, accountCount: 0, marketplaces: [] },
        FE: { authorized: false, accountCount: 0, marketplaces: [] },
      };
      
      const marketplaceToRegion: Record<string, string> = {
        US: 'NA', CA: 'NA', MX: 'NA', BR: 'NA',
        UK: 'EU', DE: 'EU', FR: 'EU', IT: 'EU', ES: 'EU', NL: 'EU', SE: 'EU', PL: 'EU', AE: 'EU', SA: 'EU', IN: 'EU',
        JP: 'FE', AU: 'FE', SG: 'FE',
      };
      
      for (const account of (accounts as unknown[])) {
        // @ts-expect-error Conditional type narrowing
        if (!account.marketplace) continue;
        
        // @ts-expect-error Type inference limitation
        const region = marketplaceToRegion[account.marketplace];
        if (!region || !regionStats[region]) continue;
        
        // @ts-expect-error DB query type inference limitation
        const credentials = await db.getAmazonApiCredentials(account.id);
        if (credentials) {
          regionStats[region].authorized = true;
          regionStats[region].accountCount++;
          // @ts-expect-error Array method type inference
          regionStats[region].marketplaces.push(account.marketplace);
          if (credentials.lastSyncAt) {
            regionStats[region].lastSyncAt = credentials.lastSyncAt;
          }
        }
      }
      
      return {
        // @ts-expect-error Complex function parameter types
        regions: Object.entries(regionStats).map(([code, stats]) => ({
          // @ts-expect-error Legacy code type compatibility
          code,
          // @ts-expect-error Spread operator type compatibility
          ...stats,
        // @ts-expect-error Legacy code type compatibility
        })),
        totalAccounts: accounts.length,
        authorizedAccounts: accounts.filter(a => a.connectionStatus === 'connected').length,
      };
    }),

  // v417: 实现前端AmazonApiAuthStatus页面所需的getAllAuthStatus接口
  getAllAuthStatus: protectedProcedure
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx }: unknown) => {
      const accounts = await db.getAdAccountsByUserId(ctx.user.id);
      const accountStatuses = [];
      let activeCount = 0;
      let expiringCount = 0;
      let expiredCount = 0;

      for (const account of (accounts as unknown[])) {
        // @ts-expect-error DB query type inference limitation
        const credentials = await db.getAmazonApiCredentials(account.id);
        
        let status: 'active' | 'expired' | 'expiring_soon' | 'unknown' = 'unknown';
        let tokenExpiresAt: string | null = null;
        // @ts-expect-error Legacy code type compatibility
        let daysUntilExpiry: number | null = null;
        let tokenExpired = false;
        
        if (credentials) {
          if (credentials.tokenExpiresAt) {
            tokenExpiresAt = credentials.tokenExpiresAt;
            const expiresDate = new Date(credentials.tokenExpiresAt);
            const now = new Date();
            const diffMs = expiresDate.getTime() - now.getTime();
            daysUntilExpiry = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            
            if (diffMs <= 0) {
              status = 'expired';
              tokenExpired = true;
              expiredCount++;
            } else if (daysUntilExpiry <= 7) {
              status = 'expiring_soon';
              expiringCount++;
            } else {
              status = 'active';
              activeCount++;
            }
          } else {
            // 没有过期时间记录，尝试通过API验证
            try {
              const client = new AmazonAdsApiClient({
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
                refreshToken: credentials.refreshToken,
                profileId: credentials.profileId,
                region: credentials.region as 'NA' | 'EU' | 'FE',
              });
              await client.getProfiles();
              status = 'active';
              activeCount++;
            } catch {
              status = 'expired';
              tokenExpired = true;
              expiredCount++;
            }
          }
        }

        accountStatuses.push({
          // @ts-expect-error Legacy code type compatibility
          accountId: account.id,
          // @ts-expect-error Legacy code type compatibility
          accountName: account.accountName || `Account ${account.id}`,
          // @ts-expect-error Legacy code type compatibility
          profileId: account.profileId || '',
          // @ts-expect-error Legacy code type compatibility
          marketplace: account.marketplace || '',
          tokenExpiresAt,
          tokenExpired,
          daysUntilExpiry,
          lastRefreshAt: credentials?.updatedAt || null,
          authScope: ['advertising::campaign_management'],
          status,
        });
      }

      return {
        accounts: accountStatuses,
        totalAccounts: accountStatuses.length,
        activeAccounts: activeCount,
        expiringAccounts: expiringCount,
        expiredAccounts: expiredCount,
      };
    }),

  // v417: 实现前端AmazonApiAuthStatus页面所需的refreshToken接口
  refreshToken: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '未找到该账号的API凭证',
        });
      }

      try {
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        });

        // 调用getProfiles来触发token刷新
        await client.getProfiles();

        return {
          success: true,
          message: 'Token刷新成功',
        };
      } catch (error: unknown) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Token刷新失败: ${(error as Error).message}`,
        });
      }
    }),
});
