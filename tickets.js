// Shared SQL fragments for ticket rows (casts keep the JSON identical across drivers).
export const TICKET_COLUMNS = `
  t.id, t.ticket_code, t.ticket_number, t.service_id, s.name as service_name,
  t.status::text as status, t.queue_date::text as queue_date,
  to_char(t.scheduled_time, 'HH24:MI') as scheduled_time,
  t.issued_at, t.updated_at, t.called_at, t.completed_at`;

export const SERVICE_IDS = /^[a-z0-9-]{1,40}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
