import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { verifyAuth } from '@supabase/server/core';
import {
  initDb,
  ensureDbReady,
  getActiveStorageTarget,
  getDbStatus,
  getAllRecords,
  getRecord,
  saveRecord,
  saveRecordWithStatus,
  deleteRecord,
  getColumns,
  saveColumns,
  getTeamMembers,
  saveTeamMembers,
  logAudit,
  getAllSerials,
  getSerial,
  saveSerial,
  bulkSaveSerials,
  deleteSerial,
  getChargerRecords,
  saveChargerRecord,
  getVehicleRecords,
  saveVehicleRecord,
  getBranchTransfers,
  createBranchTransfer,
  receiveBranchTransfers,
  deleteBranchTransfer,
  backupPermanentCodebase,
  exportFullDatabaseSnapshot,
  exportFullDatabaseExcelBuffer,
  exportFullSerialHistoryExcelBuffer,
  triggerCloudSpaceBackupNow,
  restoreFullDatabaseSnapshot,
  getResetEpoch,
  factoryResetAllData,
} from './server/db.ts';
import {
  getCloudinaryStatus,
  listCloudSpaceBackups,
  readCloudSpaceSnapshot,
} from './server/cloudinary.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Real-Time Server-Sent Events (SSE) Hub
interface RealtimeClient {
  id: string;
  res: express.Response;
}
const realtimeClients: RealtimeClient[] = [];

function broadcastRealtime(event: string, payload: any) {
  const message = `data: ${JSON.stringify({ event, payload, timestamp: new Date().toISOString() })}\n\n`;
  for (let i = realtimeClients.length - 1; i >= 0; i--) {
    const client = realtimeClients[i];
    try {
      client.res.write(message);
    } catch {
      realtimeClients.splice(i, 1);
    }
  }
}

// CORS configuration to allow Vercel frontend or any domain
const allowedOrigins =
  process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.trim() !== '*'
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : true;

