/**
 * Database Schema Reference — shared constant for LLM prompt injection.
 *
 * All agents that generate SQL need this schema description so the LLM
 * knows the table structures, column types, and relationships.
 *
 * This is a single source of truth — never duplicate in agent files.
 *
 * To regenerate from Drizzle schema: bun scripts/generate-db-schema.ts
 * The generator introspects all pgTable exports and produces a compact
 * representation with a content hash for cache invalidation.
 */

/**
 * Schema content hash — changes when the schema structure changes.
 * Use this for cache invalidation in agents and KV storage.
 */
export const DB_SCHEMA_HASH = "manual-v2" as const;

export const DB_SCHEMA = `PostgreSQL database schema:

Tables:
- categories(id uuid, name varchar, description text, parent_id uuid, sort_order int, is_active boolean, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- products(id uuid, sku varchar, name varchar, description text, category_id uuid FK->categories, unit varchar, price numeric, cost_price numeric, tax_rate numeric, barcode varchar, image_url text, is_consumable boolean, is_sellable boolean, is_active boolean, min_stock_level int, max_stock_level int, reorder_point int, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- warehouses(id uuid, name varchar, code varchar, address text, is_active boolean, is_default boolean, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- inventory(id uuid, product_id uuid FK->products, warehouse_id uuid FK->warehouses, quantity int, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- inventory_transactions(id uuid, product_id uuid FK->products, warehouse_id uuid FK->warehouses, type varchar, quantity int, reference_type varchar, reference_id uuid, notes text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- customers(id uuid, name varchar, email varchar, phone varchar, address text, credit_limit numeric, balance numeric, is_active boolean, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- order_statuses(id uuid, name varchar, label varchar, color varchar, sort_order int, is_default boolean, is_final boolean, created_at timestamptz, updated_at timestamptz)
- orders(id uuid, order_number varchar, customer_id uuid FK->customers, status_id uuid FK->order_statuses, subtotal numeric, tax_amount numeric, discount_amount numeric, total_amount numeric, payment_method varchar, payment_reference varchar, payment_status varchar, notes text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- order_items(id uuid, order_id uuid FK->orders, item_type varchar, product_id uuid FK->products, service_id uuid FK->services, description text, quantity numeric, unit_price numeric, discount numeric, total_amount numeric, start_date timestamptz, end_date timestamptz, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- invoices(id uuid, invoice_number varchar, order_id uuid FK->orders, customer_id uuid FK->customers, total_amount numeric, tax_amount numeric, paid_amount numeric, status varchar, due_date timestamptz, notes text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- payments(id uuid, invoice_id uuid FK->invoices, amount numeric, payment_method varchar, reference varchar, notes text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- users(id uuid, email varchar, name varchar, role varchar, password_hash text, permissions jsonb, assigned_warehouses jsonb, is_active boolean, last_login_at timestamptz, created_at timestamptz, updated_at timestamptz)
- audit_log(id uuid, user_id uuid FK->users, action varchar, entity_type varchar, entity_id uuid, changes jsonb, created_at timestamptz)
- notifications(id uuid, user_id uuid FK->users, type varchar, title varchar, message text, is_read boolean, metadata jsonb, created_at timestamptz)
- business_settings(id uuid, key varchar, value text, created_at timestamptz, updated_at timestamptz)
- tax_rules(id uuid, name varchar, rate numeric, applies_to varchar, reference_id uuid, is_default boolean, created_at timestamptz, updated_at timestamptz)
- custom_tools(id uuid, name varchar, display_name varchar, description text, tool_type varchar, config jsonb, parameter_schema jsonb, is_active boolean, created_at timestamptz, updated_at timestamptz)
- asset_categories(id uuid, name varchar, description text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- assets(id uuid, asset_code varchar, name varchar, category_id uuid FK->asset_categories, purchase_date timestamptz, purchase_cost numeric, current_value numeric, condition_status varchar, location varchar, assigned_to_staff_id uuid FK->users, notes text, is_active boolean, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- service_categories(id uuid, name varchar, examples text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- services(id uuid, service_code varchar, name varchar, category_id uuid FK->service_categories, description text, base_price numeric, pricing_model varchar, capacity_limit int, requires_asset boolean, requires_stock boolean, is_active boolean, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- service_bookings(id uuid, order_item_id uuid FK->order_items, service_date timestamptz, start_time timestamptz, end_time timestamptz, status varchar, assigned_guide_id uuid FK->users, assigned_vehicle_id uuid FK->assets, notes text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- booking_assets(id uuid, booking_id uuid FK->service_bookings, asset_id uuid FK->assets, assigned_from timestamptz, assigned_until timestamptz, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- booking_stock_allocations(id uuid, booking_id uuid FK->service_bookings, stock_item_id uuid FK->products, quantity_reserved int, quantity_used int, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- chat_sessions(id uuid, user_id uuid FK->users, title varchar, status varchar, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- chat_messages(id uuid, session_id uuid FK->chat_sessions, role varchar, content text, tool_calls jsonb, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- agent_configs(id uuid, agent_name varchar, display_name varchar, description text, is_active boolean, model_override varchar, temperature numeric, max_steps int, timeout_ms int, custom_instructions text, execution_priority int, config jsonb, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- saved_reports(id uuid, report_type varchar, title varchar, period_start timestamptz, period_end timestamptz, format varchar, content text, version int, generated_by uuid FK->users, is_scheduled boolean, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- prompt_templates(id uuid, agent_name varchar, section_key varchar, template text, version int, is_active boolean, created_by uuid FK->users, change_notes text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- eval_results(id uuid, agent_name varchar, eval_name varchar, passed boolean, score numeric, reason text, session_id uuid, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- routing_analytics(id uuid, session_id uuid, user_message text, tools_selected jsonb, strategy varchar, had_correction boolean, feedback_score int, latency_ms int, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- few_shot_examples(id uuid, category varchar, user_input text, expected_behavior text, is_active boolean, sort_order int, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- schedules(id uuid, name varchar, task_type varchar, cron_expression varchar, task_config jsonb, is_active boolean, timezone varchar, last_run_at timestamptz, next_run_at timestamptz, failure_count int, max_failures int, created_by uuid FK->users, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- schedule_executions(id uuid, schedule_id uuid FK->schedules, status varchar, started_at timestamptz, completed_at timestamptz, duration_ms int, result jsonb, error_message text, trigger_source varchar, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- agent_telemetry(id uuid, agent_name varchar, span_type varchar, span_name varchar, status varchar, duration_ms int, session_id uuid, parent_span_id varchar, error_message text, attributes jsonb, started_at timestamptz, created_at timestamptz, updated_at timestamptz)
- tool_invocations(id uuid, tool_name varchar, agent_name varchar, status varchar, duration_ms int, session_id uuid, input_size_chars int, output_size_chars int, error_type varchar, error_message text, attributes jsonb, created_at timestamptz, updated_at timestamptz)
- webhook_sources(id uuid, name varchar UNIQUE, secret text, signature_header varchar, hash_algorithm varchar, handler varchar, is_async boolean, is_active boolean, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- webhook_events(id uuid, source varchar, status varchar, status_code int, handler varchar, duration_ms int, error_message text, payload_preview text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- attachments(id uuid, session_id uuid FK->chat_sessions, user_id uuid FK->users, filename varchar, content_type varchar, size_bytes int, s3_key varchar, metadata jsonb, created_at timestamptz, updated_at timestamptz)

Key relationships:
- products.category_id -> categories.id (product grouping)
- inventory.product_id -> products.id (stock levels per product)
- inventory.warehouse_id -> warehouses.id (stock per location)
- inventory_transactions.product_id -> products.id (stock movement audit)
- orders.customer_id -> customers.id (who bought)
- orders.status_id -> order_statuses.id (order workflow state)
- order_items.order_id -> orders.id (line items in order)
- order_items.product_id -> products.id (what was sold)
- order_items.service_id -> services.id (service bookings)
- invoices.order_id -> orders.id (invoice for order)
- invoices.customer_id -> customers.id (invoice recipient)
- payments.invoice_id -> invoices.id (payment against invoice)
- assets.category_id -> asset_categories.id (asset grouping)
- services.category_id -> service_categories.id (service grouping)
- service_bookings.order_item_id -> order_items.id (booking for order line)
- booking_assets.booking_id -> service_bookings.id (assets allocated to booking)
- booking_stock_allocations.booking_id -> service_bookings.id (stock allocated to booking)
- chat_messages.session_id -> chat_sessions.id (messages in conversation)
- attachments.session_id -> chat_sessions.id (files attached to conversation)
- saved_reports.generated_by -> users.id (who generated report)
- schedules.created_by -> users.id (who created schedule)
- schedule_executions.schedule_id -> schedules.id (execution history)
- prompt_templates.created_by -> users.id (who edited prompt)

SQL DIALECT: PostgreSQL. Use INTERVAL, ILIKE, STRING_AGG, EXTRACT, date_trunc, etc. NEVER MySQL syntax.` as const;
