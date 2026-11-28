import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
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
  getResetDateIST,
  factoryResetAllData,
  getAdminConfigStatus,
  claimFirstRunAdminPassword,
  verifyAdminPassword,
  changeClaimedAdminPassword,
  getBackendAnalyticsSnapshot,
  verifyBranchLoginPassword,
  getBranchCredentialsSummary,
  getBranchCredentialMeta,
  updateBranchLoginPassword,
  bulkUpdateBranchLoginPasswords,
  createBranchLoginUser,
  updateBranchUserPermissions,
  deleteBranchLoginUser,
} from './server/db.ts';
import {
  ALL_STOCK_CATEGORIES,
  BRANCHES,
  DEFAULT_BRANCH_ID,
  parseBatteryRecordKey,
  type StockCategoryId,
} from './src/types/stock.ts';
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

// Admin Session Signing Secret (ephemeral fallback if ADMIN_SESSION_SECRET is unset)
const ADMIN_SIGNING_SECRET =
  (process.env.ADMIN_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const revokedTokenJtis = new Set<string>();

interface AdminTokenClaims {
  jti: string;
  sub: string;
  role: 'admin';
  mode: 'env' | 'claimed';
  iat: number;
  exp: number;
}

function createAdminToken(sub: string, mode: 'env' | 'claimed'): { token: string; exp: number } {
  const iat = Date.now();
  const exp = iat + ADMIN_TOKEN_TTL_MS;
  const payload: AdminTokenClaims = {
    jti: crypto.randomBytes(16).toString('hex'),
    sub,
    role: 'admin',
    mode,
    iat,
    exp,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(payloadB64)
    .digest('base64url');
  return { token: `${payloadB64}.${sig}`, exp };
}

function verifyAdminToken(token?: string): AdminTokenClaims | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const bufA = Buffer.from(sigB64, 'utf-8');
  const bufB = Buffer.from(expectedSig, 'utf-8');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as AdminTokenClaims;
    if (!claims || claims.role !== 'admin' || !claims.exp || claims.exp < Date.now()) {
      return null;
    }
    if (claims.jti && revokedTokenJtis.has(claims.jti)) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

function extractBearerToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return undefined;
}

function requireAdmin(
  req: express.Request & { admin?: AdminTokenClaims },
  res: express.Response,
  next: express.NextFunction
) {
  const token = extractBearerToken(req);
  const claims = verifyAdminToken(token);
  if (!claims) {
    return res.status(401).json({
      success: false,
      error: 'Admin authentication required',
    });
  }
  req.admin = claims;
  next();
}

// Branch & Master Access Session Tokens
const BRANCH_SIGNING_SECRET =
  (process.env.BRANCH_SESSION_SECRET || '').trim() || ADMIN_SIGNING_SECRET;
const BRANCH_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const revokedBranchJtis = new Set<string>();

interface BranchTokenClaims {
  jti: string;
  loginId: string;
  role: 'branch' | 'master';
  branchId: string | null;
  allowedBranchIds: string[];
  allowedCategories?: StockCategoryId[];
  label: string;
  credVersion: number;
  iat: number;
  exp: number;
}

export interface BranchAccessContext {
  loginId: string;
  role: 'branch' | 'master';
  branchId: string | null;
  allowedBranchIds: string[];
  allowedCategories: StockCategoryId[];
  label: string;
}

function createBranchToken(
  payload: Omit<BranchTokenClaims, 'jti' | 'iat' | 'exp'>
): { token: string; exp: number } {
  const iat = Date.now();
  const exp = iat + BRANCH_TOKEN_TTL_MS;
  const fullClaims: BranchTokenClaims = {
    jti: crypto.randomBytes(16).toString('hex'),
    ...payload,
    iat,
    exp,
  };
  const payloadB64 = Buffer.from(JSON.stringify(fullClaims), 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', BRANCH_SIGNING_SECRET)
    .update(payloadB64)
    .digest('base64url');
  return { token: `${payloadB64}.${sig}`, exp };
}

async function verifyBranchTokenAsync(token?: string): Promise<BranchTokenClaims | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', BRANCH_SIGNING_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const bufA = Buffer.from(sigB64, 'utf-8');
  const bufB = Buffer.from(expectedSig, 'utf-8');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const claims = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
    ) as BranchTokenClaims;
    if (!claims || !claims.loginId || !Array.isArray(claims.allowedBranchIds) || !claims.exp || claims.exp < Date.now()) {
      return null;
    }
    if (claims.jti && revokedBranchJtis.has(claims.jti)) {
      return null;
    }
    const meta = await getBranchCredentialMeta(claims.loginId);
    if (!meta.active || !meta.account) {
      return null;
    }
    if (Number(claims.credVersion || 0) < meta.version) {
      return null;
    }
    return {
      ...claims,
      role: meta.account.role,
      branchId: meta.account.branchId,
      allowedBranchIds: meta.account.allowedBranchIds,
      allowedCategories: meta.account.allowedCategories,
      label: meta.account.label,
    };
  } catch {
    return null;
  }
}

