import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initWebVitalsObservers, markAppBootStart } from './app/metrics'
import './styles.css'

markAppBootStart()
initWebVitalsObservers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
