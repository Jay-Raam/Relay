import Dashboard from '../components/Dashboard';

const API_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'http://localhost:4000/graphql';

export default function Home() {
  return <Dashboard deviceId="dev-001" metric="temperature" apiUrl={API_URL} />;
}
