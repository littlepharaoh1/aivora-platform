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

// Register Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then(reg => console.log("SW registered:", reg.scope))
      .catch(err => console.log("SW registration failed:", err));
  });
}
