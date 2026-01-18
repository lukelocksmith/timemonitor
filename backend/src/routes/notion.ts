import { Router, Response } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { db } from '../database.js';
import { syncWorkers, syncProjects } from '../notion/sync.js';
import { AuthenticatedRequest } from '../types/auth.js';

export const notionRouter = Router();

// Wszystkie endpointy Notion są tylko dla admina
notionRouter.use(requireAuth, requireRole('admin'));

notionRouter.post('/sync/workers', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await syncWorkers();
    res.json(result);
  } catch (error) {
    console.error('Notion sync workers error:', error);
    res.status(500).json({
      error: 'Błąd synchronizacji pracowników',
      details: error instanceof Error ? error.message : 'Nieznany błąd',
    });
  }
});

notionRouter.post('/sync/projects', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await syncProjects();
    res.json(result);
  } catch (error) {
    console.error('Notion sync projects error:', error);
    res.status(500).json({
      error: 'Błąd synchronizacji projektów',
      details: error instanceof Error ? error.message : 'Nieznany błąd',
    });
  }
});

notionRouter.get('/workers', (req: AuthenticatedRequest, res: Response) => {
  const workers = db.prepare(`SELECT * FROM notion_workers ORDER BY name`).all();
  res.json(workers);
});

notionRouter.get('/projects', (req: AuthenticatedRequest, res: Response) => {
  const projects = db.prepare(`SELECT * FROM notion_projects ORDER BY name`).all();
  res.json(projects);
});
