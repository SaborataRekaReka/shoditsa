import { useEffect, useState } from 'react'
import type { CityItem } from './city-game'

let request: Promise<CityItem[]> | null = null

const loadCities = () => {
  if (!request) {
    request = fetch('./city-content/cities.json', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Не удалось загрузить города: ${response.status}`)
        return response.json() as Promise<CityItem[]>
      })
      .then((items) => {
        if (!Array.isArray(items) || !items.length) throw new Error('Набор городов пуст')
        return items
      })
      .catch((error) => {
        request = null
        throw error
      })
  }
  return request
}

export const useCityData = () => {
  const [items, setItems] = useState<CityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    loadCities()
      .then((nextItems) => {
        if (!canceled) setItems(nextItems)
      })
      .catch((reason) => {
        if (!canceled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!canceled) setLoading(false)
      })
    return () => { canceled = true }
  }, [])

  return { items, loading, error }
}
