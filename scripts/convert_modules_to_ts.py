#!/usr/bin/env python3
"""
使用 OpenAI API 将从生产 bundle 提取的 JS 模块转换为 TypeScript 源码。

策略：
1. 对于新增模块：直接从提取的 JS 转换为 TS
2. 对于变更模块：以仓库 TS 为基础，用生产 JS 的逻辑更新
3. 保留所有原始注释、版本标记和业务逻辑
"""

import os
import sys
import json
import time
from openai import OpenAI

client = OpenAI()  # Uses pre-configured API key and base URL

EXTRACTED_DIR = "/home/ubuntu/amazon-ads-optimizer/scripts/extracted_modules"
REPO_DIR = "/home/ubuntu/amazon-ads-optimizer"
OUTPUT_DIR = "/home/ubuntu/amazon-ads-optimizer/scripts/converted_modules"

os.makedirs(OUTPUT_DIR, exist_ok=True)

# Track progress
PROGRESS_FILE = os.path.join(OUTPUT_DIR, "progress.json")

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {}

def save_progress(progress):
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(progress, f, indent=2)

def read_file(path):
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def convert_new_module(module_path, extracted_js):
    """Convert a new module (no repo TS exists) from JS to TypeScript"""
    prompt = f"""Convert this JavaScript code (extracted from an esbuild bundle) back to clean TypeScript source code.

Module path: {module_path}

Requirements:
1. Add proper TypeScript type annotations for all function parameters and return types
2. Add proper import statements (infer from usage patterns like `getDb()`, `sql`, `eq`, `log`, etc.)
3. Remove esbuild artifacts like `__name()` wrappers, `var xxx_exports`, `__export()` blocks
4. Convert `var` to `const`/`let` as appropriate
5. Add `export` to functions/classes that were in the `__export()` block
6. Preserve ALL business logic, comments (including Chinese comments), and version markers (v534, v550, etc.)
7. Use proper TypeScript patterns (interfaces, type aliases, generics where appropriate)
8. Infer types from context (e.g., if a parameter is used with `.accountId`, it's likely an Account type)

Common imports in this codebase:
- `import {{ getDb }} from '../db';` for database access
- `import {{ sql, eq, and, gte, lte, desc, inArray }} from 'drizzle-orm';` for query building
- `import {{ createModuleLogger }} from '../utils/logger';` for logging
- `import * as schema from '../../drizzle/schema';` or individual table imports
- `import {{ getRedisClient }} from '../utils/redisClient';` for Redis

Here is the extracted JavaScript code:

```javascript
{extracted_js}
```

Return ONLY the TypeScript source code, no markdown fences or explanations."""

    return prompt

def convert_changed_module(module_path, extracted_js, repo_ts):
    """Convert a changed module by merging production JS logic into repo TS structure"""
    # Truncate if too long
    max_chars = 15000
    if len(extracted_js) > max_chars:
        extracted_js = extracted_js[:max_chars] + "\n// ... (truncated)"
    if len(repo_ts) > max_chars:
        repo_ts = repo_ts[:max_chars] + "\n// ... (truncated)"
    
    prompt = f"""Update this TypeScript source file to match the production JavaScript version.

Module path: {module_path}

The REPO TypeScript (current source, may be outdated):
```typescript
{repo_ts}
```

The PRODUCTION JavaScript (extracted from esbuild bundle, this is the truth):
```javascript
{extracted_js}
```

Requirements:
1. Start from the REPO TypeScript structure (imports, types, exports)
2. Update ALL function bodies to match the PRODUCTION JavaScript logic
3. Add any NEW functions/classes that exist in production but not in repo
4. Remove any functions that were removed in production
5. Preserve TypeScript type annotations from repo, add new ones for new code
6. Keep all version markers, comments (including Chinese), and business logic from production
7. Remove esbuild artifacts (__name wrappers, etc.)
8. If the production code has new imports, add them with proper TypeScript types

Return ONLY the complete updated TypeScript source code, no markdown fences or explanations."""

    return prompt

def call_llm(prompt, module_path):
    """Call OpenAI API to convert code"""
    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": "You are an expert TypeScript developer. Convert JavaScript code to TypeScript with proper type annotations. Output ONLY code, no explanations."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=16000,
            temperature=0.1
        )
        result = response.choices[0].message.content
        # Strip markdown fences if present
        if result.startswith("```"):
            lines = result.split('\n')
            # Remove first and last fence lines
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            result = '\n'.join(lines)
        return result
    except Exception as e:
        print(f"  ERROR calling LLM for {module_path}: {e}")
        return None

