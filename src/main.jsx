import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { Router } from './App.jsx'
import { AuthProvider } from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <Router>
    <AuthProvider>
      <App />
    </AuthProvider>
  </Router>
)
