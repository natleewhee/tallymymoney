# Ideation archive

Thirty-one files from a DeepSeek session on 2026-08-16, before the project had a name or a scope decision.

**Renamed for legibility. Content unchanged, nothing deleted.** Where this folder contradicts `docs/`, `docs/` wins.

## Original names

| Now | Was | What it is |
|---|---|---|
| `prd-draft.md` | `deepseek_text_20260816_8ecd1b.txt` | The fullest artifact — PRD through §7.2, then truncated mid-code-block |
| `readme-draft.md` | `deepseek_markdown_20260816_7a5f97.md` | README, truncated at local setup |
| `tech-doc-header.md` | `deepseek_markdown_20260816_22a505.md` | Three lines. A heading with nothing under it |
| `render-services-and-deployment.md` | `deepseek_text_20260816_4b753b.txt` | Render 4-service topology + `render.yaml` |
| `proposed-repo-structure.txt` | `deepseek_text_20260816_27f6c5.txt` | Python source tree |
| `architecture-diagram-ascii.txt` | `deepseek_text_20260816_ec0e5b.txt` | Boxes-and-arrows system diagram |
| `state-machine-ascii.txt` | `deepseek_text_20260816_731f8a.txt` | Transaction state flow |
| `handover-note.txt` | `deepseek_text_20260816_68958f.txt` | Closing note claiming the docs are complete |
| `sample-monthly-report.txt` | `deepseek_text_20260816_4ddb5d.txt` | Rendered monthly report with fake figures |
| `schema-full.sql` | `deepseek_sql_20260816_e7c02c.sql` | 4 tables + indexes |
| `schema-minimal.sql` | `deepseek_sql_20260816_d10167.sql` | 3 tables. Conflicts with the above |
| `env-template.txt` | `deepseek_env_20260816_8e578e.txt` | Env vars |
| `env-example.sh` | `deepseek_bash_20260816_94af0d.sh` | Env vars again, slightly different |
| `telegram-message-transaction.md` | `deepseek_markdown_20260816_edf42d.md` | New-transaction message mockup |
| `telegram-message-category-picker.md` | `deepseek_markdown_20260816_5b88e3.md` | Category buttons mockup |
| `telegram-message-income-match.md` | `deepseek_markdown_20260816_fb32f1.md` | Income-matching mockup |
| `flow-email-to-notification.mermaid` | `deepseek_mermaid_20260816_c01499.mermaid` | Capture flow |
| `flow-categorisation.mermaid` | `deepseek_mermaid_20260816_c882e0.mermaid` | Tagging flow |
| `flow-income-matching.mermaid` | `deepseek_mermaid_20260816_ad7f10.mermaid` | Income match flow |
| `telegram_bot.py` | `deepseek_python_20260816_6e0344.py` | Bot handlers, most substantial stub |
| `report_generator.py` | `deepseek_python_20260816_58dac5.py` | Monthly report builder |
| `email_scanner.py` | `deepseek_python_20260816_40d45a.py` | IMAP poller + the invented regexes |
| `app_fastapi.py` | `deepseek_python_20260816_53fef3.py` | FastAPI entrypoint |
| `categories.py` | `deepseek_python_20260816_97a586.py` | 8 default categories |
| `bank_patterns.py` | `deepseek_python_20260816_dc45fd.py` | DBS pattern only, marked "add new banks here" |
| `webhook_sketch.py` | `deepseek_python_20260816_264b52.py` | 8-line webhook sketch |
| `cron_report_sketch.py` | `deepseek_python_20260816_6c835d.py` | 6-line cron sketch |
| `logging_config.py` | `deepseek_python_20260816_3660d4.py` | Four lines of logging setup |
| `local-setup.sh` | `deepseek_bash_20260816_d3e01c.sh` | Clone/venv/install |
| `test-commands.sh` | `deepseek_bash_20260816_713267.sh` | pytest invocations for tests that don't exist |
| `migration-commands.sh` | `deepseek_bash_20260816_7bb2d7.sh` | Alembic commands |

## What to trust here

**Useful:** the Telegram message mockups and the three flow diagrams. They capture the interaction design well and carried forward mostly intact.

**Useful with edits:** `schema-full.sql` and the report format.

**Do not trust:** `email_scanner.py` and `bank_patterns.py`. The DBS/OCBC/Citibank regexes look authoritative and are fabricated — no real bank email was ever examined. They are the reason SPIKE-01 exists.

**Superseded:** the Render topology, the Python source tree, all env templates, the multi-user schema, both personas, and every performance figure.

## Known internal contradictions

- Two schemas that disagree on table count and columns
- Two env templates that disagree on variables
- The message mockup asks Solo/Joint first; the state machine asks category first. Resolved in `docs/PRD.md` FR-8 — category first
- Docs describe a test suite, `logs/`, and migrations that were never written
- Dated "March 2024", with US personas, on a Singapore-bank product
