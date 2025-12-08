# budget_data
中央政府總預算審議提案資料，每次更新會在本資料夾提供 `proposals_year_<year>.csv` 與相同內容的 `proposals_year_<year>.json`，以下為欄位對照：

## 欄位對照
| 欄位 | 說明 |
| --- | --- |
| `proposal_id` | 提案 ID |
| `proposal_types` | 提案類型（凍結／減列／主決議），多值以 `、` 分隔 |
| `result` | 審議結果（通過／保留／撤案） |
| `reduction_amount` / `freeze_amount` | 減列／凍結金額 |
| `reason` / `description` | 提案摘要與完整內容 |
| `budget_image_url` | 預算單圖檔連結 |
| `historical_proposals` / `merged_proposals` | 關聯子提案 proposal_id，多值以 「|」分隔 |
| `historical_parent_proposal` / `merged_parent_proposal` | 歷史／併案母提案 proposal_id |
| `year` | 預算年度（例如 114） |
| `government_name` / `government_category` | 關聯部會名稱與分類 |
| `meetings` | 參考會議名稱，多值以 「|」 分隔 |
| `proposers` / `co_signers` | 提案人／連署人姓名，多值以 「|」 分隔 |
| `budget_id` | 關聯預算 ID |
| `budget_project_name` / `budget_project_description` | 預算計畫名稱與描述 |
| `budget_major_category` / `budget_medium_category` / `budget_minor_category` | 預算科目（大／中／小） |
| `budget_amount` | 預算金額 |
| `last_synced_at` | 匯出時間（JSON 版本會將生成時間寫在最外層 metadata） |

## 授權
License: CC0
