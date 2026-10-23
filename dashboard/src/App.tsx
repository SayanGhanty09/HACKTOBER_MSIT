import Dashboard from './pages/Dashboard';
import PatientManagement from './pages/PatientManagement';
import LiveRecording from './pages/LiveRecording';
import Statistics from './pages/Statistics';
import DeviceConsole from './pages/DeviceConsole';
import ECGMonitor from './pages/ECGMonitor';
import Settings from './pages/Settings';
import RegionalAnalytics from './pages/RegionalAnalytics';
import Login from './pages/Login';
import Registration from './pages/Registration';
import Results from './pages/Results';
import Teleconsultation from './pages/Teleconsultation';
import { Routes, Route } from 'react-router-dom';
import Shell from './components/layout/Shell';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { IntakeProvider } from './contexts/IntakeContext';
import { LanguageProvider } from './contexts/LanguageContext';

function AppRoutes() {
  const { doctor, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f9fbff 0%, #edf3fb 50%, #f5f8fd 100%)',
        color: '#334155',
        fontFamily: 'inherit',
      }}>
        Initializing session...
      </div>
    );
  }

  if (!doctor) {
    return <Login />;
  }

  return (
    <Routes>
      <Route path="/" element={<Shell />}> 
        <Route index element={<Dashboard />} />
        <Route path="live" element={<LiveRecording />} />
        <Route path="patients" element={<PatientManagement />} />
        <Route path="regions" element={<RegionalAnalytics />} />
        <Route path="stats" element={<Statistics />} />
        <Route path="console" element={<DeviceConsole />} />
        <Route path="ecg" element={<ECGMonitor />} />
        <Route path="settings" element={<Settings />} />
        <Route path="register" element={<Registration />} />
        <Route path="results" element={<Results />} />
        <Route path="teleconsultation" element={<Teleconsultation />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <IntakeProvider>
          <AppRoutes />
        </IntakeProvider>
      </LanguageProvider>
    </AuthProvider>
  );
}

export default App;