def process_module(module_path, progress):
    """Process a single module"""
    if module_path in progress and progress[module_path] == 'done':
        return True
    
    extracted_path = os.path.join(EXTRACTED_DIR, module_path.replace('.ts', '.extracted.js'))
    repo_path = os.path.join(REPO_DIR, module_path)
    output_path = os.path.join(OUTPUT_DIR, module_path)
    
    extracted_js = read_file(extracted_path)
    if not extracted_js:
        print(f"  SKIP {module_path}: no extracted JS")
        return False
    
    # Remove the header comments we added during extraction
    lines = extracted_js.split('\n')
    while lines and (lines[0].startswith('// Extracted from') or lines[0].startswith('// Original module') or lines[0].startswith('// Lines:') or lines[0] == ''):
        lines.pop(0)
    extracted_js = '\n'.join(lines)
    
    repo_ts = read_file(repo_path)
    
    if repo_ts:
        prompt = convert_changed_module(module_path, extracted_js, repo_ts)
        mode = "UPDATE"
    else:
        prompt = convert_new_module(module_path, extracted_js)
        mode = "NEW"
    
    print(f"  [{mode}] Converting {module_path}...")
    result = call_llm(prompt, module_path)
    
    if result:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(result)
        progress[module_path] = 'done'
        save_progress(progress)
        return True
    else:
        progress[module_path] = 'failed'
        save_progress(progress)
        return False

def main():
    # Load analysis results
    with open('/home/ubuntu/amazon-ads-optimizer/scripts/module_analysis/comprehensive_diff.json') as f:
        analysis = json.load(f)
    
    progress = load_progress()
    
    # Categorize modules
    new_modules = [a for a in analysis if a['status'] == 'new_module']
    changed_modules = [a for a in analysis 
                       if a['status'] in ('major_update', 'moderate_update', 'minor_update')
                       and a.get('prod_lines', 0) > 0
                       and a.get('repo_lines', 0) > 0
                       # Filter out esbuild artifacts (prod >> 5x repo)
                       and (a.get('prod_lines', 0) <= 5 * a.get('repo_lines', 1) or a.get('repo_lines', 0) == 0)]
    
    # Process mode from command line
    mode = sys.argv[1] if len(sys.argv) > 1 else 'new'
    
    if mode == 'new':
        # Process new modules first
        print(f"Processing {len(new_modules)} NEW modules...")
        success = 0
        for i, m in enumerate(new_modules):
            print(f"\n[{i+1}/{len(new_modules)}]")
            if process_module(m['module'], progress):
                success += 1
            time.sleep(0.5)  # Rate limiting
        print(f"\nCompleted: {success}/{len(new_modules)} new modules")
    
    elif mode == 'changed':
        # Process changed modules
        # Sort by importance: sync > optimization > services > others
        priority_order = ['sync/', 'optimization/', 'services/', 'automation/', 'routes/', 'algorithm/', 'analytics/', 'budget/']
        
        def priority_key(m):
            path = m['module']
            for i, prefix in enumerate(priority_order):
                if prefix in path:
                    return (i, -m.get('prod_lines', 0))
            return (len(priority_order), -m.get('prod_lines', 0))
        
        changed_modules.sort(key=priority_key)
        
        print(f"Processing {len(changed_modules)} CHANGED modules...")
        success = 0
        for i, m in enumerate(changed_modules):
            print(f"\n[{i+1}/{len(changed_modules)}]")
            if process_module(m['module'], progress):
                success += 1
            time.sleep(0.5)
        print(f"\nCompleted: {success}/{len(changed_modules)} changed modules")
    
    elif mode == 'all':
        # Process everything
        all_modules = new_modules + changed_modules
        print(f"Processing ALL {len(all_modules)} modules...")
        success = 0
        for i, m in enumerate(all_modules):
            print(f"\n[{i+1}/{len(all_modules)}]")
            if process_module(m['module'], progress):
                success += 1
            time.sleep(0.3)
        print(f"\nCompleted: {success}/{len(all_modules)} modules")
    
    else:
        print(f"Usage: {sys.argv[0]} [new|changed|all]")

if __name__ == '__main__':
    main()
