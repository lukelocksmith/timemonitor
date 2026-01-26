import { db } from '../database.js';
import { getConfig } from '../config.js';
import { queryNotionDataSource, queryNotionDatabase } from './client.js';

type NotionPage = {
  id: string;
  properties?: Record<string, unknown>;
};

type NotionSource = {
  dataSourceId?: string;
  databaseId?: string;
};

function resolveSource(dataSourceEnv: string, databaseEnv: string): NotionSource {
  const dataSourceId = getConfig(dataSourceEnv) ?? undefined;
  const databaseId = getConfig(databaseEnv) ?? undefined;
  if (dataSourceId || databaseId) {
    return { dataSourceId, databaseId };
  }

  throw new Error(`Brak ${dataSourceEnv} lub ${databaseEnv} w .env`);
}

async function querySource(source: NotionSource, filter?: Record<string, unknown>) {
  // Najpierw próbujemy databaseId (publiczne API Notion)
  // dataSourceId jest endpointem wewnętrznym MCP, nie publicznym API REST
  if (source.databaseId) {
    return queryNotionDatabase(source.databaseId, filter);
  }

  if (source.dataSourceId) {
    try {
      return await queryNotionDataSource(source.dataSourceId, filter);
    } catch (error) {
      console.warn('Nieudane query data source:', error);
      throw error;
    }
  }

  throw new Error('Brak dataSourceId i databaseId do zapytania');
}

function getPlainText(items: any[] | undefined): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const text = items.map((item) => item?.plain_text || '').join('').trim();
  return text || null;
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getProperty(properties: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(properties, name)) {
      return (properties as any)[name];
    }
  }

  const normalized = new Map<string, string>();
  for (const key of Object.keys(properties)) {
    normalized.set(normalizeKey(key), key);
  }

  for (const name of names) {
    const key = normalized.get(normalizeKey(name));
    if (key) {
      return (properties as any)[key];
    }
  }

  return null;
}

function getTitle(prop: any): string | null {
  return getPlainText(prop?.title);
}

function getRichText(prop: any): string | null {
  return getPlainText(prop?.rich_text);
}

function getNumber(prop: any): number | null {
  return typeof prop?.number === 'number' ? prop.number : null;
}

function getSelectName(prop: any): string | null {
  return prop?.select?.name || null;
}

function getStatusName(prop: any): string | null {
  return prop?.status?.name || null;
}

function getUrl(prop: any): string | null {
  return typeof prop?.url === 'string' ? prop.url : null;
}

function getFormulaValue(prop: any): string | null {
  const formula = prop?.formula;
  if (!formula) return null;
  if (typeof formula.string === 'string') return formula.string;
  if (typeof formula.number === 'number') return String(formula.number);
  return null;
}

function getMultiSelectNames(prop: any): string[] {
  if (!Array.isArray(prop?.multi_select)) return [];
  return prop.multi_select.map((item: any) => item?.name).filter(Boolean);
}

function normalizeNumericId(raw: string | null): string | null {
  if (!raw) return null;
  const matches = raw.match(/\d+/g);
  if (!matches || matches.length === 0) return null;

  let longest = matches[0];
  for (const item of matches) {
    if (item.length > longest.length) {
      longest = item;
    }
  }

  return longest;
}

function normalizeClickUpListId(raw: string | null): string | null {
  const id = normalizeNumericId(raw);
  if (!id) return null;

  // KlikUp list_id ma zwykle >= 8 cyfr; krótsze to zwykle workspace_id
  if (id.length < 8) return null;

  return id;
}

