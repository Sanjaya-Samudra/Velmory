import { Link } from 'react-router-dom';
export default function Brand({compact=false}:{compact?:boolean}){return <Link className="brand" to="/" aria-label="Velmory home"><img src="/assets/velmory-mark.svg" alt=""/>{!compact&&<span>VELMORY<small>YOUR MEMORIES. TIMELESS.</small></span>}</Link>}
