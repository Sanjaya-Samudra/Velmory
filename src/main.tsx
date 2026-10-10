import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import App from './App';
import './styles.css';
import './workspace.css';
import './atelier.css';
import './refinements.css';
import './reading-room.css';
import './hero-cover.css';
import './letter-controls.css';
import './settings-atmosphere.css';
if(localStorage.getItem('velmory-motion')==='off')document.documentElement.classList.add('motion-paused');
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><MotionConfig reducedMotion="user"><App/></MotionConfig></BrowserRouter></React.StrictMode>);

if(import.meta.env.PROD && 'serviceWorker' in navigator){window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{})})}
