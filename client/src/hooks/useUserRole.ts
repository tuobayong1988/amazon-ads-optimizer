/**
 * useUserRole - 用户角色权限Hook
 * 用于判断用户是否为平台管理员，控制技术细节的显示
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { useMemo } from "react";

// 平台所有者的openId（环境变量配置）
const PLATFORM_OWNER_OPEN_ID = import.meta.env.VITE_OWNER_OPEN_ID || "";

export interface UserRoleInfo {
  isPlatformOwner: boolean;  // 是否为平台所有者（最高权限）
  isAdmin: boolean;          // 是否为管理员
  isRegularUser: boolean;    // 是否为普通用户
  canViewTechnicalDetails: boolean;  // 是否可以查看技术细节（SQS/AWS配置）
  canManageAmsSubscriptions: boolean; // 是否可以管理AMS订阅
  canViewAllUsers: boolean;  // 是否可以查看所有用户
}

export function useUserRole(): UserRoleInfo {
  const { user } = useAuth();

  return useMemo(() => {
    if (!user) {
      return {
        isPlatformOwner: false,
        isAdmin: false,
        isRegularUser: false,
        canViewTechnicalDetails: false,
        canManageAmsSubscriptions: false,
        canViewAllUsers: false,
      };
    }

    const isPlatformOwner = user.openId === PLATFORM_OWNER_OPEN_ID;
    const isAdmin = user.role === "admin" || isPlatformOwner;
    const isRegularUser = !isAdmin;

    return {
      isPlatformOwner,
      isAdmin,
      isRegularUser,
      // 只有平台所有者可以查看SQS/AWS等技术细节
      canViewTechnicalDetails: isPlatformOwner,
      // 管理员可以管理AMS订阅
      canManageAmsSubscriptions: isAdmin,
      // 管理员可以查看所有用户
      canViewAllUsers: isAdmin,
    };
  }, [user]);
}

export default useUserRole;
