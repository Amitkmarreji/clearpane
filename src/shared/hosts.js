// Hostname helpers shared by the background modules.

/** "a.b.example.com" -> ["a.b.example.com", "b.example.com", "example.com", "com"] */
export function hostAndParents(host) {
  const labels = host.split('.');
  return labels.map((_, i) => labels.slice(i).join('.'));
}

/**
 * Every key a filter could be written under for this host: the host, its
 * parent domains, and uBO "entity" forms such as "example.*", built without a
 * public-suffix list by assuming the suffix is one or two labels long.
 */
export function lookupKeys(host) {
  const labels = host.split('.');
  const keys = [];
  for (let i = 0; i < labels.length; i++) {
    keys.push(labels.slice(i).join('.'));
    for (const k of [1, 2]) {
      if (labels.length - i - k >= 1) keys.push(`${labels.slice(i, labels.length - k).join('.')}.*`);
    }
  }
  return keys;
}

export function hostnameOf(url) {
  try {
    const u = new URL(url);
    return /^(https?|wss?|ftp):$/.test(u.protocol) ? u.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

/** The allowlist stores sites without "www.". */
export function siteKey(host) {
  return host.replace(/^www\./, '');
}

export function isAllowlisted(host, allowlist) {
  if (!host) return false;
  const parents = new Set(hostAndParents(host));
  return allowlist.some(site => parents.has(site));
}
