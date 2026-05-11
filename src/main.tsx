import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { AivoraProvider } from './lib/store/AivoraContext'
import { GlobalAudioProvider } from './lib/store/GlobalAudioContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobalAudioProvider>
    <AivoraProvider>
      <App />
    </AivoraProvider>
    </GlobalAudioProvider>
  </React.StrictMode>,
)
