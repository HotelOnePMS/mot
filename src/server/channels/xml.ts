import { XMLParser } from 'fast-xml-parser';
import { ChannelApiError } from './types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/** Escapes a value for use in XML text or a double-quoted attribute */
export function esc(value: string | number | boolean | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function parseXml(xml: string): Record<string, any> {
  try {
    return parser.parse(xml);
  } catch (error) {
    throw new ChannelApiError('OTA returned malformed XML', {
      error: error instanceof Error ? error.message : String(error),
      body: xml.slice(0, 2000),
    });
  }
}

/** XML elements that may repeat come back as a single object or an array */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Text content of a parsed element (plain string or {'#text': ...}) */
export function text(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)['#text']);
  }
  return '';
}

export function attr(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return value === undefined ? undefined : String(value);
}

export interface PostXmlOptions {
  url: string;
  body: string;
  basicAuth?: { username: string; password: string };
  method?: 'GET' | 'POST';
  timeoutMs?: number;
}

/** Sends an XML request and returns the raw response body */
export async function postXml({
  url,
  body,
  basicAuth,
  method = 'POST',
  timeoutMs = 30000,
}: PostXmlOptions): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/xml; charset=utf-8',
    Accept: 'application/xml, text/xml',
  };
  if (basicAuth) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${basicAuth.username}:${basicAuth.password}`).toString('base64');
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (error) {
    throw new ChannelApiError(`Could not reach ${new URL(url).host}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const responseBody = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new ChannelApiError('The OTA rejected the credentials (HTTP ' + response.status + ')');
  }
  if (!response.ok) {
    throw new ChannelApiError(`OTA request failed with HTTP ${response.status}`, {
      body: responseBody.slice(0, 2000),
    });
  }
  return responseBody;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
