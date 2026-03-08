declare module "cookie" {
  export function parse(
    str: string,
    options?: Record<string, any>
  ): Record<string, string>;
}
