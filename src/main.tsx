import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import {installFailureReporting,reportClientFailure} from './core/telemetry';
import './styles.css';
import './workspace.css';
import './atelier.css';
import './refinements.css';
import './reading-room.css';
import './hero-cover.css';
import './letter-controls.css';
import './settings-atmosphere.css';
if(localStorage.getItem('velmory-motion')==='off')document.documentElement.classList.add('motion-paused');
function AppWithUpdates(){const [waiting,setWaiting]=React.useState<ServiceWorker|null>(null);React.useEffect(()=>{const removeReporting=installFailureReporting();if(!import.meta.env.PROD||!('serviceWorker' in navigator))return removeReporting;let refreshing=false;const changed=()=>{if(!refreshing){refreshing=true;location.reload()}};navigator.serviceWorker.addEventListener('controllerchange',changed);const register=async()=>{const registration=await navigator.serviceWorker.register('/sw.js');if(registration.waiting)setWaiting(registration.waiting);registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)setWaiting(worker)})})};void register().catch(()=>reportClientFailure('service_worker_failure'));return()=>{removeReporting();navigator.serviceWorker.removeEventListener('controllerchange',changed)}},[]);return <><App/>{waiting&&<aside className="update-banner" role="status"><span>A safer, newer Velmory is ready.</span><button className="button gold" onClick={()=>waiting.postMessage('SKIP_WAITING')}>Update now</button><button className="button glass" onClick={()=>setWaiting(null)}>Later</button></aside>}</>}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><BrowserRouter><MotionConfig reducedMotion="user"><AppWithUpdates/></MotionConfig></BrowserRouter></AppErrorBoundary></React.StrictMode>);
