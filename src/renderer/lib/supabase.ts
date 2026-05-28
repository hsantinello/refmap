import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://gyqwneaaepdhanncbyyz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cXduZWFhZXBkaGFubmNieXl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NzYxNTQsImV4cCI6MjA5NTI1MjE1NH0.wrgJK9F50qsvqGvohY7FWc0F_WxA51UkgyKrEOhsyN0'
)
