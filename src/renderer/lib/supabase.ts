import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://juuxhecabxoeuhnajahj.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1dXhoZWNhYnhvZXVobmFqYWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMjU1MzUsImV4cCI6MjA5NTcwMTUzNX0.wjtdSyLWMIYym-GDpK0jjnMbf-zEhAqC-6L_kcIbDfQ'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Cliente dedicado só para revalidar a licença, chamando a função check_license
// (SECURITY DEFINER) em vez de ler a tabela `licenses` direto — a tabela é privada
// (RLS), só a função devolve o resultado (sim/não), sem expor e-mails.
// Não persiste sessão própria nem interfere na sessão do cliente principal.
const licenseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, storageKey: 'refmap-license-check' },
})

// Revalida se o e-mail ainda tem licença ativa.
//   true  = licença ativa
//   false = removida do banco (revogar acesso)
//   null  = indeterminado (rede/servidor indisponível) → caller deve fail-open (NÃO deslogar)
export async function isLicenseActive(email: string): Promise<boolean | null> {
  const { data, error } = await licenseClient
    .rpc('check_license', { p_email: email.toLowerCase().trim() })
  if (error) return null
  return data === true
}
