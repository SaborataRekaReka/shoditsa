import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { initMetrikaDataLayer, initWebVitalsObservers, markAppBootStart } from './app/metrics'
import './styles.css'

markAppBootStart()
initMetrikaDataLayer()
initWebVitalsObservers()

// Initialize Yandex Games SDK before mounting the app.
// YaGames is injected globally by /sdk.js loaded in index.html.
const mountApp = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false }, mutations: { retry: false } } })
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></React.StrictMode>,
  )
}

if (typeof YaGames !== 'undefined') {
  YaGames.init().then(mountApp).catch(mountApp)
} else {
  mountApp()
}
