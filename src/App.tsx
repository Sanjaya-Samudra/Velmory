import {lazy,Suspense} from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Public from './pages/Public';
import {SessionProvider} from './core/Session';import {Loading} from './components/Status';
const Auth=lazy(()=>import('./pages/Auth')),Workspace=lazy(()=>import('./pages/Workspace'));
export default function App(){return <SessionProvider><Suspense fallback={<Loading/>}><Routes><Route path="/auth/:mode" element={<Auth/>}/><Route path="/app" element={<Navigate to="/app/library" replace/>}/><Route path="/app/sanctuary" element={<Navigate to="/app/library" replace/>}/><Route path="/app/*" element={<Workspace/>}/><Route path="*" element={<Public/>}/></Routes></Suspense></SessionProvider>}
