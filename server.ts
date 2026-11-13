import 'dotenv/config';
import * as path from 'path';
import express from 'express';
import { createAttachmentsRouter } from './src/server/attachmentsRouter.ts';
import { readB2ConfigFromEnv } from './src/server/b2Storage.ts';
import { getFirebaseServerConfig } from './src/server/firebaseServerAuth.ts';

export async function createMurafiqServerApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));

  app.get('/api/health', (_req, res) => {
    const b2Configured = readB2ConfigFromEnv() !== null;
    const { firestoreDatabaseId } = getFirebaseServerConfig();
    res.json({
      ok: true,
      storageProvider: 'backblaze_b2',
      b2Configured,
      firestoreDatabaseId,
    });
  });

  app.use('/api/attachments', createAttachmentsRouter());

  // Always return JSON 404 for unknown /api routes rather than falling through to SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: 'API_ROUTE_NOT_FOUND',
      messageArabic: 'مسار الواجهة البرمجية المطلوب غير موجود.',
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

const isMainEntry =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(process.cwd(), 'server.ts');

if (isMainEntry) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  createMurafiqServerApp()
    .then((app) => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Murafiq full-stack server running on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start Murafiq server:', err);
      process.exit(1);
    });
}
