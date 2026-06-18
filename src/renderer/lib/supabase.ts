import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://juuxhecabxoeuhnajahj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1dXhoZWNhYnhvZXVobmFqYWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMjU1MzUsImV4cCI6MjA5NTcwMTUzNX0.wjtdSyLWMIYym-GDpK0jjnMbf-zEhAqC-6L_kcIbDfQ'
)
