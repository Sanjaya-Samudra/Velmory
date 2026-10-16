import {Component,type ErrorInfo,type ReactNode} from 'react';
import {AlertTriangle,RefreshCw} from 'lucide-react';
import {reportClientFailure} from '../core/telemetry';

export default class AppErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 componentDidCatch(_error:Error,_info:ErrorInfo){reportClientFailure('render_failure')}
 render(){if(!this.state.failed)return this.props.children;return <main className="fatal-screen" role="alert"><section className="fatal-card"><AlertTriangle aria-hidden="true"/><p className="eyebrow">YOUR MEMORIES REMAIN ENCRYPTED</p><h1>Velmory needs a fresh page.</h1><p>The application stopped before it could safely continue. Your saved encrypted memories remain on this device. Reload Velmory, then unlock your vault again.</p><button className="button gold" onClick={()=>location.reload()}><RefreshCw size={17}/> Reload Velmory</button><a className="text-link" href="/">Return to the entrance</a></section></main>}
}
