#!/usr/bin/env python3
"""
v734.8 修复脚本
修复saveMultipleProfiles中的跨卖家Profile混入漏洞

核心修复：
FIX-A: 在saveMultipleProfiles的for循环中添加sellerId验证
       - 如果用户声明了sellerId，则只处理sellerId匹配的profiles
       - 不匹配的profiles会被跳过并记录日志
FIX-B: 在创建新账户时，必须有有效的sellerId
       - 如果profile没有sellerId且用户也没有声明sellerId，则跳过创建
"""

import shutil
import os

# 复制v734.7为v734.8
src = '/home/ubuntu/v734.7'
dst = '/home/ubuntu/v734.8'
if os.path.exists(dst):
    shutil.rmtree(dst)
shutil.copytree(src, dst)

# 读取代码
code_path = os.path.join(dst, 'dist/index.js')
with open(code_path, 'r') as f:
    content = f.read()

# ============================================================
# FIX-A: 在saveMultipleProfiles的for循环开头添加sellerId验证
# ============================================================

# 找到for循环中处理每个profile的开头
# 原始代码: for(let m of e.profiles)try{let g=s[m.countryCode]||m.countryCode,f=m.countryCode,h=m.sellerId||n,
# 在 h=m.sellerId||n 之后添加sellerId验证

old_for_start = 'for(let m of e.profiles)try{let g=s[m.countryCode]||m.countryCode,f=m.countryCode,h=m.sellerId||n,'

# 新代码：在获取h(sellerId)之后，添加验证逻辑
new_for_start = '''for(let m of e.profiles)try{let g=s[m.countryCode]||m.countryCode,f=m.countryCode,h=m.sellerId||n;if(n&&h&&h!==n){Rn.info(`[saveMultipleProfiles] v348: ⛔ Profile ${m.profileId}(${m.countryCode})的sellerId(${h})与声明的sellerId(${n})不匹配，跳过此profile`);c.push({profileId:m.profileId,countryCode:m.countryCode,accountId:0,success:false,error:`sellerId mismatch: profile=${h}, declared=${n}`});continue}let'''

# Wait, we need to be more careful. The original code after h= continues with:
# y=await Jo(t.user.id), ...
# So we need to preserve the variable declarations

# Let me re-read the exact code more carefully
# Original: for(let m of e.profiles)try{let g=s[m.countryCode]||m.countryCode,f=m.countryCode,h=m.sellerId||n,y=await Jo(t.user.id),...

# The issue is that g, f, h, y, w, S, A are all declared in the same let statement
# We can't just insert code in the middle of a let declaration

# Better approach: insert the check AFTER the let declaration block
# Find the end of the let declaration (before the first if statement)

# The let block ends with: A=!0;
# Then: S&&h&&S.sellerId&&S.sellerId!==h&&(A=!1,...

# So we insert AFTER h=m.sellerId||n and BEFORE y=await Jo(t.user.id)
# But they're in the same let statement...

# Alternative: insert BEFORE the for loop, filter the profiles array
old_before_for = 'let s={US:'
# Actually, let's insert the filter right before the for loop starts

# Find the exact position of the for loop
for_pos = content.find('for(let m of e.profiles)try{let g=s[m.countryCode]')
if for_pos < 0:
    print("ERROR: Could not find for loop!")
    exit(1)

print(f"Found for loop at position {for_pos}")

# Insert sellerId filter BEFORE the for loop
# We'll filter e.profiles to only include matching sellerIds
seller_filter = '''let _v348_filteredProfiles=e.profiles;if(n){_v348_filteredProfiles=e.profiles.filter(_p=>{let _sid=_p.sellerId||n;if(_sid!==n){Rn.info(`[saveMultipleProfiles] v348: ⛔ Profile ${_p.profileId}(${_p.countryCode})的sellerId(${_sid})与声明的sellerId(${n})不匹配，跳过`);c.push({profileId:_p.profileId,countryCode:_p.countryCode,accountId:0,success:false,error:`sellerId mismatch: profile=${_sid}, declared=${n}`});return false}return true});Rn.info(`[saveMultipleProfiles] v348: sellerId过滤: ${e.profiles.length}个profiles -> ${_v348_filteredProfiles.length}个匹配`)}'''

# Replace "for(let m of e.profiles)" with "for(let m of _v348_filteredProfiles)"
old_for = 'for(let m of e.profiles)try{'
new_for = 'for(let m of _v348_filteredProfiles)try{'

content = content[:for_pos] + seller_filter + content[for_pos:]

# Now replace the for loop to use filtered profiles
content = content.replace(old_for, new_for, 1)

# ============================================================
# FIX-B: 在创建新账户时，要求有效的sellerId
# ============================================================

# 找到创建新账户的代码
old_create = 'x=await qf({userId:t.user.id,organizationId:t.user.organizationId||1,storeName:a,accountName:`${a} ${f}`,accountId:m.profileId,marketplace:f,profileId:m.profileId,connectionStatus:"pending",sellerId:h||void 0})'

new_create = '''(()=>{if(!h){Rn.info(`[saveMultipleProfiles] v348: ⛔ Profile ${m.profileId}(${m.countryCode})没有sellerId，跳过创建新账户`);return null}return null})();if(!h){c.push({profileId:m.profileId,countryCode:m.countryCode,accountId:0,success:false,error:"no sellerId, skip create"});continue}x=await qf({userId:t.user.id,organizationId:t.user.organizationId||1,storeName:a,accountName:`${a} ${f}`,accountId:m.profileId,marketplace:f,profileId:m.profileId,connectionStatus:"pending",sellerId:h})'''

if old_create in content:
    content = content.replace(old_create, new_create, 1)
    print("FIX-B: Added sellerId requirement for new account creation")
else:
    print("WARNING: Could not find create account code for FIX-B")

# Write the modified code
with open(code_path, 'w') as f:
    f.write(content)

print(f"\nv734.8 fixes applied to {code_path}")
print(f"File size: {len(content)} bytes")
