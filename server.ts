import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import { createAttachmentsRouter } from './src/server/attachmentsRouter.ts';
import { createMeetingsRouter } from './src/server/meetingsRouter.ts';
import { createAiRouter } from './src/server/aiRouter.ts';
import { readB2ConfigFromEnv } from './src/server/b2Storage.ts';
import {
  getFirebaseAdminReadinessStatus,
  verifyNamedDatabaseAdminAccess,
} from './src/server/firebaseServerAuth.ts';

export async function createMurafiqServerApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));

  app.get('/api/health', async (req, res) => {
    const b2Configured = readB2ConfigFromEnv() !== null;
    const adminReadiness = getFirebaseAdminReadinessStatus();
    const shouldVerifyAccess = req.query.verify === 'admin';
    const accessProbe = shouldVerifyAccess ? await verifyNamedDatabaseAdminAccess() : null;

    res.json({
      ok: true,
      storageProvider: 'backblaze_b2',
      b2Configured,
      firebaseAdminConfigured: adminReadiness.configured,
      firebaseAdminCredentialSource: adminReadiness.credentialSource,
      supportsManagedIdentityAdc: adminReadiness.supportsManagedIdentityAdc,
      ...(accessProbe
        ? {
            firebaseAdminAccessVerified: accessProbe.accessVerified,
            firebaseAdminAccessStatus: accessProbe.reasonCode,
          }
        : {}),
      firestoreDatabaseId: adminReadiness.firestoreDatabaseId,
    });
  });

  app.use('/api/attachments', createAttachmentsRouter());
  app.use('/api/meetings', createMeetingsRouter());
  app.use('/api/ai', createAiRouter());

  // Always return JSON 404 for unknown /api routes rather than falling through to SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: 'API_ROUTE_NOT_FOUND',
      messageArabic: 'مسار الواجهة البرمجية المطلوب غير موجود.',
    });
  });

  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.npm_lifecycle_event === 'start' ||
    process.argv.includes('--production');

  if (!isProduction) {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    // Initialize Vite asynchronously so Express binds port 3000 and serves /api/health
    // immediately without blocking on cold dependency pre-bundling.
    const viteServerPromise = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          ...(disableHmr ? { hmr: false, watch: null } : {}),
        },
        appType: 'spa',
      })
    );

    viteServerPromise.catch((err) => {
      console.error('Failed to initialize Vite dev middleware:', err);
    });

    app.use(async (req, res, next) => {
      try {
        const vite = await viteServerPromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
      throw new Error(
        'PRODUCTION_BUILD_MISSING: مجلد dist/index.html غير موجود. شغّل npm run build قبل npm run start.'
      );
    }
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(indexHtmlPath);
    });
  }

  return app;
}

function resolveServerBindConfig(isProduction: boolean): { port: number; host: string } {
  const argv = process.argv.slice(2);
  let cliPort: string | undefined;
  let cliHost: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' && argv[i + 1]) {
      cliPort = argv[++i];
    } else if (arg.startsWith('--port=')) {
      cliPort = arg.slice('--port='.length);
    } else if (arg === '--host' && argv[i + 1]) {
      cliHost = argv[++i];
    } else if (arg.startsWith('--host=')) {
      cliHost = arg.slice('--host='.length);
    }
  }

  const envPort = process.env.PORT;
  const safeEnvPort =
    !isProduction && envPort && process.env.NGINX_PORT && envPort === process.env.NGINX_PORT
      ? process.env.DEFAULT_APP_PORT || '3000'
      : envPort;

  const parsedPort = parseInt(cliPort || safeEnvPort || process.env.DEFAULT_APP_PORT || '3000', 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
  const host = cliHost || process.env.HOST || '0.0.0.0';
  return { port, host };
}

const isMainEntry = (() => {
  if (typeof process === 'undefined' || !Array.isArray(process.argv) || !process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(path.resolve(process.cwd(), 'server.ts'));
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(process.cwd(), 'server.ts');
  }
})();

if (isMainEntry) {
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.npm_lifecycle_event === 'start' ||
    process.argv.includes('--production');
  const { port: PORT, host: HOST } = resolveServerBindConfig(isProduction);

  createMurafiqServerApp()
    .then((app) => {
      const httpServer = app.listen(PORT, HOST, () => {
        console.log(`Murafiq full-stack server running on http://${HOST}:${PORT}`);
      });
      httpServer.on('error', (err) => {
        console.error(`Failed to bind Murafiq server on ${HOST}:${PORT}:`, err);
        process.exit(1);
      });
    })
    .catch((err) => {
      console.error('Failed to start Murafiq server:', err);
      process.exit(1);
    });
}
