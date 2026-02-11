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
  { key: 'frozen_status', header: 'frozen_status' },
  { key: 'frozen_history', header: 'frozen_history' },
  { key: 'frozen_report', header: 'frozen_report' },
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

const FROZEN_STATUS_LABELS = {
  unfrozen: '已解凍',
  not_reviewed: '尚未審議',
  reviewing: '審議中'
};

const PROPOSAL_BATCH_QUERY = `
  query ProposalBatch($take: Int!, $skip: Int!, $where: ProposalWhereInput) {
    proposals(orderBy: { id: asc }, take: $take, skip: $skip, where: $where) {
      id
      proposalTypes
      result
      reductionAmount
      freezeAmount
      reason
      description
      unfreezeStatus
      unfreezeReport
      unfreezeHistory { id displayName }
      budgetImageUrl
      year { id year }
      government { id name category }
      meetings { id displayName }
      proposers { id name }
      coSigners { id name }
      historicalProposals { id }
      mergedProposals { id }
      historicalParentProposals { id }
      mergedParentProposals { id }
      budget {
        id
        projectName
        projectDescription
        majorCategory
        mediumCategory
        minorCategory
        budgetAmount
        budgetUrl
      }
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
    console.warn('找不到任何 proposal，請確認 where 條件是否過嚴');
    return { lastSyncedAt, totalYears: 0, totalRecords: 0 };
  }

  let cumulative = 0;
  for (const [, bucket] of buckets.entries()) {
    const safeYear = bucket.yearValue || 'unknown';
    const csvContent = stringify(bucket.rows, { header: true, columns: CSV_COLUMNS });
    await writeFile(
      path.join(CONFIG.outputRoot, `proposals_year_${safeYear}.csv`),
      csvContent,
      'utf8'
    );

    const jsonPayload = {
      generatedAt: lastSyncedAt,
      recordCount: bucket.rows.length,
      year: bucket.yearValue,
      proposals: bucket.rows.map(row => pruneEmptyFields(row))
    };
    await writeFile(
      path.join(CONFIG.outputRoot, `proposals_year_${safeYear}.json`),
      JSON.stringify(jsonPayload, null, 2),
      'utf8'
    );

    const metadata = {
      year: bucket.yearValue,
      yearId: bucket.yearId,
      generatedAt: lastSyncedAt,
      recordCount: bucket.rows.length
    };
    await writeFile(
      path.join(CONFIG.outputRoot, `metadata_year_${safeYear}.json`),
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

function ensureYearBucket(map, yearKey, info) {
  if (!map.has(yearKey)) {
    map.set(yearKey, { yearValue: info.yearValue, yearId: info.yearId, rows: [] });
  }
  return map.get(yearKey);
}

function flattenProposal(proposal, lastSyncedAt) {
  const row = {
    proposal_id: safeString(proposal.id),
    proposal_types: formatProposalTypes(proposal.proposalTypes),
    result: formatResultValue(proposal.result),
    reduction_amount: normalizeNumber(proposal.reductionAmount),
    freeze_amount: normalizeNumber(proposal.freezeAmount),
    reason: safeString(proposal.reason),
    description: safeString(proposal.description),
    frozen_status: formatFrozenStatus(proposal.unfreezeStatus),
    frozen_history: formatLabelList(proposal.unfreezeHistory, 'displayName'),
    frozen_report: safeString(proposal.unfreezeReport),
    budget_image_url: safeString(proposal.budget?.budgetUrl || proposal.budgetImageUrl),
    historical_proposals: formatIdList(proposal.historicalProposals),
    historical_parent_proposal: formatSingleRelationId(proposal.historicalParentProposals),
    merged_proposals: formatIdList(proposal.mergedProposals),
    merged_parent_proposal: formatSingleRelationId(proposal.mergedParentProposals),
    year: formatYear(proposal.year),
    government_name: safeString(proposal.government?.name),
    government_category: safeString(proposal.government?.category),
    meetings: formatLabelList(proposal.meetings, 'displayName'),
    proposers: formatLabelList(proposal.proposers, 'name'),
    co_signers: formatLabelList(proposal.coSigners, 'name'),
    budget_id: safeString(proposal.budget?.id),
    budget_project_name: safeString(
      proposal.budget?.projectName || proposal.budgetProjectName
    ),
    budget_project_description: safeString(proposal.budget?.projectDescription),
    budget_major_category: safeString(
      proposal.budget?.majorCategory || proposal.budgetMajorCategory
    ),
    budget_medium_category: safeString(
      proposal.budget?.mediumCategory || proposal.budgetMediumCategory
    ),
    budget_minor_category: safeString(
      proposal.budget?.minorCategory || proposal.budgetMinorCategory
    ),
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

function formatFrozenStatus(value) {
  if (!value) return '';
  return FROZEN_STATUS_LABELS[value] || value;
}

function formatLabelList(nodes, labelKey) {
  if (!nodes || !nodes.length) return '';
  return nodes
    .map(node => safeString(node?.[labelKey]))
    .filter(Boolean)
    .join('|');
}

function formatIdList(nodes) {
  if (!nodes || !nodes.length) return '';
  return nodes
    .map(node => safeString(node?.id))
    .filter(Boolean)
    .join('|');
}

function formatSingleRelationId(node) {
  if (!node) return '';
  const target = Array.isArray(node) ? node.find(item => item && item.id) : node;
  return safeString(target?.id);
}

function formatYear(year) {
  if (!year || year.year === undefined || year.year === null) return '';
  return String(year.year);
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return String(num);
}

function safeString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
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

