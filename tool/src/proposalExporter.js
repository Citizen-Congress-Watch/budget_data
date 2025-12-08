import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { stringify } from 'csv-stringify/sync';
import { CONFIG } from './config.js';
import { graphqlRequest } from './gqlClient.js';

const CSV_COLUMNS = [
  { key: 'proposal_id', header: 'proposal_id' },
  { key: 'proposal_types', header: 'proposal_types' },
  { key: 'result', header: 'result' },
  { key: 'reduction_amount', header: 'reduction_amount' },
  { key: 'freeze_amount', header: 'freeze_amount' },
  { key: 'reason', header: 'reason' },
  { key: 'description', header: 'description' },
  { key: 'budget_image_url', header: 'budget_image_url' },
  { key: 'historical_proposals', header: 'historical_proposals' },
  { key: 'historical_parent_proposal', header: 'historical_parent_proposal' },
  { key: 'merged_proposals', header: 'merged_proposals' },
  { key: 'merged_parent_proposal', header: 'merged_parent_proposal' },
  { key: 'year', header: 'year' },
  { key: 'government_name', header: 'government_name' },
  { key: 'government_category', header: 'government_category' },
  { key: 'meetings', header: 'meetings' },
  { key: 'proposers', header: 'proposers' },
  { key: 'co_signers', header: 'co_signers' },
  { key: 'budget_id', header: 'budget_id' },
  { key: 'budget_project_name', header: 'budget_project_name' },
  { key: 'budget_project_description', header: 'budget_project_description' },
  { key: 'budget_major_category', header: 'budget_major_category' },
  { key: 'budget_medium_category', header: 'budget_medium_category' },
  { key: 'budget_minor_category', header: 'budget_minor_category' },
  { key: 'budget_amount', header: 'budget_amount' },
  { key: 'last_synced_at', header: 'last_synced_at' }
];

const PROPOSAL_TYPE_LABELS = {
  freeze: '凍結',
  reduce: '減列',
  other: '主決議'
};

const RESULT_LABELS = {
  passed: '通過',
  reserved: '保留',
  withdrawn: '撤案'
};

const PROPOSAL_BATCH_QUERY = `
  query ProposalBatch($take: Int!, $skip: Int!, $where: ProposalWhereInput) {
    proposals(orderBy: { id: asc }, take: $take, skip: $skip, where: $where) {
      id
      publishStatus
      proposalTypes
      result
      reductionAmount
      freezeAmount
      reason
      description
      budgetImageUrl
      budgetMajorCategory
      budgetMediumCategory
      budgetMinorCategory
      budgetProjectName
      budgetType
      budgetYear
      budgetAmount
      year { id year }
      government { id name category }
      meetings { id displayName }
      proposers { id name type }
      coSigners { id name type }
      budget {
        id
        projectName
        projectDescription
        majorCategory
        mediumCategory
        minorCategory
        type
        budgetAmount
        year
        budgetUrl
      }
      historicalProposals { id }
      mergedProposals { id }
      historicalParentProposals { id }
      mergedParentProposals { id }
    }
  }
`;

const PROPOSAL_COUNT_QUERY = `
  query ProposalCount($where: ProposalWhereInput) {
    proposalsCount(where: $where)
  }
`;

export async function exportProposals() {
  const lastSyncedAt = new Date().toISOString();
  const total = await fetchProposalCount();
  const targetTotal = Math.min(total, CONFIG.maxRecords);
  console.log(
    `預計匯出 ${targetTotal}/${total} 筆 proposal（batch=${CONFIG.batchSize}, limit=${CONFIG.maxRecords}）`
  );

  const buckets = new Map();
  let skip = 0;
  let processed = 0;
  let remaining = CONFIG.maxRecords;

  await mkdir(CONFIG.outputRoot, { recursive: true });

  while (remaining > 0) {
    const batch = await fetchProposalBatch(skip);
    if (!batch.length) break;

    const usableCount = Math.min(batch.length, remaining);
    const usable = batch.slice(0, usableCount);

    usable.forEach(proposal => {
      const yearValue =
        proposal.year && proposal.year.year !== undefined && proposal.year.year !== null
          ? String(proposal.year.year)
          : 'unknown';
      const bucket = ensureYearBucket(buckets, yearValue, {
        yearValue,
        yearId: proposal.year?.id || ''
      });
      bucket.rows.push(flattenProposal(proposal, lastSyncedAt));
    });

    processed += usable.length;
    remaining -= usable.length;
    skip += batch.length;
    console.log(`已處理 ${processed}/${targetTotal} 筆`);

    if (batch.length < CONFIG.batchSize) break;
  }

  if (!buckets.size) {
    console.warn('找不到任何 proposal，確認是否條件過嚴');
    return { lastSyncedAt, totalYears: 0, totalRecords: 0 };
  }

  let cumulative = 0;
  for (const [, bucket] of buckets.entries()) {
    const safeYear = bucket.yearValue || 'unknown';
    const csvContent = stringify(bucket.rows, { header: true, columns: CSV_COLUMNS });
    const csvName = `proposals_year_${safeYear}.csv`;
    await writeFile(path.join(CONFIG.outputRoot, csvName), csvContent, 'utf8');

    const jsonName = `proposals_year_${safeYear}.json`;
    const rowsForJson = bucket.rows.map(row => pruneEmptyFields(row));
    const jsonPayload = {
      generatedAt: lastSyncedAt,
      recordCount: rowsForJson.length,
      year: bucket.yearValue,
      proposals: rowsForJson
    };
    await writeFile(
      path.join(CONFIG.outputRoot, jsonName),
      JSON.stringify(jsonPayload, null, 2),
      'utf8'
    );

    const metadata = {
      year: bucket.yearValue,
      yearId: bucket.yearId,
      generatedAt: lastSyncedAt,
      recordCount: bucket.rows.length
    };
    const metadataName = `metadata_year_${safeYear}.json`;
    await writeFile(
      path.join(CONFIG.outputRoot, metadataName),
      JSON.stringify(metadata, null, 2),
      'utf8'
    );
    cumulative += bucket.rows.length;
  }

  await writeRootMetadata({
    lastSyncedAt,
    totalYears: buckets.size,
    totalRecords: cumulative,
    limitApplied: CONFIG.maxRecords
  });

  return { lastSyncedAt, totalYears: buckets.size, totalRecords: cumulative };
}

