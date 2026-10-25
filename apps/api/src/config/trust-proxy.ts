import { isIP } from 'node:net';

const predefinedRanges = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * 只接受明确的代理地址或网段，禁止把任意 X-Forwarded-For 当成真实客户端地址。
 */
export function parseTrustProxy(raw: string | undefined): string[] {
  const value = raw?.trim();
  if (!value) return [];

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return [];

  const parsedEntries: string[] = [];
  for (const entry of entries) {
    if (predefinedRanges.has(entry)) {
      parsedEntries.push(entry);
      continue;
    }

    const [address, prefix, extra] = entry.split('/');
    if (!address) {
      throw new Error(`环境变量 TRUST_PROXY_CIDRS 含无效地址：${entry}`);
    }
    const family = isIP(address);
    if (!family || extra !== undefined) {
      throw new Error(`环境变量 TRUST_PROXY_CIDRS 含无效地址：${entry}`);
    }
    if (prefix === undefined) {
      parsedEntries.push(address);
      continue;
    }
    if (!/^\d+$/.test(prefix)) {
      throw new Error(`环境变量 TRUST_PROXY_CIDRS 含无效网段：${entry}`);
    }

    const maximumPrefix = family === 4 ? 32 : 128;
    const prefixNumber = Number(prefix);
    if (prefixNumber < 1 || prefixNumber > maximumPrefix) {
      throw new Error(`环境变量 TRUST_PROXY_CIDRS 网段必须在 1-${maximumPrefix} 之间：${entry}`);
    }
    parsedEntries.push(`${address}/${prefixNumber}`);
  }

  return [...new Set(parsedEntries)];
}
