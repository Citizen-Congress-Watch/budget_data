import { exportProposals } from './proposalExporter.js';

async function main() {
  try {
    const summary = await exportProposals();
    console.log(
      `匯出完成：${summary.totalRecords} 筆、${summary.totalYears} 個年度（${summary.lastSyncedAt}）`
    );
  } catch (error) {
    console.error('匯出失敗：', error);
    process.exitCode = 1;
  }
}

main();

