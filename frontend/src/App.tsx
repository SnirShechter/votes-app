import { Routes, Route } from 'react-router';
import { CallbackPage } from './auth/CallbackPage';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { CreatePoll } from './pages/CreatePoll';
import { EditPoll } from './pages/EditPoll';
import { ManagePoll } from './pages/ManagePoll';
import { VotePage } from './pages/VotePage';
import { ResultsPage } from './pages/ResultsPage';
import { JoinPage } from './pages/JoinPage';

export function App() {
  return (
    <Routes>
      <Route path="/callback" element={<CallbackPage />} />
      <Route path="/join/:token" element={<RequireAuth><JoinPage /></RequireAuth>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/polls/new" element={<CreatePoll />} />
        <Route path="/polls/:id/edit" element={<EditPoll />} />
        <Route path="/polls/:id/manage" element={<ManagePoll />} />
        <Route path="/polls/:id/vote" element={<VotePage />} />
        <Route path="/polls/:id/results" element={<ResultsPage />} />
      </Route>
    </Routes>
  );
}
