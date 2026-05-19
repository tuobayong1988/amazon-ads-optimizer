import { eq } from 'drizzle-orm';
import { adAccounts } from '../../drizzle/schema';

export interface CampaignDimensionContext {
  profileId: string | null;
  marketplaceId: string | null;
  storeId: number | null;
  countryCode: string | null;
}

interface CampaignDimensionSource {
  accountId: number;
  marketplace?: string | null;
  client?: {
    getProfileId?: () => unknown;
  } | null;
}

function normalizeDimensionString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function normalizeStoreId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function dimensionsForCampaignUpsert(context: CampaignDimensionContext): Record<string, string | number | null> {
  return {
    profileId: context.profileId,
    marketplaceId: context.marketplaceId,
    storeId: context.storeId,
    countryCode: context.countryCode,
  };
}

export async function loadCampaignDimensionContext(db: any, source: CampaignDimensionSource): Promise<CampaignDimensionContext> {
  const marketplace = normalizeDimensionString(source.marketplace);
  let accountRow: {
    accountId: string | null;
    storeId: number | null;
    profileId: string | null;
    marketplace: string | null;
    marketplaceId: string | null;
  } | null = null;

  try {
    const [row] = await db.select({
      accountId: adAccounts.accountId,
      storeId: adAccounts.storeId,
      profileId: adAccounts.profileId,
      marketplace: adAccounts.marketplace,
      marketplaceId: adAccounts.marketplaceId,
    })
      .from(adAccounts)
      .where(eq(adAccounts.id, source.accountId))
      .limit(1);
    accountRow = row || null;
  } catch {
    accountRow = null;
  }

  let clientProfileId: string | null = null;
  try {
    clientProfileId = typeof source.client?.getProfileId === 'function'
      ? normalizeDimensionString(source.client.getProfileId())
      : null;
  } catch {
    clientProfileId = null;
  }

  const profileId = normalizeDimensionString(accountRow?.profileId) || clientProfileId || normalizeDimensionString(accountRow?.accountId);
  const marketplaceId = normalizeDimensionString(accountRow?.marketplaceId)
    || normalizeDimensionString(accountRow?.marketplace)
    || marketplace;
  const countryCode = normalizeDimensionString(accountRow?.marketplace) || marketplace;
  const storeId = normalizeStoreId(accountRow?.storeId);

  return {
    profileId,
    marketplaceId,
    storeId,
    countryCode,
  };
}
