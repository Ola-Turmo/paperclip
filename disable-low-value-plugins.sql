-- Disable low-value plugin UI per company
-- Run with: docker exec -i compose-paperclip-db-1 psql -U paperclip -d paperclip < disable-low-value-plugins.sql

-- Plugin IDs (from plugins table)
-- uos.department-operations:         176f8785-cb88-41a4-96cd-170ce29dd9a7
-- uos.department-finance-risk:       c74442d3-c03d-48a8-bbf5-6d510672cc38
-- uos.department-people:             33df2e44-60f1-4a16-a522-a4dc7a63e3d4
-- uos.department-product-tech:       2c211da6-74aa-4da3-be9a-8163622dfdc4
-- uos.department-customer-service:   ae3a5fb7-98b3-4b5d-b5ec-afc9e6a84eab
-- uos.department-social-media:       f946a15a-4ba0-41d5-9657-8eb3ca62352d
-- uos.plugin-setup-studio:           9ff56a3a-21e8-490d-9e1c-b9a4130887aa
-- uos.plugin-operations-cockpit:     70d3f64b-9d0c-43c6-a8b7-a987b45e75b9
-- uos.plugin-connectors:             99b80fad-4f3b-414e-a109-15a949ce4245
-- personal-admin:                    3ae007ac-89fc-4ecf-802b-6a8260063e27
-- personal-health:                   f7d97aeb-971b-44b5-abb0-f950cffb01e6
-- relationships:                     850527fd-d644-4f24-8550-612817d4b37d
-- ai-spokesperson-agency:            8657463e-0801-4cf7-90c3-ef3e7504fff6
-- turmo.content-factory:             18f6ab9c-9ee0-42ae-85d2-cdbd44c9efd5
-- paperclip-plugin-telegram:         b3963dea-16c0-4375-8680-3a1f6d63aaae
-- uos-tool-canonry-aeo-monitoring:   8ad94ca7-07b2-4e71-ad27-c0b760370fc7
-- uos-tool-opencli-automation-hub:   d8ee1a6f-51c2-4c82-9411-8991ea65e3d6
-- uos-tool-trawl-web-extraction:     db5f3a23-d931-41ee-93e3-df4a9fa64883

