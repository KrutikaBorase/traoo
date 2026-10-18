import { lookup } from "node:dns/promises";
import type { ResearchPage } from "./types";

const MAX_PAGE_BYTES = 1_000_000;
const MAX_CRAWL_PAGES = 8;
const USER_AGENT = "TraoInterviewPrepBot/1.0 (+respectful, robots-aware)";

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function parseExternalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Company URL must be a valid absolute URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Company URL must use HTTP(S) and cannot contain credentials.");
  }
  return url;
}

export async function validateExternalUrl(raw: string): Promise<URL> {
  const url = parseExternalUrl(raw);
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    if (process.env.NODE_ENV === "production") throw new Error("Localhost URLs are not allowed in production.");
    return url;
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new Error("Company host could not be resolved.");
  if (process.env.NODE_ENV === "production" && addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Private and loopback company addresses are not allowed in production.");
  }
  return url;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function cleanHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " "),
  ).trim().slice(0, 12_000);
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Response exceeded the configured size limit.");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

function extractTitle(html: string, fallback: string): string {
  return decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? fallback)
    .replace(/<[^>]+>/g, "")
    .trim()
    .slice(0, 180);
}

function extractLinks(html: string, pageUrl: URL): Array<{ url: URL; label: string }> {
  const results: Array<{ url: URL; label: string }> = [];
  const pattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = decodeEntities(match[2]).trim();
    const label = cleanHtml(match[3]);
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    try {
      const url = new URL(href, pageUrl);
      if (url.origin !== pageUrl.origin || !["http:", "https:"].includes(url.protocol)) continue;
      url.hash = "";
      if (!results.some((item) => item.url.href === url.href)) results.push({ url, label });
    } catch {
      continue;
    }
  }
  return results;
}

function classifyLink(url: URL, label = ""): "hiring" | "about" | null {
  const hint = `${url.pathname} ${label}`.toLowerCase();
  if (/(career|hiring|recruit|interview|job|talent|people|handbook|engineering-blog)/.test(hint)) return "hiring";
  if (/(about|company|mission|product|what-we-do)/.test(hint)) return "about";
  return null;
}

function robotsAllows(content: string, path: string): boolean {
  const lines = content.split(/\r?\n/).map((line) => line.split("#")[0].trim());
  let applies = false;
  const disallowed: string[] = [];
  for (const line of lines) {
    const [key, ...parts] = line.split(":");
    const value = parts.join(":").trim();
    if (/^user-agent$/i.test(key?.trim() ?? "")) {
      if (applies && value !== "*") break;
      applies = value === "*" || value.toLowerCase() === USER_AGENT.toLowerCase();
    } else if (applies && /^disallow$/i.test(key?.trim() ?? "") && value) {
      disallowed.push(value);
    }
  }
  return !disallowed.some((rule) => path.startsWith(rule));
}

async function fetchWithRetry(url: URL): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      let target = url;
      for (let redirect = 0; redirect < 4; redirect += 1) {
        await validateExternalUrl(target.href);
        const response = await fetch(target, {
          headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
          signal: AbortSignal.timeout(12_000),
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) return response;
          target = new URL(location, target);
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Temporary HTTP ${response.status} while fetching ${target.href}.`);
          await response.body?.cancel();
          break;
        }
        return response;
      }
      if (!lastError) throw new Error("Too many redirects.");
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Page fetch failed.");
}

async function robotsFor(origin: string): Promise<string | null> {
  try {
    const response = await fetchWithRetry(new URL("/robots.txt", origin));
    if (response.status === 404 || response.status === 410) return "";
    if (!response.ok || !response.headers.get("content-type")?.includes("text/plain")) return null;
    return await readBounded(response, 100_000);
  } catch {
    return null;
  }
}

async function fetchPage(url: URL, robots: string, kind: ResearchPage["kind"]): Promise<ResearchPage | null> {
  if (!robotsAllows(robots, url.pathname)) return null;
  try {
    const response = await fetchWithRetry(url);
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") ?? "")) {
      return null;
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_PAGE_BYTES) return null;
    const html = await readBounded(response, MAX_PAGE_BYTES);
    return {
      url: url.href,
      title: extractTitle(html, url.hostname),
      text: cleanHtml(html),
      kind,
      links: extractLinks(html, url).map(({ url: linkUrl, label }) => ({ url: linkUrl.href, label })),
    };
  } catch {
    return null;
  }
}

export async function crawlCompanySite(companyUrl: string): Promise<{
  pages: ResearchPage[];
  skipped: string[];
}> {
  const start = parseExternalUrl(companyUrl);
  start.hash = "";
  const robots = await robotsFor(start.origin);
  if (robots === null) {
    return {
      pages: [],
      skipped: [new URL("/robots.txt", start.origin).href, start.href],
    };
  }
  const pages: ResearchPage[] = [];
  const skipped: string[] = [];
  const homepage = await fetchPage(start, robots, "home");
  if (homepage) pages.push(homepage);
  else skipped.push(start.href);

  let candidates: Array<{ url: URL; kind: "hiring" | "about" }> = [];
  if (homepage) {
    candidates = (homepage.links ?? [])
      .map((link) => {
        const url = new URL(link.url);
        return { url, kind: classifyLink(url, link.label) };
      })
      .filter((item): item is { url: URL; kind: "hiring" | "about" } => item.kind !== null)
      .sort((a, b) => Number(b.kind === "hiring") - Number(a.kind === "hiring"))
      .slice(0, MAX_CRAWL_PAGES - 1)
  }

  for (const candidate of candidates) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const page = await fetchPage(candidate.url, robots, candidate.kind);
    if (page) pages.push(page);
    else skipped.push(candidate.url.href);
  }
  return { pages, skipped };
}

export async function searchInterviewDiscussion(company: string): Promise<ResearchPage[]> {
  const query = encodeURIComponent(`${company} interview process experience`);
  const url = new URL(`https://html.duckduckgo.com/html/?q=${query}`);
  try {
    const robots = await robotsFor(url.origin);
    if (robots === null || !robotsAllows(robots, url.pathname)) return [];
    const response = await fetchWithRetry(url);
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return [];
    const html = await readBounded(response, MAX_PAGE_BYTES);
    const matches = [...html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    return matches.slice(0, 5).map((match) => ({
      url: decodeEntities(match[1]),
      title: cleanHtml(match[2]).slice(0, 180),
      text: "Public search result; verify the original source before relying on specific claims.",
      kind: "discussion",
    }));
  } catch {
    return [];
  }
}
