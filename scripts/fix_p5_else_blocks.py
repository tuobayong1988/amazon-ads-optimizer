#!/usr/bin/env python3
"""
Fix P5 else blocks that are missing closing braces.

The pattern we need to fix:
  } else {                          <-- opened by our regex replacement
    const results = await ...submitAndWaitMultipleReports(...)
    for (const result of results) {
      ...
    }
  }                                 <-- this was the ORIGINAL closing brace of the outer if/else
  // code after the if/else block

We need to add a closing "}" for the else block before the original closing brace.
The fix: change the "}" that was the original closing to "}}" (close else + close outer)
"""

import re

files_to_fix = [
    'server/sync/syncPerformance.ts',
    'server/sync/syncSb.ts',
    'server/sync/syncSd.ts',
    'server/sync/amazonSyncService.ts',
]

for filepath in files_to_fix:
    try:
        with open(filepath, 'r') as f:
            lines = f.readlines()
        
        modified = False
        new_lines = []
        i = 0
        
        while i < len(lines):
            line = lines[i]
            
            # Detect "} else {" pattern from our P5 fix
            if '} else {' in line.strip() and i > 0:
                # Check if previous lines contain P5 async submission
                context = ''.join(lines[max(0, i-8):i])
                if 'submitReportsToAsyncQueue' in context or 'P5: async mode' in context:
                    # This is our P5 else block
                    # Find the indent level of the "} else {"
                    else_indent = len(line) - len(line.lstrip())
                    
                    new_lines.append(line)
                    i += 1
                    
                    # Now scan forward to find where the else block should close
                    # We need to find the "}" at the same indent level as "} else {"
                    # which was the original closing brace
                    brace_depth = 1  # We're inside the else block
                    
                    while i < len(lines):
                        current = lines[i]
                        stripped = current.strip()
                        current_indent = len(current) - len(current.lstrip())
                        
                        # Count braces in this line
                        for ch in stripped:
                            if ch == '{':
                                brace_depth += 1
                            elif ch == '}':
                                brace_depth -= 1
                        
                        if brace_depth == 0:
                            # This "}" closes our else block
                            # But we need to check: was this the original closing brace?
                            # If so, we need to add an extra "}" before it
                            indent_str = ' ' * else_indent
                            new_lines.append(indent_str + '}\n')  # Close the else block
                            new_lines.append(current)  # Keep the original closing brace
                            modified = True
                            i += 1
                            break
                        else:
                            new_lines.append(current)
                            i += 1
                    
                    continue
            
            new_lines.append(line)
            i += 1
        
        if modified:
            with open(filepath, 'w') as f:
                f.writelines(new_lines)
            print(f'Fixed: {filepath}')
        else:
            print(f'No changes needed: {filepath}')
    
    except FileNotFoundError:
        print(f'Not found: {filepath}')
    except Exception as e:
        print(f'Error in {filepath}: {e}')
