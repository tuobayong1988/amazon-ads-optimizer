#!/usr/bin/env python3
"""
全面对比生产bundle和仓库源码的每个模块，
生成精确的差异报告，指导后续的源码升级工作。

策略：
1. 对于每个模块，提取生产版本中的函数签名列表
2. 与仓库TypeScript源码中的函数签名对比
3. 识别：新增函数、删除函数、修改函数
4. 生成优先级排序的升级任务清单
"""

import os
import re
import json

EXTRACTED_DIR = "/home/ubuntu/amazon-ads-optimizer/scripts/extracted_modules"
REPO_DIR = "/home/ubuntu/amazon-ads-optimizer"
OUTPUT_DIR = "/home/ubuntu/amazon-ads-optimizer/scripts/module_analysis"

def extract_functions(content, is_ts=False):
    """提取代码中的函数名和类名"""
    funcs = set()
    classes = set()
    
    # Function declarations
    for m in re.finditer(r'(?:export\s+)?(?:async\s+)?function\s+(\w+)', content):
        funcs.add(m.group(1))
    
    # Class declarations
    for m in re.finditer(r'(?:export\s+)?class\s+(\w+)', content):
        classes.add(m.group(1))
    
    # Method definitions in classes (prototype extensions)
    for m in re.finditer(r'\.prototype\.(\w+)\s*=', content):
        funcs.add(m.group(1))
    
    # Arrow function assignments
    for m in re.finditer(r'(?:const|let|var|export\s+const)\s+(\w+)\s*=\s*(?:async\s+)?\(', content):
        funcs.add(m.group(1))
    
    # Named exports
    for m in re.finditer(r'export\s+\{\s*([^}]+)\s*\}', content):
        for name in m.group(1).split(','):
            name = name.strip().split(' as ')[0].strip()
            if name:
                funcs.add(name)
    
    return funcs, classes

def extract_constants_and_configs(content):
    """提取常量和配置对象"""
    consts = set()
    for m in re.finditer(r'(?:const|var)\s+(\w+(?:_CONFIG|_DEFAULTS|_OPTIONS|_SETTINGS|_LIMITS|SCHEDULER_CONFIG|VERSION))\s*=', content):
        consts.add(m.group(1))
    return consts

def extract_version_markers(content):
    """提取版本标记注释"""
    versions = set()
    for m in re.finditer(r'v(\d{3,})', content):
        v = int(m.group(1))
        if 400 <= v <= 700:
            versions.add(v)
    return versions

def analyze_module(module_path):
    """分析单个模块的差异"""
    extracted_path = os.path.join(EXTRACTED_DIR, module_path.replace('.ts', '.extracted.js'))
    repo_path = os.path.join(REPO_DIR, module_path)
    
    result = {
        'module': module_path,
        'prod_exists': os.path.exists(extracted_path),
        'repo_exists': os.path.exists(repo_path),
    }
    
    if not result['prod_exists']:
        result['status'] = 'repo_only'
        return result
    
    with open(extracted_path, 'r', encoding='utf-8') as f:
        prod_content = f.read()
    
    prod_funcs, prod_classes = extract_functions(prod_content)
    prod_consts = extract_constants_and_configs(prod_content)
    prod_versions = extract_version_markers(prod_content)
    prod_lines = len(prod_content.splitlines())
    
    result['prod_lines'] = prod_lines
    result['prod_functions'] = sorted(prod_funcs)
    result['prod_classes'] = sorted(prod_classes)
    result['prod_versions'] = sorted(prod_versions)
    
    if not result['repo_exists']:
        result['status'] = 'new_module'
        result['repo_lines'] = 0
        result['new_functions'] = sorted(prod_funcs)
        result['new_classes'] = sorted(prod_classes)
        return result
    
    with open(repo_path, 'r', encoding='utf-8') as f:
        repo_content = f.read()
    
    repo_funcs, repo_classes = extract_functions(repo_content, is_ts=True)
    repo_consts = extract_constants_and_configs(repo_content)
    repo_versions = extract_version_markers(repo_content)
    repo_lines = len(repo_content.splitlines())
    
    result['repo_lines'] = repo_lines
    result['repo_functions'] = sorted(repo_funcs)
    result['repo_classes'] = sorted(repo_classes)
    result['repo_versions'] = sorted(repo_versions)
    
    # Compute diffs
    new_funcs = prod_funcs - repo_funcs
    removed_funcs = repo_funcs - prod_funcs
    new_classes = prod_classes - repo_classes
    new_versions = prod_versions - repo_versions
    new_consts = prod_consts - repo_consts
    
    result['new_functions'] = sorted(new_funcs)
    result['removed_functions'] = sorted(removed_funcs)
    result['new_classes'] = sorted(new_classes)
    result['new_versions'] = sorted(new_versions)
    result['new_constants'] = sorted(new_consts)
    
    # Determine change level
    total_changes = len(new_funcs) + len(removed_funcs) + len(new_classes)
    max_version_in_prod = max(prod_versions) if prod_versions else 0
    max_version_in_repo = max(repo_versions) if repo_versions else 0
    
    if total_changes == 0 and max_version_in_prod <= max_version_in_repo:
        result['status'] = 'likely_unchanged'
    elif total_changes <= 3:
        result['status'] = 'minor_update'
    elif total_changes <= 10:
        result['status'] = 'moderate_update'
    else:
        result['status'] = 'major_update'
    
    return result

