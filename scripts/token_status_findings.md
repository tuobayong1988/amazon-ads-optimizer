# LERUCCI Token状态 - 决定性证据

## LERUCCI 三个账户（90025/90026/90027）
- accessToken: **NULL** (长度为None)
- tokenExpiresAt: **NULL**
- refreshToken: 存在 (567字符, 前缀 Atzr|IwEBIMm8gAsH_oJG7ey4dKTpI)
- clientId: amzn1.application-oa2-client.e6536f0b89044ae4a40a9289efc33053

## 正常工作的账户（90021/90023）
- accessToken: **有值** (519-520字符, 前缀 Atza|...)
- tokenExpiresAt: 2026-01-29 23:21:50 (已过期但能自动刷新)
- refreshToken: 存在 (567字符, **相同的前缀** Atzr|IwEBIMm8gAsH_oJG7ey4dKTpI)
- clientId: 相同

## 异常账户（90022）
- accessToken: **NULL** (与LERUCCI相同的问题!)
- tokenExpiresAt: **NULL**

## 根因分析
1. 所有6个凭证共享**完全相同的Refresh Token**
2. LERUCCI三个账户的accessToken为NULL，说明Token刷新从未成功过
3. 正常账户(90021/90023)有accessToken，说明它们的Token刷新成功了
4. 90022也是NULL，可能也有同样的问题

## 关键问题
- Refresh Token相同，为什么有些账户能刷新成功，有些不能？
- 可能是Token刷新的竞态条件：90021/90023先刷新成功，后续的刷新请求使旧Token失效
- 或者是LERUCCI账户的Profile权限问题
