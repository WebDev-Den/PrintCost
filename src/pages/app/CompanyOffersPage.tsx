import { Navigate, useLocation } from 'react-router-dom';

export function CompanyOffersPage() {
  const { search } = useLocation();
  return <Navigate to={`/app/admin/catalog${search}`} replace />;
}
