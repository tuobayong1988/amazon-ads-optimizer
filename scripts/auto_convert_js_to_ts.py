#!/usr/bin/env python3
"""
自动将从 esbuild bundle 提取的 JS 模块转换为 TypeScript 源码。
不依赖外部 LLM API，使用确定性的代码转换规则。

策略：
1. 解析 esbuild 产物的模块结构（__export, __name 等）
2. 推断 import 语句（从仓库中已有的 TS 文件和 drizzle schema）
3. 清理 esbuild 包装代码
4. 添加基本的 TypeScript 类型注解（any 占位，后续完善）
5. 生成可编译的 TypeScript 文件
"""

import os
import re
import json

EXTRACTED_DIR = "/home/ubuntu/amazon-ads-optimizer/scripts/extracted_modules"
REPO_DIR = "/home/ubuntu/amazon-ads-optimizer"
OUTPUT_DIR = "/home/ubuntu/amazon-ads-optimizer"  # Write directly to repo

# Common import patterns detected from the codebase
IMPORT_PATTERNS = {
    'getDb': "import { getDb } from '../db';",
    'sql': "import { sql, eq, and, gte, lte, desc, asc, inArray, isNull, isNotNull } from 'drizzle-orm';",
    'createModuleLogger': "import { createModuleLogger } from '../utils/logger';",
    'getRedisClient': "import { getRedisClient } from '../utils/redisClient';",
    'AmazonSyncService': "import { AmazonSyncService } from './amazonSyncService';",
    'AmazonAdsApiClient': "import type { AmazonAdsApiClient } from './amazonAdsApi';",
    'getMarketplaceDateRange': "import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday } from '../utils/timezone';",
    'getExchangeRateByMarketplace': "import { getExchangeRateByMarketplace } from '../services/exchangeRateService';",
}

def read_file(path):
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def extract_exports(content):
    """Extract exported names from __export() block"""
    exports = []
    pattern = r'__export\(\w+,\s*\{([^}]+)\}\)'
    match = re.search(pattern, content, re.DOTALL)
    if match:
        block = match.group(1)
        for line in block.split('\n'):
            # Pattern: name: () => actualName
            m = re.match(r'\s*(\w+)\s*:\s*\(\)\s*=>\s*(\w+)', line)
            if m:
                exports.append((m.group(1), m.group(2)))
    return exports

def clean_esbuild_artifacts(content):
    """Remove esbuild wrapper code"""
    lines = content.split('\n')
    cleaned = []
    skip_patterns = [
        r'^var \w+_exports\s*=\s*\{\};',
        r'^__export\(',
        r'^\s*\w+:\s*\(\)\s*=>\s*\w+',
        r'^\}\);$',
        r'^var init_\w+\s*=\s*__esm\(\{',
        r'^\s*"[^"]+"\(\)\s*\{',  # ESM init function
    ]
    
    in_export_block = False
    in_esm_init = False
    brace_depth = 0
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Skip __export block
        if '__export(' in line:
            in_export_block = True
            i += 1
            continue
        if in_export_block:
            if '});' in line:
                in_export_block = False
            i += 1
            continue
        
        # Skip var xxx_exports = {};
        if re.match(r'^var \w+_exports\s*=\s*\{\};', line):
            i += 1
            continue
        
        # Skip __name() wrappers - just remove __name() calls
        line = re.sub(r',\s*__name\(\w+,\s*"[^"]+"\)', '', line)
        line = re.sub(r'__name\(\w+,\s*"[^"]+"\);?', '', line)
        
        # Skip init_xxx = __esm blocks
        if re.match(r'^var init_\w+\s*=\s*__esm\(\{', line):
            in_esm_init = True
            brace_depth = 1
            i += 1
            continue
        
        if in_esm_init:
            brace_depth += line.count('{') - line.count('}')
            if brace_depth <= 0:
                in_esm_init = False
            i += 1
            continue
        
        cleaned.append(line)
        i += 1
    
    return '\n'.join(cleaned)

