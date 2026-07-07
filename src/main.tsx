import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initWebVitalsObservers, markAppBootStart } from './app/metrics'
import './styles.css'

markAppBootStart()
initWebVitalsObservers()

// Initialize Yandex Games SDK before mounting the app.
// YaGames is injected globally by /sdk.js loaded in index.html.
const mountApp = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>,
  )
}

if (typeof YaGames !== 'undefined') {
  YaGames.init().then(mountApp).catch(mountApp)
} else {
  mountApp()
}
