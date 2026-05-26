import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './auth/RequireAuth';
import { SignIn } from './auth/SignIn';
import { LandingPage } from './routes/Landing';
import { PrivacyPage } from './routes/Privacy';
import { TermsPage } from './routes/Terms';
import { WelcomePage } from './routes/Welcome';
import { UpdatePage } from './routes/Update';
import { ContactPage } from './routes/Contact';
import { LedgerPage } from './routes/Ledger';
import { ImportDafPage } from './routes/ImportDaf';
import { CalendarPage } from './routes/Calendar';
import { AdminPage } from './routes/Admin';
import { SettingsPage } from './routes/Settings';
import { MePage } from './routes/Me';
import { StripeCallback } from './routes/StripeCallback';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/update" element={<UpdatePage />} />
        <Route path="/contact/:id?" element={<ContactPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/ledger/import-daf" element={<ImportDafPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/charities/:id/stripe/callback" element={<StripeCallback />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