def infer_imports(content, module_path):
    """Infer import statements from code usage"""
    imports = set()
    
    # Check for common patterns
    if 'getDb()' in content or 'getDb(' in content:
        imports.add("import { getDb } from '../db';")
    
    # Drizzle ORM operators
    drizzle_ops = []
    for op in ['sql', 'eq', 'and', 'gte', 'lte', 'desc', 'asc', 'inArray', 'isNull', 'isNotNull', 'or', 'not', 'between', 'like']:
        # Check for usage as function call or template tag
        if re.search(rf'\b{op}\b\s*[\(`]', content) or re.search(rf'\b{op}\b\s*,', content):
            drizzle_ops.append(op)
    if drizzle_ops:
        imports.add(f"import {{ {', '.join(drizzle_ops)} }} from 'drizzle-orm';")
    
    # Schema tables
    schema_tables = []
    # Common table names from drizzle schema
    known_tables = [
        'campaigns', 'adGroups', 'keywords', 'productTargets', 'dailyPerformance',
        'hourlyPerformance', 'searchTerms', 'negativeKeywords', 'optimizationEvents',
        'campaignBudgetRules', 'placementPerformance', 'biddingLogs', 'adAccounts',
        'amazonApiCredentials', 'syncJobs', 'syncSteps', 'users', 'portfolios',
        'reportJobs', 'pendingEvents', 'syncCheckpoints', 'ads'
    ]
    for table in known_tables:
        if re.search(rf'\b{table}\b', content):
            schema_tables.append(table)
    if schema_tables:
        imports.add(f"import {{ {', '.join(schema_tables)} }} from '../../drizzle/schema';")
    
    # Logger
    if 'createModuleLogger' in content:
        imports.add("import { createModuleLogger } from '../utils/logger';")
    
    # Redis
    if 'getRedisClient' in content:
        imports.add("import { getRedisClient } from '../utils/redisClient';")
    
    # Timezone utilities
    tz_funcs = []
    for func in ['getMarketplaceDateRange', 'getMarketplaceCurrentDate', 'getMarketplaceYesterday', 'getMarketplaceHistoricalDateRange']:
        if func in content:
            tz_funcs.append(func)
    if tz_funcs:
        imports.add(f"import {{ {', '.join(tz_funcs)} }} from '../utils/timezone';")
    
    # Exchange rate
    if 'getExchangeRateByMarketplace' in content:
        imports.add("import { getExchangeRateByMarketplace } from '../services/exchangeRateService';")
    
    # AmazonSyncService
    if 'AmazonSyncService' in content:
        imports.add("import { AmazonSyncService } from './amazonSyncService';")
    
    # AmazonAdsApiClient
    if 'AmazonAdsApiClient' in content:
        imports.add("import type { AmazonAdsApiClient } from './amazonAdsApi';")
    
    return sorted(imports)

def convert_var_to_const_let(content):
    """Convert var declarations to const/let"""
    # var x = ... (not reassigned) -> const x = ...
    # Simple heuristic: if var is at function scope level, keep as is for safety
    # Only convert top-level vars
    lines = content.split('\n')
    result = []
    for line in lines:
        # Convert var to const for simple assignments
        if re.match(r'^var\s+\w+\s*=\s*', line):
            line = re.sub(r'^var\s+', 'const ', line)
        result.append(line)
    return '\n'.join(result)

def add_export_keywords(content, exports):
    """Add export keyword to exported functions/classes/consts"""
    export_names = set(name for _, name in exports)
    
    lines = content.split('\n')
    result = []
    for line in lines:
        # Check if this line defines an exported name
        for name in export_names:
            # function name(
            if re.match(rf'^(async\s+)?function\s+{re.escape(name)}\s*\(', line):
                if not line.startswith('export'):
                    line = 'export ' + line
                break
            # class name
            if re.match(rf'^class\s+{re.escape(name)}\b', line):
                if not line.startswith('export'):
                    line = 'export ' + line
                break
            # const name =
            if re.match(rf'^const\s+{re.escape(name)}\s*=', line):
                if not line.startswith('export'):
                    line = 'export ' + line
                break
        result.append(line)
    return '\n'.join(result)

def add_basic_type_annotations(content):
    """Add basic TypeScript type annotations where obvious"""
    # This is conservative - only adds types where we're confident
    # The rest will use TypeScript's type inference or 'any'
    
    # Add : any to untyped function parameters that are clearly objects
    # For now, just ensure the code is valid TypeScript by not adding wrong types
    return content

def convert_module(module_path, force=False):
    """Convert a single module from extracted JS to TypeScript"""
    extracted_path = os.path.join(EXTRACTED_DIR, module_path.replace('.ts', '.extracted.js'))
    repo_path = os.path.join(REPO_DIR, module_path)
    
    if not os.path.exists(extracted_path):
        return 'skip', 'no extracted JS'
    
    # Read extracted JS
    content = read_file(extracted_path)
    
    # Remove our extraction header
    lines = content.split('\n')
    while lines and (lines[0].startswith('// Extracted from') or lines[0].startswith('// Original module') or lines[0].startswith('// Lines:') or lines[0] == ''):
        lines.pop(0)
    content = '\n'.join(lines)
    
    # If repo TS exists and is not being forced, check if we should update
    if os.path.exists(repo_path) and not force:
        return 'skip', 'repo TS exists (use force=True to overwrite)'
    
    # Extract export list
    exports = extract_exports(content)
    
    # Clean esbuild artifacts
    content = clean_esbuild_artifacts(content)
    
    # Convert var to const/let
    content = convert_var_to_const_let(content)
    
    # Add export keywords
    content = add_export_keywords(content, exports)
    
    # Infer imports
    imports = infer_imports(content, module_path)
    
    # Build the TypeScript file
    ts_content = f"""/**
 * {module_path}
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */

{chr(10).join(imports)}

{content.strip()}
"""
    
    # Write to repo
    output_path = os.path.join(OUTPUT_DIR, module_path)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(ts_content)
    
    return 'done', f'{len(imports)} imports, {len(exports)} exports'

