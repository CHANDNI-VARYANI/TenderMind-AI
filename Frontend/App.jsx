import { Routes, Route, NavLink } from 'react-router-dom'
import { FileText, Users, BarChart2, Shield } from 'lucide-react'
import Home from './pages/Home'
import TenderUpload from './pages/TenderUpload'
import EvaluateBidders from './pages/EvaluateBidders'
import Dashboard from './pages/Dashboard'
import AuditLog from './pages/AuditLog'
import './App.css'

export default function App() {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Shield size={22} />
          <span>TenderMind AI</span>
        </div>
        <p className="sidebar-tagline">CRPF Procurement Platform</p>
        <nav className="sidebar-nav">
          <NavLink to="/" end><FileText size={16}/> Home</NavLink>
          <NavLink to="/tender"><FileText size={16}/> Upload Tender</NavLink>
          <NavLink to="/evaluate"><Users size={16}/> Evaluate Bidders</NavLink>
          <NavLink to="/dashboard"><BarChart2 size={16}/> Dashboard</NavLink>
          <NavLink to="/audit"><Shield size={16}/> Audit Log</NavLink>
        </nav>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tender" element={<TenderUpload />} />
          <Route path="/evaluate" element={<EvaluateBidders />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/audit" element={<AuditLog />} />
        </Routes>
      </main>
    </div>
  )
}
