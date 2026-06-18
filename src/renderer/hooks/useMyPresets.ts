import { useState, useEffect, useCallback } from 'react'

const KEY = 'myPresets'

export function useMyPresets() {
  const [myPresets, setMyPresets] = useState<string[]>([])

  useEffect(() => {
    window.api.getSetting(KEY).then(raw => {
      if (raw) try { setMyPresets(JSON.parse(raw as string)) } catch {}
    })
  }, [])

  const addPreset = useCallback((value: string) => {
    setMyPresets(prev => {
      if (prev.includes(value)) return prev
      const next = [value, ...prev]
      window.api.setSetting(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const removePreset = useCallback((value: string) => {
    setMyPresets(prev => {
      const next = prev.filter(p => p !== value)
      window.api.setSetting(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const editPreset = useCallback((oldValue: string, newValue: string) => {
    const trimmed = newValue.trim()
    if (!trimmed) return
    setMyPresets(prev => {
      const next = prev.map(p => p === oldValue ? trimmed : p)
      window.api.setSetting(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { myPresets, addPreset, removePreset, editPreset }
}