def main():
    import sys
    
    # Load analysis
    with open('/home/ubuntu/amazon-ads-optimizer/scripts/module_analysis/comprehensive_diff.json') as f:
        analysis = json.load(f)
    
    mode = sys.argv[1] if len(sys.argv) > 1 else 'new'
    
    if mode == 'new':
        # Only convert NEW modules (don't exist in repo)
        modules = [a for a in analysis if a['status'] == 'new_module']
        print(f"Converting {len(modules)} NEW modules...")
        
        success = 0
        for m in modules:
            status, msg = convert_module(m['module'], force=True)
            print(f"  [{status}] {m['module']}: {msg}")
            if status == 'done':
                success += 1
        
        print(f"\nCompleted: {success}/{len(modules)}")
    
    elif mode == 'changed':
        # Convert changed modules (overwrite repo TS with production logic)
        modules = [a for a in analysis 
                   if a['status'] in ('major_update', 'moderate_update', 'minor_update')
                   and a.get('prod_lines', 0) > 0
                   and a.get('repo_lines', 0) > 0
                   # Filter esbuild artifacts
                   and a.get('prod_lines', 0) <= 5 * a.get('repo_lines', 1)]
        
        print(f"Converting {len(modules)} CHANGED modules...")
        success = 0
        for m in modules:
            status, msg = convert_module(m['module'], force=True)
            print(f"  [{status}] {m['module']}: {msg}")
            if status == 'done':
                success += 1
        
        print(f"\nCompleted: {success}/{len(modules)}")
    
    elif mode == 'esbuild_host':
        # For modules where prod >> repo due to esbuild inlining,
        # we keep the repo TS and just update the actual source code part
        # These are: cookies.ts, patchSqlstring.ts, context.ts, oauth.ts, 
        # amazonAuthCallback.ts, notification.ts
        esbuild_hosts = [
            'server/_core/cookies.ts',
            'server/utils/patchSqlstring.ts', 
            'server/_core/context.ts',
            'server/_core/oauth.ts',
            'server/_core/amazonAuthCallback.ts',
            'server/routes/notification.ts',
        ]
        print(f"Processing {len(esbuild_hosts)} esbuild host modules...")
        print("These modules have esbuild-inlined dependencies.")
        print("We'll extract only the actual source code portion and update the repo TS.")
        
        for module_path in esbuild_hosts:
            extracted_path = os.path.join(EXTRACTED_DIR, module_path.replace('.ts', '.extracted.js'))
            if not os.path.exists(extracted_path):
                print(f"  SKIP {module_path}: no extracted JS")
                continue
            
            content = read_file(extracted_path)
            # Remove header
            lines = content.split('\n')
            while lines and (lines[0].startswith('// Extracted') or lines[0].startswith('// Original') or lines[0].startswith('// Lines') or lines[0] == ''):
                lines.pop(0)
            
            # For these modules, the actual source code is at the beginning,
            # before the inlined dependencies start
            # Heuristic: look for the first function/class that matches the module name
            source_lines = []
            found_init = False
            for line in lines:
                # The init_xxx = __esm block marks the start of the actual module code
                if re.match(r'^var init_\w+\s*=\s*__esm', line):
                    found_init = True
                    continue
                if found_init:
                    source_lines.append(line)
                elif not found_init:
                    # Before __esm, this is the actual source code
                    source_lines.append(line)
            
            actual_lines = len(source_lines)
            print(f"  {module_path}: {actual_lines} actual source lines (from {len(lines)} total)")
    
    elif mode == 'all':
        # Convert all modules
        new_modules = [a for a in analysis if a['status'] == 'new_module']
        changed_modules = [a for a in analysis 
                          if a['status'] in ('major_update', 'moderate_update', 'minor_update')
                          and a.get('prod_lines', 0) > 0
                          and a.get('repo_lines', 0) > 0
                          and a.get('prod_lines', 0) <= 5 * a.get('repo_lines', 1)]
        
        all_modules = new_modules + changed_modules
        print(f"Converting ALL {len(all_modules)} modules...")
        success = 0
        for m in all_modules:
            status, msg = convert_module(m['module'], force=True)
            if status == 'done':
                success += 1
                if success % 20 == 0:
                    print(f"  Progress: {success} done...")
        
        print(f"\nCompleted: {success}/{len(all_modules)}")

if __name__ == '__main__':
    main()
