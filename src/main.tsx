import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { AivoraProvider } from './lib/store/AivoraContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AivoraProvider>
      <App />
    </AivoraProvider>
  </React.StrictMode>,
)
