#!/usr/bin/env python3
"""
从生产环境的 dist/index.js 中提取各模块的代码段，
与 GitHub 仓库中的 TypeScript 源码进行对比分析。

生产环境的 dist/index.js 是 esbuild 打包产物（未minify，但变量名保留），
每个模块以 "// server/path/file.ts" 注释标记开始。
"""

import re
import os
import json

PROD_INDEX = "/home/ubuntu/p2_work/p5_work/app_src/dist/index.js"
REPO_DIR = "/home/ubuntu/amazon-ads-optimizer"
OUTPUT_DIR = "/home/ubuntu/amazon-ads-optimizer/scripts/module_analysis"

os.makedirs(OUTPUT_DIR, exist_ok=True)

def extract_modules_from_prod():
    """从 dist/index.js 中按 // server/ 注释提取模块边界"""
    modules = {}
    current_module = None
    current_lines = []
    line_start = 0
    
    with open(PROD_INDEX, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f, 1):
            if line.startswith('// server/') or line.startswith('// drizzle/'):
                # Save previous module
                if current_module:
                    modules[current_module] = {
                        'start': line_start,
                        'end': i - 1,
                        'lines': len(current_lines),
                        'content': current_lines
                    }
                current_module = line.strip().replace('// ', '')
                current_lines = [line]
                line_start = i
            elif current_module:
                current_lines.append(line)
    
    # Save last module
    if current_module:
        modules[current_module] = {
            'start': line_start,
            'end': line_start + len(current_lines) - 1,
            'lines': len(current_lines),
            'content': current_lines
        }
    
    return modules

def get_repo_module_size(module_path):
    """获取仓库中对应模块的行数"""
    full_path = os.path.join(REPO_DIR, module_path)
    if os.path.exists(full_path):
        with open(full_path, 'r', encoding='utf-8') as f:
            return len(f.readlines())
    return 0

def analyze_key_functions(content_lines, module_name):
    """分析模块中的关键函数和类"""
    content = ''.join(content_lines)
    
    # Find function definitions
    functions = re.findall(r'(?:async\s+)?function\s+(\w+)', content)
    # Find class definitions
    classes = re.findall(r'class\s+(\w+)', content)
    # Find const/let exports
    exports = re.findall(r'(?:const|let|var)\s+(\w+)\s*=', content)
    
    return {
        'functions': list(set(functions))[:20],
        'classes': list(set(classes))[:10],
        'key_exports': [e for e in set(exports) if len(e) > 3][:20]
    }

def main():
    print("Extracting modules from production dist/index.js...")
    prod_modules = extract_modules_from_prod()
    print(f"Found {len(prod_modules)} modules in production bundle")
    
    # Categorize modules
    server_modules = {k: v for k, v in prod_modules.items() if k.startswith('server/')}
    drizzle_modules = {k: v for k, v in prod_modules.items() if k.startswith('drizzle/')}
    
    # Analyze each module
    analysis = []
    for module_path, info in sorted(server_modules.items()):
        repo_lines = get_repo_module_size(module_path)
        repo_exists = os.path.exists(os.path.join(REPO_DIR, module_path))
        
        key_items = analyze_key_functions(info['content'], module_path)
        
        size_ratio = info['lines'] / repo_lines if repo_lines > 0 else float('inf')
        
        analysis.append({
            'module': module_path,
            'prod_lines': info['lines'],
            'prod_start': info['start'],
            'prod_end': info['end'],
            'repo_lines': repo_lines,
            'repo_exists': repo_exists,
            'size_ratio': round(size_ratio, 2),
            'functions': key_items['functions'],
            'classes': key_items['classes'],
            'status': 'new' if not repo_exists else ('major_change' if size_ratio > 2.0 or size_ratio < 0.5 else 'minor_change' if size_ratio != 1.0 else 'unchanged')
        })
    
    # Sort by importance: new modules first, then major changes
    analysis.sort(key=lambda x: (
        0 if x['status'] == 'new' else 1 if x['status'] == 'major_change' else 2,
        -x['prod_lines']
    ))
    
    # Write detailed analysis
    with open(os.path.join(OUTPUT_DIR, 'module_analysis.json'), 'w') as f:
        json.dump(analysis, f, indent=2)
    
    # Write summary report
    new_modules = [a for a in analysis if a['status'] == 'new']
    major_changes = [a for a in analysis if a['status'] == 'major_change']
    minor_changes = [a for a in analysis if a['status'] == 'minor_change']
    
    with open(os.path.join(OUTPUT_DIR, 'summary.md'), 'w') as f:
        f.write("# 模块对比分析摘要\n\n")
        f.write(f"总模块数: {len(analysis)}\n\n")
        
        f.write(f"## 新增模块 ({len(new_modules)} 个) — 需要创建 TypeScript 源码\n\n")
        f.write("| 模块路径 | 生产行数 | 关键函数/类 |\n")
        f.write("|---------|---------|----------|\n")
        for m in new_modules:
            funcs = ', '.join(m['functions'][:5])
            classes = ', '.join(m['classes'][:3])
            key = f"类: {classes}" if classes else f"函数: {funcs}"
            f.write(f"| `{m['module']}` | {m['prod_lines']} | {key} |\n")
        
        f.write(f"\n## 重大变更模块 ({len(major_changes)} 个) — 需要大幅更新源码\n\n")
        f.write("| 模块路径 | 生产行数 | 仓库行数 | 变化倍数 |\n")
        f.write("|---------|---------|---------|--------|\n")
        for m in major_changes:
            f.write(f"| `{m['module']}` | {m['prod_lines']} | {m['repo_lines']} | {m['size_ratio']}x |\n")
        
        f.write(f"\n## 小幅变更模块 ({len(minor_changes)} 个)\n\n")
        f.write(f"这些模块变化较小，需要逐一对比确认。\n\n")
        
        # Top 20 largest modules
        f.write("## 最大的 20 个模块（按生产行数排序）\n\n")
        f.write("| 模块路径 | 生产行数 | 状态 |\n")
        f.write("|---------|---------|-----|\n")
        for m in sorted(analysis, key=lambda x: -x['prod_lines'])[:20]:
            f.write(f"| `{m['module']}` | {m['prod_lines']} | {m['status']} |\n")
    
    # Extract new modules' code to individual files for analysis
    new_modules_dir = os.path.join(OUTPUT_DIR, 'new_modules')
    os.makedirs(new_modules_dir, exist_ok=True)
    for m in new_modules:
        safe_name = m['module'].replace('/', '_').replace('.ts', '.js')
        with open(os.path.join(new_modules_dir, safe_name), 'w') as f:
            content = prod_modules[m['module']]['content']
            f.writelines(content)
    
    print(f"\nAnalysis complete!")
    print(f"  New modules: {len(new_modules)}")
    print(f"  Major changes: {len(major_changes)}")
    print(f"  Minor changes: {len(minor_changes)}")
    print(f"\nResults saved to {OUTPUT_DIR}/")

if __name__ == '__main__':
    main()