async function resolveBranchAccessFromToken(token?: string): Promise<BranchAccessContext | null> {
  if (!token) return null;
  const branchClaims = await verifyBranchTokenAsync(token);
  if (branchClaims) {
    return {
      loginId: branchClaims.loginId,
      role: branchClaims.role,
      branchId: branchClaims.branchId,
      allowedBranchIds: branchClaims.allowedBranchIds,
      allowedCategories: branchClaims.allowedCategories || [...ALL_STOCK_CATEGORIES],
      label: branchClaims.label,
    };
  }
  const adminClaims = verifyAdminToken(token);
  if (adminClaims) {
    return {
      loginId: 'administrator',
      role: 'master',
      branchId: null,
      allowedBranchIds: BRANCHES.map((b) => b.id),
      allowedCategories: [...ALL_STOCK_CATEGORIES],
      label: adminClaims.sub || 'Admin Master',
    };
  }
  return null;
}

async function requireBranchAccess(
  req: express.Request & { branchAccess?: BranchAccessContext },
  res: express.Response,
  next: express.NextFunction
) {
  const token = extractBearerToken(req);
  const access = await resolveBranchAccessFromToken(token);
  if (!access) {
    return res.status(401).json({
      success: false,
      branchAuthRequired: true,
      error: 'Branch or master login required',
    });
  }
  req.branchAccess = access;
  next();
}

function isBranchAllowed(access: BranchAccessContext | undefined, branchId?: string | null): boolean {
  if (!access) return false;
  if (access.role === 'master') return true;
  const target = branchId && branchId.trim() ? branchId.trim() : DEFAULT_BRANCH_ID;
  return access.allowedBranchIds.includes(target);
}

function isCategoryAllowed(access: BranchAccessContext | undefined, category?: StockCategoryId | string | null): boolean {
  if (!access) return false;
  if (access.role === 'master') return true;
  const target: StockCategoryId =
    category === 'charger' || category === 'vehicle' ? category : 'battery';
  return (access.allowedCategories || ALL_STOCK_CATEGORIES).includes(target);
}

function requireBranchCategory(category: StockCategoryId) {
  return (
    req: express.Request & { branchAccess?: BranchAccessContext },
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (!isCategoryAllowed(req.branchAccess, category)) {
      return res.status(403).json({
        success: false,
        error: `Access denied: your account does not have permission for ${category} stock.`,
      });
    }
    next();
  };
}

// Real-Time Server-Sent Events (SSE) Hub
interface RealtimeClient {
  id: string;
  res: express.Response;
  allowedBranchIds: string[];
  allowedCategories: StockCategoryId[];
}
const realtimeClients: RealtimeClient[] = [];

function getEventCategory(event: string): StockCategoryId | null {
  if (
    event === 'RECORD_UPDATED' ||
    event === 'RECORD_DELETED' ||
    event === 'COLUMNS_UPDATED' ||
    event === 'SERIAL_UPDATED' ||
    event === 'SERIALS_BULK_UPDATED' ||
    event === 'SERIAL_DELETED'
  ) {
    return 'battery';
  }
  if (event === 'CHARGER_UPDATED') return 'charger';
  if (event === 'VEHICLE_UPDATED') return 'vehicle';
  return null;
}

