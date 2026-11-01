import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  initDb,
  getDbStatus,
  getAllRecords,
  getRecord,
  saveRecord,
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
} from './server/db.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// CORS configuration to allow Vercel frontend or any domain
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : '*';

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

// Initialize DBMS connection (PostgreSQL or persistent file)
initDb().catch((err) => {
  console.error('[Server] DBMS initialization error:', err);
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

// Stock Records CRUD
app.get('/api/records', async (req, res) => {
  try {
    const records = await getAllRecords();
    res.json({ success: true, data: records });
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
    const saved = await saveRecord(record);
    res.json({ success: true, data: saved });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/records/:date', async (req, res) => {
  try {
    const success = await deleteRecord(req.params.date);
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
    res.json({ success: true, data: saved });
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
    res.json({ success: true, data: saved });
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
    res.json({ success: true, data: saved });
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
    res.json({ success: true, data: saved });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/serials/:serialNo', async (req, res) => {
  try {
    const success = await deleteSerial(req.params.serialNo);
    res.json({ success });
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
    console.log(`[Server] Ready for Render backend and Vercel frontend deployments`);
  });
}

startServer();
