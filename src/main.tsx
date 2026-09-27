import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// No StrictMode: the viewer owns a single WebGL context that must not be torn down and recreated.
createRoot(document.getElementById('root')!).render(<App />);
