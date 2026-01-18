import { Agent, setGlobalDispatcher } from 'undici';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const DEFAULT_NOTION_VERSION = '2022-06-28';
const DEFAULT_PAGE_SIZE = 100;

// Wymuszenie IPv4 - rozwiązuje problemy z timeout gdy IPv6 nie działa
const agent = new Agent({
  connect: {
    family: 4, // Force IPv4
  },
});
setGlobalDispatcher(agent);

function getNotionHeaders() {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    throw new Error('Brak NOTION_API_KEY w .env');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': process.env.NOTION_VERSION || DEFAULT_NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

async function notionPost(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    method: 'POST',
    headers: getNotionHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notion API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function queryAllPages(path: string, baseBody: Record<string, unknown> = {}) {
  const allResults: unknown[] = [];
  let startCursor: string | null = null;

  do {
    const body = {
      ...baseBody,
      page_size: DEFAULT_PAGE_SIZE,
      ...(startCursor ? { start_cursor: startCursor } : {}),
    };

    const data = await notionPost(path, body);

    const results = Array.isArray(data?.results) ? data.results : [];
    allResults.push(...results);

    startCursor = data?.has_more ? data?.next_cursor : null;
  } while (startCursor);

  return allResults;
}

export async function queryNotionDataSource(dataSourceId: string, filter?: Record<string, unknown>) {
  const body = filter ? { filter } : {};
  return queryAllPages(`/data_sources/${dataSourceId}/query`, body);
}

export async function queryNotionDatabase(databaseId: string, filter?: Record<string, unknown>) {
  const body = filter ? { filter } : {};
  return queryAllPages(`/databases/${databaseId}/query`, body);
}
