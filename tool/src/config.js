import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

loadEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function parseJsonEnv(name, fallback) {
  const payload = process.env[name];
  if (!payload) return fallback;
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(`環境變數 ${name} 不是合法 JSON：${error.message}`);
  }
}

function parsePositiveInt(rawValue, defaultValue) {
  if (!rawValue) return defaultValue;
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

const DEFAULT_OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.resolve(process.cwd(), '..');

export const CONFIG = {
  endpoint: requireEnv('KEYSTONE_URL').replace(/\/$/, ''),
  token: process.env.KEYSTONE_TOKEN ? process.env.KEYSTONE_TOKEN.trim() : '',
  batchSize: parsePositiveInt(process.env.BATCH_SIZE, 1000),
  maxRecords: parsePositiveInt(process.env.MAX_RECORDS, 10),
  outputRoot: DEFAULT_OUTPUT_DIR,
  metadataFileName: 'proposals_metadata.json',
  proposalWhere: parseJsonEnv('PROPOSAL_WHERE_JSON', {
    publishStatus: { equals: 'published' }
  }),
  srcDir: __dirname
};

if (CONFIG.maxRecords <= 0) {
  CONFIG.maxRecords = 10;
}