function broadcastRealtime(event: string, payload: any, targetBranchIds?: string[]) {
  const timestamp = new Date().toISOString();
  const eventCategory = getEventCategory(event);
  for (let i = realtimeClients.length - 1; i >= 0; i--) {
    const client = realtimeClients[i];
    if (eventCategory && !client.allowedCategories.includes(eventCategory)) {
      continue;
    }
    if (
      targetBranchIds &&
      targetBranchIds.length > 0 &&
      !targetBranchIds.some((b) => client.allowedBranchIds.includes(b))
    ) {
      continue;
    }

    let scopedPayload = payload;
    if (event === 'TRANSFERS_UPDATED' && Array.isArray(payload)) {
      scopedPayload = payload.filter(
        (t: any) =>
          (client.allowedBranchIds.includes(t?.fromBranchId) ||
            client.allowedBranchIds.includes(t?.toBranchId)) &&
          client.allowedCategories.includes(
            t?.category === 'charger' || t?.category === 'vehicle' ? t.category : 'battery'
          )
      );
    } else if (event === 'SERIALS_BULK_UPDATED' && Array.isArray(payload)) {
      scopedPayload = payload.filter((s: any) =>
        client.allowedBranchIds.includes(s?.branchId || DEFAULT_BRANCH_ID)
      );
      if (scopedPayload.length === 0) continue;
    }

    const message = `data: ${JSON.stringify({ event, payload: scopedPayload, timestamp })}\n\n`;
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

// Real-Time SSE Stream Endpoint (branch-scoped)
app.get('/api/realtime', async (req, res) => {
  const queryToken =
    typeof req.query.branchToken === 'string' ? req.query.branchToken.trim() : undefined;
  const token = extractBearerToken(req) || queryToken;
  const access = await resolveBranchAccessFromToken(token);
  if (!access) {
    return res.status(401).json({ success: false, error: 'Authentication required for live stream' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const client: RealtimeClient = {
    id: clientId,
    res,
    allowedBranchIds: access.allowedBranchIds,
    allowedCategories: access.allowedCategories,
  };
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

// =========================================================================
// Admin Authentication & Backend Data Analysis Routes
// =========================================================================

app.get('/api/admin/status', async (req, res) => {
  try {
    const configStatus = await getAdminConfigStatus();
    const token = extractBearerToken(req);
    const claims = verifyAdminToken(token);
    res.json({
      success: true,
      configuredViaEnv: configStatus.configuredViaEnv,
      claimed: configStatus.claimed,
      authenticated: Boolean(claims),
      admin: claims
        ? {
            label: claims.sub,
            role: 'Admin',
            mode: claims.mode,
            expiresAt: new Date(claims.exp).toISOString(),
          }
        : null,
      adminLabel: configStatus.adminLabel,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/claim', async (req, res) => {
  try {
    const { password, adminLabel } = req.body || {};
    const status = await getAdminConfigStatus();
    if (status.configuredViaEnv || status.claimed) {
      return res.status(403).json({
        success: false,
        error: 'Admin password is already configured. Please sign in instead.',
      });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Admin password must be at least 8 characters long.',
      });
    }

    const claimed = await claimFirstRunAdminPassword(password, adminLabel);
    const { token, exp } = createAdminToken(claimed.adminLabel, 'claimed');
    res.json({
      success: true,
      token,
      expiresAt: new Date(exp).toISOString(),
      admin: {
        label: claimed.adminLabel,
        role: 'Admin',
        mode: 'claimed',
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Claim failed' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { password, silent } = req.body || {};
    const status = await getAdminConfigStatus();
    if (!status.configuredViaEnv && !status.claimed) {
      return res.status(409).json({
        success: false,
        needsClaim: true,
        error: 'Admin password has not been set up yet. Complete first-run Admin setup first.',
      });
    }

    const verification = await verifyAdminPassword(typeof password === 'string' ? password : '');
    if (!verification.valid) {
      if (!silent) {
        await logAudit('ADMIN_LOGIN_FAILED', {
          timestamp: new Date().toISOString(),
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid admin password.',
      });
    }

    const mode: 'env' | 'claimed' = verification.mode === 'env' ? 'env' : 'claimed';
    const { token, exp } = createAdminToken(verification.adminLabel, mode);
    await logAudit('ADMIN_LOGIN_SUCCESS', {
      mode,
      adminLabel: verification.adminLabel,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      token,
      expiresAt: new Date(exp).toISOString(),
      admin: {
        label: verification.adminLabel,
        role: 'Admin',
        mode,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/logout', requireAdmin, async (req: express.Request & { admin?: AdminTokenClaims }, res) => {
  if (req.admin?.jti) {
    revokedTokenJtis.add(req.admin.jti);
    if (revokedTokenJtis.size > 1000) {
      const oldest = revokedTokenJtis.values().next().value;
      if (oldest) revokedTokenJtis.delete(oldest);
    }
  }
  await logAudit('ADMIN_LOGOUT', { timestamp: new Date().toISOString() });
  res.json({ success: true });
});

app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    await changeClaimedAdminPassword(currentPassword, newPassword);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
  try {
    const snapshot = await getBackendAnalyticsSnapshot();
    res.json({
      success: true,
      data: snapshot,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// Branch & Master Access Authentication + Password Manager Routes
// =========================================================================

app.post('/api/auth/branch-login', async (req, res) => {
  try {
    const { loginId, password } = req.body || {};
    if (typeof loginId !== 'string' || !loginId.trim() || typeof password !== 'string' || !password) {
      return res.status(400).json({
        success: false,
        error: 'Login ID and password are required.',
      });
    }

    const result = await verifyBranchLoginPassword(loginId, password);
    if (!result.valid || !result.account) {
      await logAudit('BRANCH_LOGIN_FAILED', {
        loginId: loginId.trim().toLowerCase(),
        timestamp: new Date().toISOString(),
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid Login ID or password.',
      });
    }

    const { token, exp } = createBranchToken({
      loginId: result.account.loginId,
      role: result.account.role,
      branchId: result.account.branchId,
      allowedBranchIds: result.account.allowedBranchIds,
      allowedCategories: result.account.allowedCategories,
      label: result.account.label,
      credVersion: result.version || 1,
    });

    await logAudit('BRANCH_LOGIN_SUCCESS', {
      loginId: result.account.loginId,
      role: result.account.role,
      branchId: result.account.branchId,
      allowedCategories: result.account.allowedCategories,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      token,
      session: {
        loginId: result.account.loginId,
        role: result.account.role,
        branchId: result.account.branchId,
        allowedBranchIds: result.account.allowedBranchIds,
        allowedCategories: result.account.allowedCategories,
        label: result.account.label,
        expiresAt: new Date(exp).toISOString(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/branch-session', async (req, res) => {
  try {
    const token = extractBearerToken(req);
    const claims = await verifyBranchTokenAsync(token);
    if (!claims) {
      return res.json({ success: true, authenticated: false, session: null });
    }
    res.json({
      success: true,
      authenticated: true,
      session: {
        loginId: claims.loginId,
        role: claims.role,
        branchId: claims.branchId,
        allowedBranchIds: claims.allowedBranchIds,
        allowedCategories: claims.allowedCategories || [...ALL_STOCK_CATEGORIES],
        label: claims.label,
        expiresAt: new Date(claims.exp).toISOString(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/branch-logout', async (req, res) => {
  const token = extractBearerToken(req);
  const claims = await verifyBranchTokenAsync(token);
  if (claims?.jti) {
    revokedBranchJtis.add(claims.jti);
    if (revokedBranchJtis.size > 2000) {
      const oldest = revokedBranchJtis.values().next().value;
      if (oldest) revokedBranchJtis.delete(oldest);
    }
  }
  res.json({ success: true });
});

app.get('/api/admin/branch-credentials', requireAdmin, async (req, res) => {
  try {
    const data = await getBranchCredentialsSummary();
    res.json({ success: true, ...data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/branch-credentials/update', requireAdmin, async (req, res) => {
  try {
    const { loginId, newPassword } = req.body || {};
    const result = await updateBranchLoginPassword(loginId, newPassword);
    broadcastRealtime('BRANCH_CREDENTIALS_UPDATED', {
      loginId: result.summary.loginId,
      version: result.summary.version,
      reason: 'password',
    });
    res.json({
      success: true,
      credential: result.summary,
      githubSync: result.githubSync,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/branch-credentials/bulk-update', requireAdmin, async (req, res) => {
  try {
    const { updates } = req.body || {};
    const result = await bulkUpdateBranchLoginPasswords(updates);
    result.updatedIds.forEach((id) => {
      const summary = result.credentials.find((c) => c.loginId === id);
      broadcastRealtime('BRANCH_CREDENTIALS_UPDATED', {
        loginId: id,
        version: summary?.version || 1,
        reason: 'password',
      });
    });
    res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/branch-credentials/create', requireAdmin, async (req, res) => {
  try {
    const { loginId, branchId, label, password, allowedCategories } = req.body || {};
    const result = await createBranchLoginUser({
      loginId,
      branchId,
      label,
      password,
      allowedCategories,
    });
    broadcastRealtime('BRANCH_CREDENTIALS_UPDATED', {
      loginId: result.summary.loginId,
      version: result.summary.version,
      reason: 'created',
    });
    res.json({
      success: true,
      credential: result.summary,
      githubSync: result.githubSync,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/branch-credentials/permissions', requireAdmin, async (req, res) => {
  try {
    const { loginId, allowedCategories, label } = req.body || {};
    const result = await updateBranchUserPermissions({
      loginId,
      allowedCategories,
      label,
    });
    broadcastRealtime('BRANCH_CREDENTIALS_UPDATED', {
      loginId: result.summary.loginId,
      version: result.summary.version,
      reason: 'permissions',
    });
    res.json({
      success: true,
      credential: result.summary,
      githubSync: result.githubSync,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/branch-credentials/:loginId', requireAdmin, async (req, res) => {
  try {
    const result = await deleteBranchLoginUser(req.params.loginId);
    broadcastRealtime('BRANCH_CREDENTIALS_UPDATED', {
      loginId: req.params.loginId.trim().toLowerCase(),
      version: 999999,
      reason: 'deleted',
    });
    res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Stock Records CRUD (Branch-Scoped & Category-Scoped)
app.get('/api/records', requireBranchAccess, requireBranchCategory('battery'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const records = await getAllRecords();
    const scoped: Record<string, any> = {};
    Object.entries(records).forEach(([key, rec]) => {
      const bId = rec?.branchId || parseBatteryRecordKey(key).branchId || DEFAULT_BRANCH_ID;
      if (isBranchAllowed(req.branchAccess, bId)) {
        scoped[key] = rec;
      }
    });
    res.json({
      success: true,
      data: scoped,
      resetEpoch: getResetEpoch(),
      resetDateIST: getResetDateIST(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/records/:date', requireBranchAccess, requireBranchCategory('battery'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const requestedBranch = parseBatteryRecordKey(req.params.date).branchId;
    if (!isBranchAllowed(req.branchAccess, requestedBranch)) {
      return res.status(403).json({ success: false, error: 'Access denied for this branch' });
    }
    const record = await getRecord(req.params.date);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    res.json({ success: true, data: record });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/records', requireBranchAccess, requireBranchCategory('battery'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const record = req.body;
    if (!record || !record.date) {
      return res.status(400).json({ success: false, error: 'Date is required' });
    }
    const targetBranch = record.branchId || DEFAULT_BRANCH_ID;
    if (!isBranchAllowed(req.branchAccess, targetBranch)) {
      return res.status(403).json({ success: false, error: 'Access denied for this branch' });
    }
    const result = await saveRecordWithStatus(record);
    const storage = getActiveStorageTarget();
    broadcastRealtime('RECORD_UPDATED', result.record, [targetBranch]);
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

app.delete('/api/records/:date', requireBranchAccess, requireBranchCategory('battery'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const targetBranch = parseBatteryRecordKey(req.params.date).branchId;
    if (!isBranchAllowed(req.branchAccess, targetBranch)) {
      return res.status(403).json({ success: false, error: 'Access denied for this branch' });
    }
    const success = await deleteRecord(req.params.date);
    if (success) {
      broadcastRealtime('RECORD_DELETED', { date: req.params.date }, [targetBranch]);
    }
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Battery Columns
app.get('/api/columns', requireBranchAccess, async (req, res) => {
  try {
    const columns = await getColumns();
    res.json({ success: true, data: columns });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/columns', requireBranchAccess, requireBranchCategory('battery'), async (req, res) => {
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
app.get('/api/team', requireBranchAccess, async (req, res) => {
  try {
    const team = await getTeamMembers();
    res.json({ success: true, data: team });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/team', requireBranchAccess, async (req, res) => {
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

// Battery Serial & Batch Tracker Routes (Branch-Scoped & Category-Scoped)
app.get('/api/serials', requireBranchAccess, requireBranchCategory('battery'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const serials = await getAllSerials();
    const scoped: Record<string, any> = {};
    Object.entries(serials).forEach(([k, item]) => {
      const bId = item?.branchId || DEFAULT_BRANCH_ID;
      if (isBranchAllowed(req.branchAccess, bId)) {
        scoped[k] = item;
      }
    });
    res.json({
      success: true,
      data: scoped,
      resetEpoch: getResetEpoch(),
      resetDateIST: getResetDateIST(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/serials/:serialNo', requireBranchAccess, requireBranchCategory('battery'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const item = await getSerial(req.params.serialNo);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Serial not found' });
    }
    if (!isBranchAllowed(req.branchAccess, item.branchId || DEFAULT_BRANCH_ID)) {
      return res.status(403).json({ success: false, error: 'Access denied for this branch serial' });
    }
    res.json({ success: true, data: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/serials', requireBranchAccess, requireBranchCategory('battery'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const item = req.body;
    if (!item || !item.serialNo) {
      return res.status(400).json({ success: false, error: 'serialNo is required' });
    }
    const targetBranch = item.branchId || DEFAULT_BRANCH_ID;
    if (!isBranchAllowed(req.branchAccess, targetBranch)) {
      return res.status(403).json({ success: false, error: 'Access denied for this branch' });
    }
    const saved = await saveSerial(item);
    const storage = getActiveStorageTarget();
    broadcastRealtime('SERIAL_UPDATED', saved, [targetBranch]);
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

app.post('/api/serials/bulk', requireBranchAccess, requireBranchCategory('battery'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Items must be an array' });
    }
    const targetBranches = new Set<string>();
    for (const item of items) {
      const bId = item?.branchId || DEFAULT_BRANCH_ID;
      if (!isBranchAllowed(req.branchAccess, bId)) {
        return res.status(403).json({ success: false, error: `Access denied for branch ${bId}` });
      }
      targetBranches.add(bId);
    }
    const saved = await bulkSaveSerials(items);
    const storage = getActiveStorageTarget();
    broadcastRealtime('SERIALS_BULK_UPDATED', saved, Array.from(targetBranches));
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

app.delete('/api/serials/:serialNo', requireBranchAccess, requireBranchCategory('battery'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const existing = await getSerial(req.params.serialNo);
    const bId = existing?.branchId || DEFAULT_BRANCH_ID;
    if (existing && !isBranchAllowed(req.branchAccess, bId)) {
      return res.status(403).json({ success: false, error: 'Access denied for this branch serial' });
    }
    const success = await deleteSerial(req.params.serialNo);
    if (success) {
      broadcastRealtime('SERIAL_DELETED', { serialNo: req.params.serialNo }, [bId]);
    }
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Charger Stock Register Routes (Branch-Scoped & Category-Scoped)
app.get('/api/chargers', requireBranchAccess, requireBranchCategory('charger'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const chargers = await getChargerRecords();
    const scoped: Record<string, any> = {};
    Object.entries(chargers || {}).forEach(([k, val]: [string, any]) => {
      const bId = val?.branchId || parseBatteryRecordKey(k).branchId || DEFAULT_BRANCH_ID;
      if (isBranchAllowed(req.branchAccess, bId)) {
        scoped[k] = val;
      }
    });
    res.json({ success: true, data: scoped });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chargers', requireBranchAccess, requireBranchCategory('charger'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const { branchId, date, record } = req.body || {};
    if (!branchId || !date || !record) {
      return res.status(400).json({ success: false, error: 'branchId, date, and record are required' });
    }
    if (!isBranchAllowed(req.branchAccess, branchId)) {
      return res.status(403).json({ success: false, error: 'Access denied for this branch' });
    }
    const saved = await saveChargerRecord(branchId, date, record);
    const storage = getActiveStorageTarget();
    broadcastRealtime('CHARGER_UPDATED', saved, [branchId]);
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

// Vehicle Stock Register Routes (Branch-Scoped & Category-Scoped)
app.get('/api/vehicles', requireBranchAccess, requireBranchCategory('vehicle'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const vehicles = await getVehicleRecords();
    const scoped: Record<string, any> = {};
    Object.entries(vehicles || {}).forEach(([k, val]: [string, any]) => {
      const bId = val?.branchId || parseBatteryRecordKey(k).branchId || DEFAULT_BRANCH_ID;
      if (isBranchAllowed(req.branchAccess, bId)) {
        scoped[k] = val;
      }
    });
    res.json({ success: true, data: scoped });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/vehicles', requireBranchAccess, requireBranchCategory('vehicle'), async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const { branchId, date, record } = req.body || {};
    if (!branchId || !date || !record) {
      return res.status(400).json({ success: false, error: 'branchId, date, and record are required' });
    }
    if (!isBranchAllowed(req.branchAccess, branchId)) {
      return res.status(403).json({ success: false, error: 'Access denied for this branch' });
    }
    const saved = await saveVehicleRecord(branchId, date, record);
    const storage = getActiveStorageTarget();
    broadcastRealtime('VEHICLE_UPDATED', saved, [branchId]);
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

// Inter-Branch Stock Transfers & Receive Goods Notifications (Branch-Scoped & Category-Scoped)
app.get('/api/transfers', requireBranchAccess, async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const transfers = await getBranchTransfers();
    const scoped = transfers.filter(
      (t) =>
        (isBranchAllowed(req.branchAccess, t.fromBranchId) ||
          isBranchAllowed(req.branchAccess, t.toBranchId)) &&
        isCategoryAllowed(req.branchAccess, t.category || 'battery')
    );
    res.json({ success: true, data: scoped });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/transfers', requireBranchAccess, async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const body = req.body || {};
    if (!body.fromBranchId || !body.toBranchId || !body.date || !Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'fromBranchId, toBranchId, date, and non-empty items array are required',
      });
    }
    if (!isBranchAllowed(req.branchAccess, body.fromBranchId)) {
      return res.status(403).json({ success: false, error: 'Access denied for sending from this branch' });
    }
    const transferCategory = body.category || 'battery';
    if (!isCategoryAllowed(req.branchAccess, transferCategory)) {
      return res.status(403).json({ success: false, error: `Access denied: your account cannot send ${transferCategory} stock transfers` });
    }
    const result = await createBranchTransfer(body);
    const storage = getActiveStorageTarget();
    broadcastRealtime('TRANSFERS_UPDATED', result.transfers, [body.fromBranchId, body.toBranchId]);
    res.json({
      success: true,
      data: result.created,
      transfers: result.transfers.filter(
        (t) =>
          (isBranchAllowed(req.branchAccess, t.fromBranchId) ||
            isBranchAllowed(req.branchAccess, t.toBranchId)) &&
          isCategoryAllowed(req.branchAccess, t.category || 'battery')
      ),
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/transfers/receive', requireBranchAccess, async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const { selections, receivedBy } = req.body || {};
    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ success: false, error: 'selections array is required' });
    }
    const existingTransfers = await getBranchTransfers();
    for (const sel of selections) {
      const trf = existingTransfers.find((t) => t.id === sel.transferId);
      if (trf && !isBranchAllowed(req.branchAccess, trf.toBranchId)) {
        return res.status(403).json({ success: false, error: 'Only the receiving branch or master can accept this transfer' });
      }
      if (trf && !isCategoryAllowed(req.branchAccess, trf.category || 'battery')) {
        return res.status(403).json({ success: false, error: `Access denied for receiving ${trf.category || 'battery'} stock` });
      }
    }
    const result = await receiveBranchTransfers(selections, receivedBy);
    const storage = getActiveStorageTarget();
    const affectedBranches = Array.from(
      new Set(
        result.newlyReceived.flatMap((n) => [n.transfer.fromBranchId, n.transfer.toBranchId])
      )
    );
    broadcastRealtime('TRANSFERS_UPDATED', result.transfers, affectedBranches);
    res.json({
      success: true,
      data: result.transfers.filter(
        (t) =>
          (isBranchAllowed(req.branchAccess, t.fromBranchId) ||
            isBranchAllowed(req.branchAccess, t.toBranchId)) &&
          isCategoryAllowed(req.branchAccess, t.category || 'battery')
      ),
      newlyReceived: result.newlyReceived,
      storage,
      persistedToRemote: storage !== 'local_file',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/transfers/:id', requireBranchAccess, async (req: express.Request & { branchAccess?: BranchAccessContext }, res) => {
  try {
    const existing = await getBranchTransfers();
    const target = existing.find((t) => t.id === req.params.id);
    if (
      target &&
      ((!isBranchAllowed(req.branchAccess, target.fromBranchId) &&
        !isBranchAllowed(req.branchAccess, target.toBranchId)) ||
        !isCategoryAllowed(req.branchAccess, target.category || 'battery'))
    ) {
      return res.status(403).json({ success: false, error: 'Access denied for this transfer' });
    }
    const transfers = await deleteBranchTransfer(req.params.id);
    if (target) {
      broadcastRealtime('TRANSFERS_UPDATED', transfers, [target.fromBranchId, target.toBranchId]);
    }
    res.json({ success: true, data: transfers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Permanent Codebase & Disk + Cloud Space Backup Sync (Admin Only)
app.post('/api/backup-permanent', requireAdmin, async (req, res) => {
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

app.get('/api/cloud/cloudinary/backups', requireAdmin, async (req, res) => {
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

app.post('/api/cloud/cloudinary/backup', requireAdmin, async (req, res) => {
  try {
    const { records, serials, reason } = req.body || {};
    const result = await triggerCloudSpaceBackupNow(
      records,
      serials,
      typeof reason === 'string' && reason.trim() ? reason.trim() : 'manual_ui',
      { archiveVersioned: true }
    );
    await logAudit('ADMIN_CLOUD_BACKUP', {
      reason: typeof reason === 'string' ? reason : 'manual_ui',
      uploadedToCloudinary: result.uploadedToCloudinary,
      timestamp: new Date().toISOString(),
    });
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

app.post('/api/cloud/cloudinary/restore', requireAdmin, async (req, res) => {
  try {
    const { source, secureUrl, fileName } = req.body || {};
    if (source !== 'cloudinary' && source !== 'local_disk') {
      return res.status(400).json({ success: false, error: 'Valid source (cloudinary or local_disk) is required' });
    }
    const snapshot = await readCloudSpaceSnapshot({ source, secureUrl, fileName });
    const restored = await restoreFullDatabaseSnapshot(snapshot);
    await logAudit('ADMIN_SNAPSHOT_RESTORE', {
      source,
      fileName: fileName || 'snapshot',
      restoredRecords: restored.restoredRecords,
      restoredSerials: restored.restoredSerials,
      timestamp: new Date().toISOString(),
    });
    broadcastRealtime('PERMANENT_SYNC_COMPLETE', restored);
    res.json({
      ...restored,
      source,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Factory Reset All Stock Data, Serials, Transfers, History & Cloud Space (Admin Only)
app.post('/api/system/factory-reset', requireAdmin, async (req, res) => {
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

app.get('/api/cloud/snapshot/export', requireAdmin, async (req, res) => {
  try {
    const snapshot = await exportFullDatabaseSnapshot('download');
    await logAudit('ADMIN_SNAPSHOT_EXPORT', { timestamp: new Date().toISOString() });
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

app.get('/api/cloud/excel/export', requireAdmin, async (req, res) => {
  try {
    const excelBuffer = await exportFullDatabaseExcelBuffer();
    await logAudit('ADMIN_EXCEL_QUANTITY_EXPORT', { timestamp: new Date().toISOString() });
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

app.get('/api/cloud/excel/serials/export', requireAdmin, async (req, res) => {
  try {
    const excelBuffer = await exportFullSerialHistoryExcelBuffer();
    await logAudit('ADMIN_EXCEL_SERIALS_EXPORT', { timestamp: new Date().toISOString() });
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
app.post('/api/whatsapp/dispatch', requireBranchAccess, requireBranchCategory('battery'), async (req, res) => {
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
app.post('/api/scan-barcode-ocr', requireBranchAccess, requireBranchCategory('battery'), async (req, res) => {
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