app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Disable browser/proxy caching on all /api/* routes so mobile & desktop always get fresh state
app.use('/api', async (req, res, next) => {
  if (req.path !== '/realtime') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (req.path !== '/db/test') {
      try {
        await ensureDbReady();
      } catch {
        // fallback handled by db layer
      }
    }
  }
  next();
});

// Initialize DBMS connection (PostgreSQL or Supabase or persistent file)
initDb().catch((err) => {
  console.error('[Server] DBMS initialization error:', err);
});

// Real-Time SSE Stream Endpoint
app.get('/api/realtime', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();

  const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const client: RealtimeClient = { id: clientId, res };
  realtimeClients.push(client);

  res.write(
    `data: ${JSON.stringify({
      event: 'CONNECTED',
      clientId,
      activeClients: realtimeClients.length,
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  const pingInterval = setInterval(() => {
    try {
      res.write(`:ping\n\n`);
    } catch {
      clearInterval(pingInterval);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(pingInterval);
    const idx = realtimeClients.findIndex((c) => c.id === clientId);
    if (idx !== -1) {
      realtimeClients.splice(idx, 1);
    }
  });
});

// API Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    db: getDbStatus(),
  });
});

app.get('/api/db/status', (req, res) => {
  res.json(getDbStatus());
});

app.post('/api/db/test', async (req, res) => {
  try {
    const result = await initDb();
    res.json({
      success: true,
      initResult: result,
      db: getDbStatus(),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, db: getDbStatus() });
  }
});

// Verify Supabase user JWT via SUPABASE_JWKS_URL using @supabase/server
app.get('/api/auth/verify', async (req, res) => {
  try {
    const headers = new Headers();
    if (req.headers.authorization) {
      headers.set('authorization', req.headers.authorization);
    }
    if (typeof req.headers.apikey === 'string') {
      headers.set('apikey', req.headers.apikey);
    }
    const webRequest = new Request(`http://localhost:${PORT}${req.originalUrl}`, {
      method: req.method,
      headers,
    });
    const { data, error } = await verifyAuth(webRequest, { auth: 'user' });
    if (error) {
      return res.status(error.status).json(error.toJSON());
    }
    res.json({ success: true, user: data.userClaims, authMode: data.authMode });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stock Records CRUD
app.get('/api/records', async (req, res) => {
  try {
    const records = await getAllRecords();
    res.json({ success: true, data: records, resetEpoch: getResetEpoch() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/records/:date', async (req, res) => {
  try {
    const record = await getRecord(req.params.date);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    res.json({ success: true, data: record });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/records', async (req, res) => {
  try {
    const record = req.body;
    if (!record || !record.date) {
      return res.status(400).json({ success: false, error: 'Date is required' });
    }
    const result = await saveRecordWithStatus(record);
    const storage = getActiveStorageTarget();
    broadcastRealtime('RECORD_UPDATED', result.record);
    res.json({
      success: true,
      data: result.record,
      storage,
      persistedToRemote: storage === 'local_file' ? false : result.persistedToRemote,
      remoteError: result.remoteError,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/records/:date', async (req, res) => {
  try {
    const success = await deleteRecord(req.params.date);
    if (success) {
      broadcastRealtime('RECORD_DELETED', { date: req.params.date });
    }
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Battery Columns
app.get('/api/columns', async (req, res) => {
  try {
    const columns = await getColumns();
    res.json({ success: true, data: columns });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/columns', async (req, res) => {
  try {
    const columns = req.body;
    if (!Array.isArray(columns)) {
      return res.status(400).json({ success: false, error: 'Columns must be an array' });
    }
    const saved = await saveColumns(columns);
    const storage = getActiveStorageTarget();
    broadcastRealtime('COLUMNS_UPDATED', saved);
    res.json({
      success: true,
      data: saved,
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Team Members
app.get('/api/team', async (req, res) => {
  try {
    const team = await getTeamMembers();
    res.json({ success: true, data: team });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/team', async (req, res) => {
  try {
    const team = req.body;
    if (!Array.isArray(team)) {
      return res.status(400).json({ success: false, error: 'Team members must be an array' });
    }
    const saved = await saveTeamMembers(team);
    const storage = getActiveStorageTarget();
    broadcastRealtime('TEAM_UPDATED', saved);
    res.json({
      success: true,
      data: saved,
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Battery Serial & Batch Tracker Routes
app.get('/api/serials', async (req, res) => {
  try {
    const serials = await getAllSerials();
    res.json({ success: true, data: serials });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/serials/:serialNo', async (req, res) => {
  try {
    const item = await getSerial(req.params.serialNo);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Serial not found' });
    }
    res.json({ success: true, data: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/serials', async (req, res) => {
  try {
    const item = req.body;
    if (!item || !item.serialNo) {
      return res.status(400).json({ success: false, error: 'serialNo is required' });
    }
    const saved = await saveSerial(item);
    const storage = getActiveStorageTarget();
    broadcastRealtime('SERIAL_UPDATED', saved);
    res.json({
      success: true,
      data: saved,
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/serials/bulk', async (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Items must be an array' });
    }
    const saved = await bulkSaveSerials(items);
    const storage = getActiveStorageTarget();
    broadcastRealtime('SERIALS_BULK_UPDATED', saved);
    res.json({
      success: true,
      data: saved,
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/serials/:serialNo', async (req, res) => {
  try {
    const success = await deleteSerial(req.params.serialNo);
    if (success) {
      broadcastRealtime('SERIAL_DELETED', { serialNo: req.params.serialNo });
    }
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Charger Stock Register Routes
app.get('/api/chargers', async (req, res) => {
  try {
    const chargers = await getChargerRecords();
    res.json({ success: true, data: chargers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chargers', async (req, res) => {
  try {
    const { branchId, date, record } = req.body || {};
    if (!branchId || !date || !record) {
      return res.status(400).json({ success: false, error: 'branchId, date, and record are required' });
    }
    const saved = await saveChargerRecord(branchId, date, record);
    const storage = getActiveStorageTarget();
    broadcastRealtime('CHARGER_UPDATED', saved);
    res.json({
      success: true,
      data: saved,
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Vehicle Stock Register Routes
app.get('/api/vehicles', async (req, res) => {
  try {
    const vehicles = await getVehicleRecords();
    res.json({ success: true, data: vehicles });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/vehicles', async (req, res) => {
  try {
    const { branchId, date, record } = req.body || {};
    if (!branchId || !date || !record) {
      return res.status(400).json({ success: false, error: 'branchId, date, and record are required' });
    }
    const saved = await saveVehicleRecord(branchId, date, record);
    const storage = getActiveStorageTarget();
    broadcastRealtime('VEHICLE_UPDATED', saved);
    res.json({
      success: true,
      data: saved,
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Inter-Branch Stock Transfers & Receive Goods Notifications
app.get('/api/transfers', async (req, res) => {
  try {
    const transfers = await getBranchTransfers();
    res.json({ success: true, data: transfers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/transfers', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.fromBranchId || !body.toBranchId || !body.date || !Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'fromBranchId, toBranchId, date, and non-empty items array are required',
      });
    }
    const result = await createBranchTransfer(body);
    const storage = getActiveStorageTarget();
    broadcastRealtime('TRANSFERS_UPDATED', result.transfers);
    res.json({
      success: true,
      data: result.created,
      transfers: result.transfers,
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/transfers/receive', async (req, res) => {
  try {
    const { selections, receivedBy } = req.body || {};
    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ success: false, error: 'selections array is required' });
    }
    const result = await receiveBranchTransfers(selections, receivedBy);
    const storage = getActiveStorageTarget();
    broadcastRealtime('TRANSFERS_UPDATED', result.transfers);
    res.json({
      success: true,
      data: result.transfers,
      newlyReceived: result.newlyReceived,
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/transfers/:id', async (req, res) => {
  try {
    const transfers = await deleteBranchTransfer(req.params.id);
    broadcastRealtime('TRANSFERS_UPDATED', transfers);
    res.json({ success: true, data: transfers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Permanent Codebase & Disk + Cloud Space Backup Sync
app.post('/api/backup-permanent', async (req, res) => {
  try {
    const { records, serials } = req.body || {};
    const result = await backupPermanentCodebase(records, serials);
    const cloudSpace = await triggerCloudSpaceBackupNow(
      undefined,
      undefined,
      'permanent_sync',
      { archiveVersioned: true }
    );
    const storage = getActiveStorageTarget();
    broadcastRealtime('PERMANENT_SYNC_COMPLETE', result);
    res.json({
      ...result,
      cloudSpace,
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cloudinary Cloud Space Backup & Snapshot Restore Routes
app.get('/api/cloud/cloudinary/status', (req, res) => {
  res.json({
    success: true,
    ...getCloudinaryStatus(),
  });
});

app.get('/api/cloud/cloudinary/backups', async (req, res) => {
  try {
    const list = await listCloudSpaceBackups();
    res.json({
      success: true,
      ...list,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cloud/cloudinary/backup', async (req, res) => {
  try {
    const { records, serials, reason } = req.body || {};
    const result = await triggerCloudSpaceBackupNow(
      records,
      serials,
      typeof reason === 'string' && reason.trim() ? reason.trim() : 'manual_ui',
      { archiveVersioned: true }
    );
    const storage = getActiveStorageTarget();
    res.json({
      ...result,
      storage,
      persistedToRemote: storage !== 'local_file',
      cloudinaryStatus: getCloudinaryStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cloud/cloudinary/restore', async (req, res) => {
  try {
    const { source, secureUrl, fileName } = req.body || {};
    if (source !== 'cloudinary' && source !== 'local_disk') {
      return res.status(400).json({ success: false, error: 'Valid source (cloudinary or local_disk) is required' });
    }
    const snapshot = await readCloudSpaceSnapshot({ source, secureUrl, fileName });
    const restored = await restoreFullDatabaseSnapshot(snapshot);
    broadcastRealtime('PERMANENT_SYNC_COMPLETE', restored);
    res.json({
      ...restored,
      source,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Factory Reset All Stock Data, Serials, Transfers, History & Cloud Space
app.post('/api/system/factory-reset', async (req, res) => {
  try {
    const result = await factoryResetAllData();
    broadcastRealtime('FACTORY_RESET', {
      resetEpoch: result.resetEpoch,
      todayIST: result.todayIST,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/cloud/snapshot/export', async (req, res) => {
  try {
    const snapshot = await exportFullDatabaseSnapshot('download');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="battery-stock-backup-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(snapshot, null, 2));
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/cloud/excel/export', async (req, res) => {
  try {
    const excelBuffer = await exportFullDatabaseExcelBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Battery_Quantity_Stock_${new Date().toISOString().slice(0, 10)}.xlsx"`
    );
    res.send(excelBuffer);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/cloud/excel/serials/export', async (req, res) => {
  try {
    const excelBuffer = await exportFullSerialHistoryExcelBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Battery_Serials_And_History_${new Date().toISOString().slice(0, 10)}.xlsx"`
    );
    res.send(excelBuffer);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Automated WhatsApp Dispatch & Audit Log
app.post('/api/whatsapp/dispatch', async (req, res) => {
  try {
    const { date, recipients, message, imageDataUrl } = req.body;

    await logAudit('WHATSAPP_DISPATCH', {
      date,
      recipientsCount: recipients?.length || 0,
      timestamp: new Date().toISOString(),
    });

    // If user configured a WhatsApp Business API webhook or Cloud token in environment
    if (process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      console.log('[Server] Dispatching via official WhatsApp Cloud API...');
      // Future expansion: call WhatsApp graph API
    }

    res.json({
      success: true,
      message: 'Dispatch logged and recorded to database',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Battery Barcode & Serial OCR via Gemini Flash / Vision
app.post('/api/scan-barcode-ocr', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: 'No image data provided' });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

    if (apiKey) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `You are an expert industrial battery inventory scanner. Analyze this image of an automotive, inverter, or commercial battery, serial sticker label, or barcode.
Locate and extract:
1. The unique Battery Serial Number (e.g. printed under a barcode, etched, or stamped, like BAT-6024-001, 60x24-FLAT-009, 24FLAT109, AM1234567, EX9928374, or pure numeric strings like 890123456789).
2. Battery Model or Specifications (e.g. 60x24 OLD, 60x24 FLAT, 60x30, 48x24, 72x30, 12V 100Ah, etc.) if visible on the casing or label.
3. Any Batch Number or Date Code (e.g. BATCH-2026-10, MFD 10/26).

Return ONLY valid JSON with this exact schema (no markdown fences, no explanatory text):
{
  "serialNo": "extracted serial or barcode digits, or empty string",
  "model": "extracted battery model or empty string",
  "batchNo": "extracted batch/date code or empty string",
  "confidence": "high" | "medium" | "low",
  "rawText": "short summary of label text found"
}`,
                },
                {
                  inlineData: {
                    mimeType: mimeType || 'image/jpeg',
                    data: cleanBase64,
                  },
                },
              ],
            },
          ],
        });

        const rawText = response.text?.trim() || '';
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.serialNo) {
              return res.json({ success: true, data: parsed, engine: 'gemini-3.8-flash' });
            }
          } catch {
            // Regex extraction fallback below
          }
        }

        // Regex extraction from raw text if JSON parse failed or serial was empty
        const serialMatch = rawText.match(/"serialNo"\s*:\s*"([^"]+)"/) ||
          rawText.match(/\b(BAT-[A-Z0-9-]+|[A-Z0-9]{3,8}-[A-Z0-9]{2,8}(?:-[A-Z0-9]+)?|[0-9]{8,18})\b/i);

        if (serialMatch && serialMatch[1]) {
          return res.json({
            success: true,
            data: {
              serialNo: serialMatch[1].trim(),
              model: '',
              batchNo: '',
              confidence: 'medium',
              rawText: rawText.slice(0, 150),
            },
            engine: 'gemini-3.8-flash-regex',
          });
        }
      } catch (geminiErr: any) {
        console.warn('[Server] Gemini OCR failed, falling back:', geminiErr?.message);
      }
    }

    // Fallback if no Gemini key configured or image unclear
    return res.json({
      success: true,
      data: {
        serialNo: '',
        model: '',
        batchNo: '',
        confidence: 'low',
        rawText: apiKey ? 'Barcode not clear in photo' : 'No GEMINI_API_KEY set',
      },
      engine: 'fallback',
    });
  } catch (err: any) {
    console.error('[Server] OCR scanning error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Development Mode: Mount Vite Middlewares
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production Mode (Render standalone or monorepo)
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      // Pure Backend API Mode (e.g. Render backend with Vercel frontend)
      app.get('/', (req, res) => {
        res.json({
          status: 'online',
          message: 'Battery Stock Register API Server is running on Render',
          endpoints: {
            health: '/api/health',
            records: '/api/records',
            columns: '/api/columns',
            team: '/api/team',
          },
          note: 'Connect your Vercel frontend with VITE_API_BASE_URL set to this domain',
        });
      });
    }
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[Server] Battery Register Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[Server] Production mode: ${isProduction}`);
  });
}

startServer();
