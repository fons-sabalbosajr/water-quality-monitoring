import { Navigate } from 'react-router';
import { useAuth } from '../context/authStore';

const ProtectedRoute = ({ children }) => {
  const { user } = useAuth();
  return user ? children : <Navigate to="/admin" replace />;
};

export default ProtectedRoute;