export async function syncWorkers() {
  const source = resolveSource('NOTION_WORKERS_DS', 'NOTION_WORKERS_DB');
  const pages = (await querySource(source)) as NotionPage[];

  const rows = pages
    .map((page) => {
      const properties = page.properties || {};
      const name =
        getTitle(getProperty(properties, 'Imię i nazwisko', 'Imie i nazwisko', 'Name')) ||
        null;
      const clickupUserId =
        getRichText(getProperty(properties, 'ClickUp ID', 'Clickup ID', 'ClickUp Id', 'Clickup Id')) ||
        getFormulaValue(getProperty(properties, 'ClickUp ID', 'Clickup ID', 'ClickUp Id', 'Clickup Id'));
      const hourlyRate =
        getNumber(getProperty(properties, 'Stawka godzinowe', 'Stawka godzinowa')) ?? 0;
      const status =
        getStatusName(getProperty(properties, 'Status')) ||
        getSelectName(getProperty(properties, 'Status'));

      if (!name) {
        return null;
      }

      return {
        notion_page_id: page.id,
        clickup_user_id: normalizeNumericId(clickupUserId || null),
        name,
        hourly_rate: hourlyRate,
        status: status || null,
      };
    })
    .filter(Boolean) as Array<{
    notion_page_id: string;
    clickup_user_id: string | null;
    name: string;
    hourly_rate: number;
    status: string | null;
  }>;

  const insertWorker = db.prepare(`
    INSERT INTO notion_workers (
      notion_page_id, clickup_user_id, name, hourly_rate, status, synced_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(notion_page_id) DO UPDATE SET
      clickup_user_id = excluded.clickup_user_id,
      name = excluded.name,
      hourly_rate = excluded.hourly_rate,
      status = excluded.status,
      synced_at = CURRENT_TIMESTAMP
  `);

  const upsertWorkers = db.transaction((items: typeof rows) => {
    for (const row of items) {
      insertWorker.run(
        row.notion_page_id,
        row.clickup_user_id,
        row.name,
        row.hourly_rate,
        row.status
      );
    }
  });

  upsertWorkers(rows);

  return {
    source,
    total_pages: pages.length,
    saved: rows.length,
    skipped: pages.length - rows.length,
  };
}

export async function syncProjects() {
  const source = resolveSource('NOTION_PROJECTS_DS', 'NOTION_PROJECTS_DB');
  const pages = (await querySource(source)) as NotionPage[];

  const rows = pages
    .map((page) => {
      const properties = page.properties || {};
      const name = getTitle(getProperty(properties, 'Name', 'Nazwa'));
      const hourlyRate =
        getNumber(getProperty(properties, 'Średnia wartość za godzinę', 'Srednia wartosc za godzine')) ??
        0;
      const status =
        getStatusName(getProperty(properties, 'Status')) ||
        getSelectName(getProperty(properties, 'Status'));
      const tags = getMultiSelectNames(getProperty(properties, 'Tags'));
      const clickupIdCandidate =
        getUrl(getProperty(properties, 'Do projektu w clickup', 'Do projektu w ClickUp')) ||
        getUrl(getProperty(properties, 'Clickup', 'ClickUp')) ||
        getFormulaValue(getProperty(properties, 'ID clickup', 'ID ClickUp'));
      const clickupId = normalizeClickUpListId(clickupIdCandidate || null);
      const monthlyBudget =
        getNumber(getProperty(properties, 'Budżet miesięczny', 'Budzet miesieczny', 'Monthly budget')) ?? 0;

      if (!name) {
        return null;
      }

      return {
        notion_page_id: page.id,
        clickup_id: clickupId || null,
        name,
        hourly_rate: hourlyRate,
        monthly_budget: monthlyBudget,
        status: status || null,
        tags: tags.length > 0 ? tags.join(', ') : null,
      };
    })
    .filter(Boolean) as Array<{
    notion_page_id: string;
    clickup_id: string | null;
    name: string;
    hourly_rate: number;
    monthly_budget: number;
    status: string | null;
    tags: string | null;
  }>;

  const insertProject = db.prepare(`
    INSERT INTO notion_projects (
      notion_page_id, clickup_id, name, hourly_rate, monthly_budget, status, tags, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(notion_page_id) DO UPDATE SET
      clickup_id = excluded.clickup_id,
      name = excluded.name,
      hourly_rate = excluded.hourly_rate,
      monthly_budget = excluded.monthly_budget,
      status = excluded.status,
      tags = excluded.tags,
      synced_at = CURRENT_TIMESTAMP
  `);

  const upsertProjects = db.transaction((items: typeof rows) => {
    for (const row of items) {
      insertProject.run(
        row.notion_page_id,
        row.clickup_id,
        row.name,
        row.hourly_rate,
        row.monthly_budget,
        row.status,
        row.tags
      );
    }
  });

  upsertProjects(rows);

  return {
    source,
    total_pages: pages.length,
    saved: rows.length,
    skipped: pages.length - rows.length,
  };
}
