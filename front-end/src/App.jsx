import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Welcome = lazy(() => import('./pages/Welcome'));
const Home = lazy(() => import('./pages/Home'));

const AppLoading = () => (
  <div className="app-loading" role="status" aria-live="polite">
    <span />
    Loading EMBR3-WQMS...
  </div>
);

const AntThemeBridge = ({ children }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#446ACB',
          colorInfo: '#446ACB',
          colorSuccess: '#7CB675',
          colorWarning: '#f59e0b',
          borderRadius: 8,
          fontFamily: "'Inter', system-ui, 'Segoe UI', Roboto, sans-serif",
          ...(isDark ? {
            colorBgBase: '#0f172a',
            colorBgContainer: '#1e293b',
            colorBgElevated: '#1e293b',
            colorText: '#e2e8f0',
            colorTextSecondary: '#7aa3e5',
            colorBorder: '#2d4a6a',
          } : {}),
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AntThemeBridge>
        <AuthProvider>
          <BrowserRouter basename="/water-quality-monitoring">
            <Suspense fallback={<AppLoading />}>
              <Routes>
                <Route path="/welcome" element={<Welcome />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password/:token" element={<ResetPassword />} />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Home />
                    </ProtectedRoute>
                  }
                />
                <Route path="/" element={<Navigate to="/welcome" replace />} />
                <Route path="*" element={<Navigate to="/welcome" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </AntThemeBridge>
    </ThemeProvider>
  );
}

export default App;
