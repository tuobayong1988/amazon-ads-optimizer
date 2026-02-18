#!/bin/bash
# v143: 补丁recharts Formatter类型以兼容简化的formatter回调签名
RECHARTS_TYPES="node_modules/recharts/types/component/DefaultTooltipContent.d.ts"
if [ -f "$RECHARTS_TYPES" ]; then
  sed -i 's/export type Formatter<TValue extends ValueType, TName extends NameType> = (value: TValue | undefined.*$/export type Formatter<TValue extends ValueType, TName extends NameType> = (...args: any[]) => any;/' "$RECHARTS_TYPES"
  echo "[patch] recharts Formatter type patched successfully"
fi