def main():
    # Collect all module paths from both sources
    all_modules = set()
    
    # From extracted modules
    for root, dirs, files in os.walk(EXTRACTED_DIR):
        for f in files:
            if f.endswith('.extracted.js'):
                rel = os.path.relpath(os.path.join(root, f), EXTRACTED_DIR)
                module_path = rel.replace('.extracted.js', '.ts')
                if module_path.startswith('server/'):
                    all_modules.add(module_path)
    
    # From repo
    for root, dirs, files in os.walk(os.path.join(REPO_DIR, 'server')):
        for f in files:
            if f.endswith('.ts') and '__tests__' not in root and '_archived' not in root:
                rel = os.path.relpath(os.path.join(root, f), REPO_DIR)
                all_modules.add(rel)
    
    print(f"Analyzing {len(all_modules)} total modules...")
    
    results = []
    for module_path in sorted(all_modules):
        result = analyze_module(module_path)
        results.append(result)
    
    # Categorize
    new_modules = [r for r in results if r['status'] == 'new_module']
    major_updates = [r for r in results if r['status'] == 'major_update']
    moderate_updates = [r for r in results if r['status'] == 'moderate_update']
    minor_updates = [r for r in results if r['status'] == 'minor_update']
    unchanged = [r for r in results if r['status'] == 'likely_unchanged']
    repo_only = [r for r in results if r['status'] == 'repo_only']
    
    print(f"\nResults:")
    print(f"  New modules (need creation): {len(new_modules)}")
    print(f"  Major updates (>10 changes): {len(major_updates)}")
    print(f"  Moderate updates (3-10): {len(moderate_updates)}")
    print(f"  Minor updates (1-3): {len(minor_updates)}")
    print(f"  Likely unchanged: {len(unchanged)}")
    print(f"  Repo-only (not in prod): {len(repo_only)}")
    
    # Save full results
    with open(os.path.join(OUTPUT_DIR, 'comprehensive_diff.json'), 'w') as f:
        json.dump(results, f, indent=2)
    
    # Generate actionable task list
    with open(os.path.join(OUTPUT_DIR, 'upgrade_tasks.md'), 'w') as f:
        f.write("# 源码升级任务清单\n\n")
        f.write(f"总模块数: {len(all_modules)}\n\n")
        
        f.write(f"## 1. 新增模块 ({len(new_modules)}) — 需要创建 TypeScript 源码\n\n")
        for r in sorted(new_modules, key=lambda x: -x.get('prod_lines', 0)):
            f.write(f"### `{r['module']}` ({r.get('prod_lines', 0)} 行)\n")
            if r.get('new_functions'):
                f.write(f"- 函数: {', '.join(r['new_functions'][:10])}\n")
            if r.get('new_classes'):
                f.write(f"- 类: {', '.join(r['new_classes'])}\n")
            f.write("\n")
        
        f.write(f"## 2. 重大更新 ({len(major_updates)}) — 需要大幅修改\n\n")
        for r in sorted(major_updates, key=lambda x: -len(x.get('new_functions', []))):
            f.write(f"### `{r['module']}`\n")
            f.write(f"- 生产: {r.get('prod_lines', 0)} 行, 仓库: {r.get('repo_lines', 0)} 行\n")
            if r.get('new_functions'):
                f.write(f"- 新增函数: {', '.join(r['new_functions'][:10])}\n")
            if r.get('new_versions'):
                f.write(f"- 新版本标记: {', '.join(str(v) for v in r['new_versions'][:5])}\n")
            f.write("\n")
        
        f.write(f"## 3. 中等更新 ({len(moderate_updates)})\n\n")
        for r in moderate_updates:
            new_f = r.get('new_functions', [])
            f.write(f"- `{r['module']}`: +{len(new_f)} 函数 ({', '.join(new_f[:5])})\n")
        
        f.write(f"\n## 4. 小幅更新 ({len(minor_updates)})\n\n")
        for r in minor_updates:
            new_f = r.get('new_functions', [])
            f.write(f"- `{r['module']}`: +{len(new_f)} 函数\n")
        
        f.write(f"\n## 5. 无变更 ({len(unchanged)})\n\n")
        f.write("这些模块可以直接保留仓库中的 TypeScript 源码。\n\n")
        for r in unchanged:
            f.write(f"- `{r['module']}`\n")
        
        f.write(f"\n## 6. 仅在仓库中 ({len(repo_only)})\n\n")
        f.write("这些模块在生产 bundle 中不存在，可能已被移除或未被引用。\n\n")
        for r in repo_only:
            f.write(f"- `{r['module']}`\n")
    
    print(f"\nTask list saved to {OUTPUT_DIR}/upgrade_tasks.md")

if __name__ == '__main__':
    main()
