/**
 * v143: 覆盖recharts的Formatter类型以兼容简化的formatter回调签名
 * recharts v2.15+ 的Formatter类型要求5个参数，但运行时2个参数也可以正常工作
 */
import 'recharts';

declare module 'recharts' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type Formatter<TValue, TName> = (...args: any[]) => any;
}
