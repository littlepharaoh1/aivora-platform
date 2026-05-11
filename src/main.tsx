import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { AivoraProvider } from './lib/store/AivoraContext'
import { GlobalAudioProvider } from './lib/store/GlobalAudioContext'
import { AuthProvider } from './lib/auth/AuthContext'
import AuthGate from './components/AuthGate'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
    <GlobalAudioProvider>
    <AivoraProvider>
      <AuthGate><App /></AuthGate>
    </AivoraProvider>
    </GlobalAudioProvider>
    </AuthProvider>
  </React.StrictMode>,
)
