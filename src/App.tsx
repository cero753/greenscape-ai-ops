import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Shell } from './components/ui'
import Dashboard from './pages/Dashboard'
import LeadDetail from './pages/LeadDetail'
import ProposalReview from './pages/ProposalReview'
import ClientProposalPage from './pages/ClientProposal'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public client page — no admin shell, its own paper aesthetic */}
        <Route path="/p/:token" element={<ClientProposalPage />} />

        <Route
          path="*"
          element={
            <Shell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/leads/:id" element={<LeadDetail />} />
                <Route path="/proposals/:id" element={<ProposalReview />} />
              </Routes>
            </Shell>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
