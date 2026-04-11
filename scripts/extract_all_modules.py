#!/usr/bin/env python3
"""
从生产环境的 dist/index.js 中提取所有 server/ 模块的代码，
保存为独立的 .js 文件，供后续 LLM 转换为 TypeScript。
"""

import os
import re

PROD_INDEX = "/home/ubuntu/p2_work/p5_work/app_src/dist/index.js"
OUTPUT_DIR = "/home/ubuntu/amazon-ads-optimizer/scripts/extracted_modules"

os.makedirs(OUTPUT_DIR, exist_ok=True)

def extract_all_modules():
    """提取所有 server/ 和 drizzle/ 模块"""
    modules = {}
    current_module = None
    current_lines = []
    
    with open(PROD_INDEX, 'r', encoding='utf-8') as f:
        for line in f:
            if line.startswith('// server/') or line.startswith('// drizzle/'):
                if current_module:
                    modules[current_module] = current_lines
                current_module = line.strip().replace('// ', '')
                current_lines = []
            elif current_module:
                current_lines.append(line)
    
    if current_module:
        modules[current_module] = current_lines
    
    return modules

def save_modules(modules):
    """保存每个模块为独立文件"""
    for module_path, lines in modules.items():
        # Create directory structure
        safe_path = module_path.replace('.ts', '.extracted.js')
        full_path = os.path.join(OUTPUT_DIR, safe_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(f"// Extracted from production dist/index.js\n")
            f.write(f"// Original module: {module_path}\n")
            f.write(f"// Lines: {len(lines)}\n\n")
            f.writelines(lines)
    
    return len(modules)

def main():
    print("Extracting all modules from production bundle...")
    modules = extract_all_modules()
    count = save_modules(modules)
    print(f"Extracted {count} modules to {OUTPUT_DIR}/")
    
    # Print summary
    total_lines = sum(len(lines) for lines in modules.values())
    print(f"Total lines: {total_lines}")
    
    # List by size
    by_size = sorted(modules.items(), key=lambda x: -len(x[1]))
    print("\nTop 20 largest modules:")
    for path, lines in by_size[:20]:
        print(f"  {len(lines):6d} lines  {path}")

if __name__ == '__main__':
    main()
