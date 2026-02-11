import fetch from 'node-fetch';
import { CONFIG } from './config.js';

const GRAPHQL_ENDPOINT = `${CONFIG.endpoint}/api/graphql`;

export async function graphqlRequest(query, variables = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-apollo-operation-name': 'BudgetDataExporter'
  };

  if (CONFIG.token) {
    headers.Authorization = `Bearer ${CONFIG.token}`;
  }

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphQL HTTP ${response.status}: ${text}`);
  }

  const payload = await response.json();
  if (payload.errors && payload.errors.length) {
    throw new Error(`GraphQL 錯誤: ${JSON.stringify(payload.errors)}`);
  }
  return payload.data;
}