async function fetchProposalCount() {
  const data = await graphqlRequest(PROPOSAL_COUNT_QUERY, {
    where: CONFIG.proposalWhere
  });
  return data?.proposalsCount ?? 0;
}

async function fetchProposalBatch(skip) {
  const data = await graphqlRequest(PROPOSAL_BATCH_QUERY, {
    take: CONFIG.batchSize,
    skip,
    where: CONFIG.proposalWhere
  });
  return data?.proposals ?? [];
}

function ensureYearBucket(map, key, info) {
  if (!map.has(key)) {
    map.set(key, { yearValue: info.yearValue, yearId: info.yearId, rows: [] });
  }
  return map.get(key);
}

function flattenProposal(proposal, lastSyncedAt) {
  const yearValue =
    proposal.year && proposal.year.year !== undefined && proposal.year.year !== null
      ? String(proposal.year.year)
      : '';
  const row = {
    proposal_id: safeValue(proposal.id),
    proposal_types: formatProposalTypes(proposal.proposalTypes),
    result: formatResultValue(proposal.result),
    reduction_amount: normalizeNumber(proposal.reductionAmount),
    freeze_amount: normalizeNumber(proposal.freezeAmount),
    reason: safeValue(proposal.reason),
    description: safeValue(proposal.description),
    budget_image_url: safeValue(proposal.budgetImageUrl),
    historical_proposals: formatIdList(proposal.historicalProposals),
    historical_parent_proposal: formatSingleRelationId(proposal.historicalParentProposals),
    merged_proposals: formatIdList(proposal.mergedProposals),
    merged_parent_proposal: formatSingleRelationId(proposal.mergedParentProposals),
    year: yearValue,
    government_name: safeValue(proposal.government?.name),
    government_category: safeValue(proposal.government?.category),
    meetings: formatLabelList(proposal.meetings, 'displayName'),
    proposers: formatLabelList(proposal.proposers, 'name'),
    co_signers: formatLabelList(proposal.coSigners, 'name'),
    budget_id: safeValue(proposal.budget?.id),
    budget_project_name: safeValue(proposal.budget?.projectName || proposal.budgetProjectName),
    budget_project_description: safeValue(proposal.budget?.projectDescription),
    budget_major_category: safeValue(proposal.budget?.majorCategory || proposal.budgetMajorCategory),
    budget_medium_category: safeValue(proposal.budget?.mediumCategory || proposal.budgetMediumCategory),
    budget_minor_category: safeValue(proposal.budget?.minorCategory || proposal.budgetMinorCategory),
    budget_amount: normalizeNumber(proposal.budget?.budgetAmount ?? proposal.budgetAmount),
    last_synced_at: lastSyncedAt
  };
  return row;
}

function formatProposalTypes(types) {
  if (!Array.isArray(types) || !types.length) return '';
  return types
    .map(type => PROPOSAL_TYPE_LABELS[type] || type)
    .filter(Boolean)
    .join('、');
}

function formatResultValue(value) {
  if (!value) return '';
  return RESULT_LABELS[value] || value;
}

function formatLabelList(nodes, labelKey = 'name') {
  if (!nodes || !nodes.length) return '';
  return nodes
    .map(node => node?.[labelKey])
    .filter(label => typeof label === 'string' && label.trim() !== '')
    .join('|');
}

function formatIdList(nodes) {
  if (!nodes || !nodes.length) return '';
  return nodes.map(node => node.id || '').join('|');
}

function safeValue(value) {
  if (value === undefined || value === null) return '';
  return value;
}

function formatSingleRelationId(node) {
  if (!node) return '';
  if (Array.isArray(node)) {
    const first = node.find(item => item && item.id);
    return first ? first.id : '';
  }
  return node.id || '';
}

function pruneEmptyFields(row) {
  const { last_synced_at, ...rest } = row;
  const result = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== '' && value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result;
}

function normalizeNumber(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

async function writeRootMetadata({ lastSyncedAt, totalYears, totalRecords, limitApplied }) {
  await mkdir(CONFIG.outputRoot, { recursive: true });
  const payload = {
    generatedAt: lastSyncedAt,
    totalYears,
    totalRecords,
    maxRecords: limitApplied,
    batchSize: CONFIG.batchSize,
    where: CONFIG.proposalWhere
  };
  await writeFile(
    path.join(CONFIG.outputRoot, CONFIG.metadataFileName),
    JSON.stringify(payload, null, 2),
    'utf8'
  );
}