-- Helper to upsert a disable row
CREATE OR REPLACE FUNCTION disable_plugin(company_uuid uuid, plugin_uuid uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO plugin_company_settings (id, company_id, plugin_id, enabled, settings_json, created_at, updated_at)
  VALUES (gen_random_uuid(), company_uuid, plugin_uuid, false, '{}', now(), now())
  ON CONFLICT (company_id, plugin_id) DO UPDATE SET enabled = false, updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ALL COMPANIES: disable setup-only and niche tools
-- ============================================

-- Setup studio (only used during initial company setup)
SELECT disable_plugin(id, '9ff56a3a-21e8-490d-9e1c-b9a4130887aa') FROM companies;

-- Browser companion (niche tool, not daily-use for most)
SELECT disable_plugin(id, '89e26b7c-c177-499f-8d4b-1298e28febe7') FROM companies;

-- OpenCLI automation hub (niche CLI tool)
SELECT disable_plugin(id, 'd8ee1a6f-51c2-4c82-9411-8991ea65e3d6') FROM companies;

-- Web extraction (niche scraping tool)
SELECT disable_plugin(id, 'db5f3a23-d931-41ee-93e3-df4a9fa64883') FROM companies;

-- AEO monitoring (only relevant for SEO-heavy companies)
SELECT disable_plugin(id, '8ad94ca7-07b2-4e71-ad27-c0b760370fc7') FROM companies;

-- ============================================
-- ALL EXCEPT PERSONAL: disable personal plugins
-- ============================================

SELECT disable_plugin(id, '3ae007ac-89fc-4ecf-802b-6a8260063e27') FROM companies WHERE name != 'Personal';
SELECT disable_plugin(id, 'f7d97aeb-971b-44b5-abb0-f950cffb01e6') FROM companies WHERE name != 'Personal';
SELECT disable_plugin(id, '850527fd-d644-4f24-8550-612817d4b37d') FROM companies WHERE name != 'Personal';

-- ============================================
-- ALL EXCEPT AGENTICINFLUENCER: disable content/spokesperson
-- ============================================

SELECT disable_plugin(id, '8657463e-0801-4cf7-90c3-ef3e7504fff6') FROM companies WHERE name != 'agenticinfluencer.agency';
SELECT disable_plugin(id, '18f6ab9c-9ee0-42ae-85d2-cdbd44c9efd5') FROM companies WHERE name != 'agenticinfluencer.agency';

-- ============================================
-- ALL EXCEPT AGENTICINFLUENCER + PERSONAL: disable social media dept
-- ============================================

SELECT disable_plugin(id, 'f946a15a-4ba0-41d5-9657-8eb3ca62352d') FROM companies WHERE name NOT IN ('agenticinfluencer.agency', 'Personal');

-- ============================================
-- SERVICE COMPANIES (no active product dev): disable product-tech dept
-- ============================================

SELECT disable_plugin(id, '2c211da6-74aa-4da3-be9a-8163622dfdc4')
FROM companies
WHERE name IN ('CatchUp.help', 'Gatareba.ge', 'GoAgentic.cloud', 'Kurs.ing', 'lovkode.no', 'OptiMap Agent', 'Samsvarlig.no', 'Styr.ing', 'TRT.ge', 'turmo.dev', 'Visibility.help');

-- ============================================
-- SMALL COMPANIES (< 5 agents): disable ops, finance, people, customer-service
-- ============================================

SELECT disable_plugin(id, '176f8785-cb88-41a4-96cd-170ce29dd9a7') FROM companies WHERE name IN ('GoAgentic.cloud', 'OptiMap Agent', 'turmo.dev');
SELECT disable_plugin(id, 'c74442d3-c03d-48a8-bbf5-6d510672cc38') FROM companies WHERE name IN ('GoAgentic.cloud', 'OptiMap Agent', 'turmo.dev');
SELECT disable_plugin(id, '33df2e44-60f1-4a16-a522-a4dc7a63e3d4') FROM companies WHERE name IN ('GoAgentic.cloud', 'OptiMap Agent', 'turmo.dev');
SELECT disable_plugin(id, 'ae3a5fb7-98b3-4b5d-b5ec-afc9e6a84eab') FROM companies WHERE name IN ('GoAgentic.cloud', 'OptiMap Agent', 'turmo.dev');

-- ============================================
-- COMPANIES WITHOUT DISCORD: disable telegram if not used
-- Actually telegram is separate from discord; keep for all unless explicitly unused
-- ============================================

-- ============================================
-- COMPANIES WITHOUT STRIPE: disable finance-risk dept
-- ============================================

SELECT disable_plugin(id, 'c74442d3-c03d-48a8-bbf5-6d510672cc38')
FROM companies
WHERE name IN ('Personal', 'Gatareba.ge', 'lovkode.no', 'Visibility.help', 'TRT.ge', 'agenticinfluencer.agency', 'Samsvarlig.no', 'Styr.ing', 'GoAgentic.cloud', 'CatchUp.help', 'turmo.dev', 'OptiMap Agent');

-- ============================================
-- DISABLE connectors plugin for companies not actively managing integrations
-- (most companies just use the default Composio setup)
-- ============================================

SELECT disable_plugin(id, '99b80fad-4f3b-414e-a109-15a949ce4245')
FROM companies
WHERE name IN ('GoAgentic.cloud', 'OptiMap Agent', 'turmo.dev', 'CatchUp.help');

-- ============================================
-- DISABLE operations-cockpit for tiny companies
-- ============================================

SELECT disable_plugin(id, '70d3f64b-9d0c-43c6-a8b7-a987b45e75b9')
FROM companies
WHERE name IN ('GoAgentic.cloud', 'OptiMap Agent', 'turmo.dev');

-- Clean up helper
DROP FUNCTION disable_plugin;
